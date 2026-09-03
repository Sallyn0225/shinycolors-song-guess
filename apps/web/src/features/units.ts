/**
 * 可进组合榜的 9 个分组。
 *
 * 抄自 assets/manifest.public.json 的 units[]，与 features/idols.ts、features/library.ts
 * 同一个取舍：为一份不会变的静态数据加一次网络往返不划算，代价是需要人工同步。
 * 曲库的组合若有变动，在**仓库根**重新求值：
 *
 *   node -e "require('./assets/manifest.public.json').units.filter(u=>u.kind!=='shuffle').forEach(u=>console.log(u.id,u.kind,u.name,u.color))"
 *
 * 为什么 shuffle unit 与无归属曲目不在这里：它们不是「我熟不熟这个组合」这个问题的
 * 有效分组——一个 2 首歌的临时组合排进榜单，只会用一个 0% 或 100% 顶掉真正的信息。
 * 它们仍然计入单曲榜与分数/正确率总量。
 */
export const COUNTED_UNITS = [
  { id: 'illumination-stars', name: 'イルミネーションスターズ', color: '#fff68d' },
  { id: 'lantica', name: 'アンティーカ', color: '#853998' },
  { id: 'houkago-climax-girls', name: '放課後クライマックスガールズ', color: '#fa8333' },
  { id: 'alstroemeria', name: 'アルストロメリア', color: '#ff699e' },
  { id: 'straylight', name: 'ストレイライト', color: '#af011c' },
  { id: 'noctchill', name: 'ノクチル', color: '#384d98' },
  { id: 'shhis', name: 'シーズ', color: '#008e74' },
  { id: 'cometik', name: 'コメティック', color: '#333333' },
  { id: 'shinycolors', name: 'シャイニーカラーズ', color: '#8adfff' }, // 全体曲
] as const

export type CountedUnitId = (typeof COUNTED_UNITS)[number]['id']

const UNIT_BY_ID = new Map<string, (typeof COUNTED_UNITS)[number]>(
  COUNTED_UNITS.map((u) => [u.id, u]),
)

export function isCountedUnit(id: string | null): id is CountedUnitId {
  return id !== null && UNIT_BY_ID.has(id)
}

export function unitName(id: string): string {
  return UNIT_BY_ID.get(id)?.name ?? id
}

export function unitColor(id: string): string {
  return UNIT_BY_ID.get(id)?.color ?? 'var(--color-primary)'
}
