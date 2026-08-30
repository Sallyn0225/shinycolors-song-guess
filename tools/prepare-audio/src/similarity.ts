import type { SongMeta } from './types.js'
import { normalizeTitle } from './util/text.js'

/**
 * 把每个字符映射成脚本类别，压缩连续同类，得到「形状签名」。
 *
 * 这是专门为闪彩曲名设计的：
 *   散花-sanka-      → K S L S
 *   紅花-benibana-   → K S L S     ← 完全相同
 *   銀翼のアレジアンス -blade of truth-  → K H T S L S
 *   銀翼のアヴニール -become the brave-  → K H T S L S
 * 纯 Levenshtein 抓不到这种「同构但字面不同」的关系，而它们正是最好的干扰项。
 */
export function shapeSignature(title: string): string {
  const cls = (ch: string): string => {
    const c = ch.codePointAt(0) ?? 0
    if (c >= 0x4e00 && c <= 0x9fff) return 'K' // 漢字
    if (c >= 0x3040 && c <= 0x309f) return 'H' // 平假名
    if (c >= 0x30a0 && c <= 0x30ff) return 'T' // 片假名
    if (/[0-9]/.test(ch)) return 'D'
    if (/[a-zA-Z]/.test(ch)) return 'L'
    if (/\s/.test(ch)) return ' '
    return 'S'
  }
  const raw = [...title.normalize('NFKC')].map(cls).join('')
  return raw.replace(/(.)\1+/g, '$1').replace(/\s/g, '')
}

/** 归一化编辑距离相似度，0~1 */
function editSim(a: string, b: string): number {
  if (a === b) return 1
  if (!a.length || !b.length) return 0
  const m = a.length
  const n = b.length
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        (prev[j] as number) + 1,
        (cur[j - 1] as number) + 1,
        (prev[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    prev = cur
  }
  return 1 - (prev[n] as number) / Math.max(m, n)
}

/** 字符 bigram 的 Dice 系数 */
function bigramDice(a: string, b: string): number {
  const grams = (s: string): Set<string> => {
    const out = new Set<string>()
    for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2))
    return out
  }
  const A = grams(a)
  const B = grams(b)
  if (A.size === 0 || B.size === 0) return a === b ? 1 : 0
  let inter = 0
  for (const g of A) if (B.has(g)) inter++
  return (2 * inter) / (A.size + B.size)
}

/** 归一化后的最长公共前缀 / 后缀占比 */
function affixScore(a: string, b: string): number {
  const max = Math.min(a.length, b.length)
  let pre = 0
  while (pre < max && a[pre] === b[pre]) pre++
  let suf = 0
  while (suf < max - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++
  return Math.max(pre, suf) / Math.max(a.length, b.length)
}

export function titleScore(a: SongMeta, b: SongMeta): number {
  const na = normalizeTitle(a.title)
  const nb = normalizeTitle(b.title)
  return Math.max(affixScore(na, nb), bigramDice(na, nb), editSim(shapeSignature(a.title), shapeSignature(b.title)) * 0.8)
}

function unitScore(a: SongMeta, b: SongMeta): number {
  if (a.unit && b.unit && a.unit === b.unit) return 1
  const shared = a.units.filter((u) => b.units.includes(u))
  if (shared.length > 0) return 0.6
  return 0
}

function albumScore(a: SongMeta, b: SongMeta): number {
  if (!a.album || !b.album) return 0
  if (a.album === b.album) return 1
  // 同一个系列（CANVAS / ECHOES / PANOR@MA WING / Song for Prism …）
  const series = (s: string): string =>
    s.replace(/^THE IDOLM@STER SHINY COLORS\s*/, '').replace(/["']/g, '').replace(/\s*\d+\s*$/, '').trim()
  const sa = series(a.album)
  const sb = series(b.album)
  return sa && sa === sb ? 0.5 : 0
}

/**
 * 综合相似度。album 对 233 首 100% 可用，是 unit 之外最可靠的分组信号。
 */
export function similarity(a: SongMeta, b: SongMeta): number {
  return 0.35 * unitScore(a, b) + 0.2 * albumScore(a, b) + 0.45 * titleScore(a, b)
}

export interface Neighbour {
  id: string
  sim: number
}

/** 为每首歌预计算最像的 N 个邻居（233×233，毫秒级），运行时 O(1) 取用 */
export function computeNeighbours(songs: SongMeta[], topN = 24): Map<string, Neighbour[]> {
  const out = new Map<string, Neighbour[]>()
  for (const a of songs) {
    const scored: Neighbour[] = []
    for (const b of songs) {
      if (a.id === b.id) continue
      // 同一易混淆组的曲子永远不能互为干扰项——那是「无法靠实力避免的失误」，不是难度
      if (a.confusableGroup && a.confusableGroup === b.confusableGroup) continue
      scored.push({ id: b.id, sim: Math.round(similarity(a, b) * 1000) / 1000 })
    }
    scored.sort((x, y) => y.sim - x.sim)
    out.set(a.id, scored.slice(0, topN))
  }
  return out
}
