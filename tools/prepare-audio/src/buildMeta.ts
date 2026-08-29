import type { ScannedSong, SongMeta } from './types.js'
import { loadTables, resolveUnit, type UnitTables } from './resolveUnit.js'
import { normalizeName, variantGroupKey } from './util/text.js'

/**
 * 生成显示用艺术家名。
 *
 * 曲库里已经有 3 首用的是 `角色名 (CV.声优名)` 格式（月影のアンシェネ / Once Upon a Secret /
 * メモワール・アンタクト），而 OFF VOCAL COLLECTION 02 的 23 首 solo 曲用的是声优本名。
 * 统一成前者可以让曲库内部一致，也符合官方 CD 的署名方式。
 */
function displayArtistFor(song: ScannedSong, res: ReturnType<typeof resolveUnit>, t: UnitTables): string {
  if (res.performers.length > 0) {
    // 3 人以上（跨组合选拔/合同曲）展开写会长到牌面放不下——
    // `サマーサマーオーシャンパーリィバケーション` 有 8 人，展开是 100+ 字符。
    // 这类只列角色名，超过 3 人再折叠。
    if (res.performers.length > 3) {
      return `${res.performers.slice(0, 2).join('・')} 他${res.performers.length - 2}名`
    }
    if (res.performers.length > 1) {
      return res.performers.join('・')
    }
    const ch = res.performers[0] as string
    const unitId = t.characterToUnit.get(normalizeName(ch))
    const member = unitId
      ? t.unitById.get(unitId)?.members.find((m) => normalizeName(m.character) === normalizeName(ch))
      : undefined
    return member ? `${member.character} (CV.${member.cv})` : ch
  }
  if (res.units.length > 0) {
    return res.units.map((id) => t.unitById.get(id)?.name ?? id).join(' × ')
  }
  // 兜底：保留原始 artist。注意这可能是作曲者而非演唱者，UI 上不应标成「演唱」
  return song.rawArtist
}

export interface MetaBuildResult {
  songs: SongMeta[]
  tables: UnitTables
  /** unit 未决议的曲目，需人工复核 */
  unresolved: SongMeta[]
  /** source → 命中数，用于审计决议链 */
  sourceCounts: Record<string, number>
  confusableGroups: Map<string, SongMeta[]>
}

export async function buildMeta(scanned: ScannedSong[]): Promise<MetaBuildResult> {
  const tables = await loadTables()

  const songs: SongMeta[] = scanned.map((song) => {
    const res = resolveUnit(song, tables)
    return {
      ...song,
      ...res,
      displayArtist: displayArtistFor(song, res, tables),
      confusableGroup: null,
    }
  })

  // 易混淆组：剥掉版本后缀后同名的归为一组，组内多于 1 首才算
  const byVariant = new Map<string, SongMeta[]>()
  for (const s of songs) {
    const key = variantGroupKey(s.title)
    const arr = byVariant.get(key)
    if (arr) arr.push(s)
    else byVariant.set(key, [s])
  }
  const confusableGroups = new Map<string, SongMeta[]>()
  for (const [key, group] of byVariant) {
    if (group.length > 1) {
      confusableGroups.set(key, group)
      for (const s of group) s.confusableGroup = key
    }
  }

  const sourceCounts: Record<string, number> = {}
  for (const s of songs) sourceCounts[s.source] = (sourceCounts[s.source] ?? 0) + 1

  return {
    songs,
    tables,
    unresolved: songs.filter((s) => s.unit === null && s.units.length === 0),
    sourceCounts,
    confusableGroups,
  }
}
