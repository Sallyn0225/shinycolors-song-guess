import fs from 'node:fs/promises'
import path from 'node:path'

import { DATA_DIR } from './config.js'
import type { ScannedSong, UnitResolution } from './types.js'
import { normalizeName, parseCvCredit, splitArtists } from './util/text.js'

interface UnitMember {
  character: string
  cv: string
  color: string
}
interface UnitDef {
  id: string
  name: string
  nameEn?: string
  color: string | null
  kind: 'permanent' | 'shuffle' | 'whole'
  aliases: string[]
  members: UnitMember[]
}
interface AlbumRules {
  seriesVolumeMap: Record<string, Record<string, string[]>>
  patterns: Array<{ regex: string; captureIsUnitName?: boolean; units?: string[] }>
  exact: Record<string, string[]>
  needsReview: { albums: string[] }
}
interface Overrides {
  byTitle: Record<string, { unit?: string; units?: string[]; performers?: string[]; note?: string }>
}

export interface UnitTables {
  units: UnitDef[]
  unitById: Map<string, UnitDef>
  /** 归一化后的别名 → unit id */
  aliasToUnit: Map<string, string>
  /** 归一化后的角色名 → unit id */
  characterToUnit: Map<string, string>
  /** 归一化后的声优本名 → { character, unitId } */
  cvToMember: Map<string, { character: string; unitId: string }>
  albums: AlbumRules
  overrides: Overrides
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(path.join(DATA_DIR, file), 'utf8')) as T
}

export async function loadTables(): Promise<UnitTables> {
  const unitsFile = await readJson<{ units: UnitDef[] }>('units.json')
  const albums = await readJson<AlbumRules>('albums.json')
  const overrides = await readJson<Overrides>('overrides.json')

  // units.json 里混了 "_comment" 字段的对象，过滤掉没有 id 的条目
  const units = unitsFile.units.filter((u) => typeof u.id === 'string')

  const unitById = new Map<string, UnitDef>()
  const aliasToUnit = new Map<string, string>()
  const characterToUnit = new Map<string, string>()
  const cvToMember = new Map<string, { character: string; unitId: string }>()

  for (const u of units) {
    unitById.set(u.id, u)
    for (const a of u.aliases ?? []) aliasToUnit.set(normalizeName(a), u.id)
    aliasToUnit.set(normalizeName(u.name), u.id)
    for (const m of u.members ?? []) {
      characterToUnit.set(normalizeName(m.character), u.id)
      cvToMember.set(normalizeName(m.cv), { character: m.character, unitId: u.id })
    }
  }

  return { units, unitById, aliasToUnit, characterToUnit, cvToMember, albums, overrides }
}

/** 从一组组合 id 收敛出「单一 unit」：全部相同才算，否则 null（跨组合合作） */
function singleUnit(unitIds: string[]): string | null {
  const uniq = [...new Set(unitIds)]
  return uniq.length === 1 ? (uniq[0] as string) : null
}

function fromPerformers(t: UnitTables, performers: string[]): { units: string[]; unit: string | null } {
  const unitIds = performers
    .map((p) => t.characterToUnit.get(normalizeName(p)))
    .filter((x): x is string => Boolean(x))
  return { units: [...new Set(unitIds)], unit: singleUnit(unitIds) }
}

/**
 * 决议一首歌的演唱者。
 *
 * 背景：ID3 `artist` 语义不可靠——234 首里有 96 首填的是**作曲/编曲者**而非演唱者
 * （判据：artist 与 lrc 的『作曲 :』行重合）。album 才是修复它的钥匙。
 *
 * 优先级由高到低。每条规则命中即返回，并记录 source 供审计。
 */
