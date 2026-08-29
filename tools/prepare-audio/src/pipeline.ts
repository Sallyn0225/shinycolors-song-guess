import fs from 'node:fs/promises'
import path from 'node:path'

import { CACHE_DIR, STAGE_VERSIONS } from './config.js'
import { buildMeta } from './buildMeta.js'
import { assertPublicManifestClean, writeManifests } from './manifest.js'
import { StageCache } from './util/cache.js'
import type { AnalysisResult, ScannedSong, SliceSpec, SongMeta } from './types.js'
import type { UnitTables } from './resolveUnit.js'

export const SCAN_JSON = path.join(CACHE_DIR, 'scan.json')
export const ANALYSIS_DIR = path.join(CACHE_DIR, 'analysis')
export const SLICE_DIR_CACHE = path.join(CACHE_DIR, 'slices')

export async function readScanJson(): Promise<ScannedSong[]> {
  const raw = await fs.readFile(SCAN_JSON, 'utf8')
  return (JSON.parse(raw) as { songs: ScannedSong[] }).songs
}

export async function writeScanJson(songs: SongMeta[]): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true })
  await fs.writeFile(
    SCAN_JSON,
    JSON.stringify({ generatedAt: new Date().toISOString(), songs }, null, 2),
    'utf8',
  )
}

/**
 * 重新跑一遍演唱者决议。
 *
 * 编辑 overrides.json 之后调用：loadTables() 每次都重读磁盘，所以能立刻反映改动。
 * 只涉及元数据，不碰音频，很快。
 */
export async function reresolve(): Promise<{ songs: SongMeta[]; tables: UnitTables }> {
  const scanned = await readScanJson()
  const meta = await buildMeta(scanned)
  return { songs: meta.songs, tables: meta.tables }
}

/**
 * 用已有的 analyze / slice 缓存重新生成 manifest。
 * 归属改动后调用，让改动立刻生效到游戏数据，不需要重新编码音频。
 */
export async function rebuildManifests(
  songs: SongMeta[],
  tables: UnitTables,
): Promise<{ ok: boolean; message: string }> {
  const analysisCache = new StageCache<AnalysisResult>(ANALYSIS_DIR, STAGE_VERSIONS.analyze)
  const specCache = new StageCache<SliceSpec[]>(SLICE_DIR_CACHE, STAGE_VERSIONS.slice)

  const analyses = new Map<string, AnalysisResult>()
  const specs = new Map<string, SliceSpec[]>()
  const missing: string[] = []

  for (const s of songs) {
    const a = await analysisCache.get(s.id, s.srcSize, s.srcMtimeMs)
    const sp = await specCache.get(s.id, s.srcSize, s.srcMtimeMs)
    if (!a || !sp) {
      missing.push(s.title)
      continue
    }
    analyses.set(s.id, a)
    specs.set(s.id, sp)
  }

  if (missing.length > 0) {
    return {
      ok: false,
      message: `${missing.length} 首缺少 analyze/slice 缓存，请先跑 pnpm assets all（例：${missing[0]}）`,
    }
  }

  const { publicCount, sliceCount } = await writeManifests({ songs, tables, analyses, specs })
  const problems = await assertPublicManifestClean()
  if (problems.length > 0) {
    return { ok: false, message: `manifest 边界检查未通过：${problems.join('；')}` }
  }
  return { ok: true, message: `已写出 manifest：${publicCount} 首 / ${sliceCount} 个切片映射` }
}
