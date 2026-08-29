import fs from 'node:fs/promises'
import path from 'node:path'

import { ASSETS_ROOT } from './config.js'
import type { AnalysisResult, SliceSpec, SongMeta } from './types.js'
import type { UnitTables } from './resolveUnit.js'
import { computeNeighbours, type Neighbour } from './similarity.js'

export const PUBLIC_MANIFEST = path.join(ASSETS_ROOT, 'manifest.public.json')
export const PRIVATE_MANIFEST = path.join(ASSETS_ROOT, 'manifest.private.json')

const MANIFEST_VERSION = 1

/** 客户端可见。必须够渲染牌面和选项，且不能泄漏任何答案线索 */
interface PublicSong {
  id: string
  title: string
  /** 显示用演唱者 */
  artist: string
  unit: string | null
  /** 用于卡片色条 */
  unitColor: string | null
}

/** 只在服务器进程内存里，永不经 HTTP 暴露 */
interface PrivateSong {
  id: string
  title: string
  album: string
  unit: string | null
  units: string[]
  performers: string[]
  confusableGroup: string | null
  durationSec: number
  integratedLufs: number
  truePeakDbfs: number
  slices: SliceSpec[]
  neighbours: Neighbour[]
}

export interface WriteManifestArgs {
  songs: SongMeta[]
  tables: UnitTables
  analyses: Map<string, AnalysisResult>
  specs: Map<string, SliceSpec[]>
}

export async function writeManifests(args: WriteManifestArgs): Promise<{ publicCount: number; sliceCount: number }> {
  const { songs, tables, analyses, specs } = args
  const neighbours = computeNeighbours(songs)

  const publicSongs: PublicSong[] = songs.map((s) => ({
    id: s.id,
    title: s.title,
    artist: s.displayArtist,
    unit: s.unit,
    unitColor: s.unit ? (tables.unitById.get(s.unit)?.color ?? null) : null,
  }))

  const privateSongs: PrivateSong[] = songs.map((s) => {
    const a = analyses.get(s.id)
    return {
      id: s.id,
      title: s.title,
      album: s.album,
      unit: s.unit,
      units: s.units,
      performers: s.performers,
      confusableGroup: s.confusableGroup,
      durationSec: s.durationSec,
      integratedLufs: a?.integratedLufs ?? 0,
      truePeakDbfs: a?.truePeakDbfs ?? 0,
      slices: specs.get(s.id) ?? [],
      neighbours: neighbours.get(s.id) ?? [],
    }
  })

  // sliceId → 曲目 的反查表。服务器启动时读进内存，是唯一能把切片还原成曲目的地方
  const sliceIndex: Record<string, { songId: string; index: number }> = {}
  for (const s of privateSongs) {
    for (const sp of s.slices) sliceIndex[sp.sliceId] = { songId: s.id, index: sp.index }
  }

  const units = tables.units.map((u) => ({ id: u.id, name: u.name, color: u.color, kind: u.kind }))

  await fs.mkdir(ASSETS_ROOT, { recursive: true })
  await fs.writeFile(
    PUBLIC_MANIFEST,
    JSON.stringify({ version: MANIFEST_VERSION, units, songs: publicSongs }, null, 2),
    'utf8',
  )
  await fs.writeFile(
    PRIVATE_MANIFEST,
    JSON.stringify({ version: MANIFEST_VERSION, songs: privateSongs, sliceIndex }, null, 2),
    'utf8',
  )

  return { publicCount: publicSongs.length, sliceCount: Object.keys(sliceIndex).length }
}

/**
 * public manifest 的边界断言。
 *
 * 这几条都是「静默上线就泄题」的类型：
 *  - 出现 sliceId → 客户端能直接把切片映射回曲目
 *  - 出现 duration → 234 个不同时长几乎唯一标识曲目，是真实旁路
 *  - 出现源文件路径 → 直接暴露曲名
 */
export async function assertPublicManifestClean(): Promise<string[]> {
  const raw = await fs.readFile(PUBLIC_MANIFEST, 'utf8')
  const problems: string[] = []
  const parsed = JSON.parse(raw) as { songs: Array<Record<string, unknown>> }

  const forbidden = ['sliceId', 'slices', 'duration', 'durationSec', 'mp3Path', 'jpgPath', 'srcSize', 'srcMtimeMs', 'sliceCount', 'integratedLufs', 'neighbours', 'album']
  for (const key of forbidden) {
    if (raw.includes(`"${key}"`)) problems.push(`public manifest 含禁止字段 "${key}"`)
  }
  for (const s of parsed.songs) {
    const extra = Object.keys(s).filter((k) => !['id', 'title', 'artist', 'unit', 'unitColor'].includes(k))
    if (extra.length > 0) {
      problems.push(`public manifest 出现未预期字段: ${extra.join(', ')}`)
      break
    }
  }
  return problems
}