export function resolveUnit(song: ScannedSong, t: UnitTables): UnitResolution {
  const none = (source: UnitResolution['source']): UnitResolution => ({
    unit: null,
    units: [],
    performers: [],
    source,
  })

  // 1. 人工覆盖
  const ov = t.overrides.byTitle[song.title]
  if (ov) {
    const performers = ov.performers ?? []
    const derived = performers.length ? fromPerformers(t, performers) : { units: [], unit: null }
    const units = ov.units ?? (ov.unit ? [ov.unit] : derived.units)
    return {
      unit: ov.unit ?? singleUnit(units),
      units,
      performers,
      source: 'override',
    }
  }

  // 2. artist 整体精确匹配组合名
  const exact = t.aliasToUnit.get(normalizeName(song.rawArtist))
  if (exact) return { unit: exact, units: [exact], performers: [], source: 'artist-exact' }

  // 3. artist 按 `/` 拆分后逐个匹配（跨组合合作，如 円環 -Halo around- 系列）
  const parts = splitArtists(song.rawArtist)
  if (parts.length > 1) {
    const matched = parts.map((p) => t.aliasToUnit.get(normalizeName(p))).filter((x): x is string => Boolean(x))
    if (matched.length === parts.length) {
      const units = [...new Set(matched)]
      return { unit: singleUnit(matched), units, performers: [], source: 'artist-split' }
    }
  }

  // 4. artist 是 `角色名 (CV.声优名)` 形式（可能多个用 / 连接）
  const cvCredits = parts.map(parseCvCredit).filter((x): x is { character: string; cv: string } => x !== null)
  if (cvCredits.length > 0 && cvCredits.length === parts.length) {
    const performers = cvCredits.map((c) => c.character)
    const { units, unit } = fromPerformers(t, performers)
    return { unit, units, performers, source: 'artist-cv' }
  }

  // 5. artist 是声优本名（可能多个用 / 连接）。OFF VOCAL COLLECTION 02 的 23 首 solo 曲走这条
  const viaCv = parts.map((p) => t.cvToMember.get(normalizeName(p)))
  if (viaCv.length > 0 && viaCv.every((m) => m !== undefined)) {
    const members = viaCv as Array<{ character: string; unitId: string }>
    const performers = members.map((m) => m.character)
    const unitIds = members.map((m) => m.unitId)
    return {
      unit: singleUnit(unitIds),
      units: [...new Set(unitIds)],
      performers,
      source: 'seiyuu-table',
    }
  }

  // 6. album 规则
  const albumRes = resolveFromAlbum(song.album, t)
  if (albumRes) return albumRes

  // 7. 曲名括号里的组合名，如 `Migratory Echoes (アンティーカ Ver.)`
  const paren = song.title.match(/[（(]\s*([^（()）]+?)\s*Ver\.\s*[）)]/)
  if (paren?.[1]) {
    const uid = t.aliasToUnit.get(normalizeName(paren[1]))
    if (uid) return { unit: uid, units: [uid], performers: [], source: 'title-paren' }
  }

  return none('unresolved')
}

function resolveFromAlbum(album: string, t: UnitTables): UnitResolution | null {
  if (!album) return null

  // 6a. exact
  const ex = t.albums.exact[album]
  if (ex?.length) {
    return { unit: singleUnit(ex), units: [...new Set(ex)], performers: [], source: 'album-exact' }
  }

  // 6b. CANVAS / ECHOES 系列的卷号 → 组合
  for (const [series, volMap] of Object.entries(t.albums.seriesVolumeMap)) {
    if (series.startsWith('_')) continue
    // album 形如 `THE IDOLM@STER SHINY COLORS "CANVAS" 08` / `... ECHOES 02`
    const re = new RegExp(`${series}["']?\\s+(\\d{2})(?!\\d)`)
    const m = album.match(re)
    const vol = m?.[1]
    if (vol) {
      const ids = volMap[vol]
      if (ids?.length) {
        return { unit: singleUnit(ids), units: [...new Set(ids)], performers: [], source: 'album-series' }
      }
    }
  }

  // 6c. 正则模式：(XXX盤) / COLORFUL FE@THERS -XXX-
  for (const p of t.albums.patterns) {
    if (!p.regex) continue
    const m = album.match(new RegExp(p.regex))
    if (!m) continue
    if (p.captureIsUnitName && m[1]) {
      const uid = t.aliasToUnit.get(normalizeName(m[1]))
      if (uid) return { unit: uid, units: [uid], performers: [], source: 'album-pattern' }
    } else if (p.units?.length) {
      return {
        unit: singleUnit(p.units),
        units: [...new Set(p.units)],
        performers: [],
        source: 'album-pattern',
      }
    }
  }

  return null
}
