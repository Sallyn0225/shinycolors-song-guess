import fs from 'node:fs/promises'
import path from 'node:path'

import { ASSETS_ROOT } from './config.js'
import type { SongMeta } from './types.js'
import type { UnitTables } from './resolveUnit.js'
import { normalizeName } from './util/text.js'
import { win32Long } from './util/paths.js'
import { mapConcurrent } from './util/proc.js'

export const REVIEW_JSON = path.join(ASSETS_ROOT, 'artist-review.json')
export const REVIEW_MD = path.join(ASSETS_ROOT, 'artist-review.md')

export type Risk = '高' | '中' | '低'

export interface ReviewRow {
  risk: Risk
  /** 为什么是这个风险等级 */
  why: string
  title: string
  album: string
  /** 文件 ID3 里原本写的 artist */
  fileArtist: string
  /** 我判定出来的演唱者 */
  resolvedArtist: string
  unit: string | null
  unitName: string | null
  source: string
  /** lrc 里的作曲 + 編曲 名单 */
  lrcCredits: string
  /** file artist 是否出现在制作者名单里（true = 它确实是作曲/编曲者，改写有依据） */
  artistIsCreditedStaff: boolean | null
  /** 曲名括号里写的组合名与判定结果是否冲突 */
  titleUnitConflict: string | null
  /** 曲名括号里写的组合名与判定结果一致（两个独立信号互相印证） */
  titleUnitAgrees: boolean
}

/**
 * 从 .lrc 里抽出制作者名单。
 *
 * **必须同时取「作曲」和「編曲」**：`Migratory Echoes (アンティーカ Ver.)` 的
 * 作曲是 ヤナガワタカオ，而文件 artist 写的 原田篤 是**編曲者**。只查作曲会漏掉这类，
 * 把本来正确的改写误判成高风险。
 */
async function readCredits(mp3Path: string): Promise<string> {
  const lrcPath = mp3Path.replace(/\.mp3$/i, '.lrc')
  try {
    const text = await fs.readFile(win32Long(lrcPath), 'utf8')
    const names: string[] = []
    for (const m of text.matchAll(/(?:作曲|編曲|编曲)\s*[:：]\s*(.+)/g)) {
      if (m[1]) names.push(m[1].trim())
    }
    return [...new Set(names.join('/').split('/').map((s) => s.trim()).filter(Boolean))].join('/')
  } catch {
    return ''
  }
}

/**
 * CJK 异体字归一。曲库里真实踩到的：`石黒剛`(U+9ED2) vs `石黑剛`(U+9ED1) 是同一个人，
 * 但码位不同，直接比对会漏。
 */
const CJK_VARIANTS: Record<string, string> = {
  黑: '黒',
  沢: '澤',
  斉: '齊',
  斎: '齋',
  竜: '龍',
  剣: '劍',
  桧: '檜',
  弥: '彌',
}

function foldVariants(s: string): string {
  return [...s].map((c) => CJK_VARIANTS[c] ?? c).join('')
}

/** 归一化编辑距离，用于容忍 1 个字的写法差异 */
function editDistance(a: string, b: string): number {
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
  return prev[n] as number
}

/**
 * artist 是否出现在制作者名单里。
 *
 * 两边都可能是多人（`/` 连接），写法也不统一（半角/全角括号、工作室后缀、
 * 名字中间的空格、CJK 异体字），所以逐个归一化后做双向子串 + 1 字容错匹配。
 */
function matchesCredits(fileArtist: string, credits: string): boolean | null {
  if (!credits || !fileArtist) return null
  const split = (s: string): string[] =>
    s
      .split('/')
      .map((x) => foldVariants(normalizeName(x.replace(/[（(][^）)]*[）)]/g, ''))))
      .filter(Boolean)
  const a = split(fileArtist)
  const c = split(credits)
  if (a.length === 0 || c.length === 0) return null
  return a.some((x) =>
    c.some((y) => {
      if (x === y || x.includes(y) || y.includes(x)) return true
      // 容忍 1 个字的写法差异，但只对长度 >= 3 的名字，避免短名误配
      return Math.min(x.length, y.length) >= 3 && editDistance(x, y) <= 1
    }),
  )
}

function assessRisk(row: Omit<ReviewRow, 'risk' | 'why'>): { risk: Risk; why: string } {
  // 曲名括号里写着一个组合，判定结果却是另一个 —— 一定有一边错了
  if (row.titleUnitConflict) {
    return { risk: '高', why: `曲名里写着「${row.titleUnitConflict}」，但判定为「${row.unitName}」，两者冲突` }
  }

  // 曲名括号里的组合名与 album 推导结果一致 —— 两个独立信号互相印证，可信
  if (row.titleUnitAgrees) {
    return { risk: '低', why: '曲名括号里的组合名与 album 推导结果一致，两个独立信号互相印证' }
  }

  // 规则自动推导的 album 改写（CANVAS/ECHOES 卷号、(XXX盤) 等），且没有
  // 「原 artist 是作曲/编曲者」的佐证 —— 最可能是我推翻了本来正确的署名
  const ruleDerived = row.source === 'album-series' || row.source === 'album-pattern'
  if (ruleDerived && row.artistIsCreditedStaff !== true) {
    return {
      risk: '高',
      why: '按 album 规则改写了演唱者，但文件 artist 不在作曲/编曲名单里，可能它原本就是正确的演唱者',
    }
  }

  if (row.source === 'override' || row.source === 'album-exact') {
    return { risk: '中', why: '我联网查证后人工指定的，请确认演唱者是否正确' }
  }
  if (row.source === 'seiyuu-table') {
    return { risk: '中', why: '由声优本名推导角色与组合，需确认该曲确实由这些成员演唱' }
  }
  if (row.source === 'artist-cv' || row.source === 'artist-split') {
    return { risk: '中', why: '由多人署名推导组合归属' }
  }
  if (ruleDerived) {
    return { risk: '低', why: '按 album 改写，且文件 artist 确实在作曲/编曲名单里，改写有依据' }
  }
  if (row.source === 'title-paren') {
    return { risk: '低', why: '组合名直接写在曲名括号里' }
  }
  return { risk: '低', why: '文件 artist 本身就是组合名，未做改写' }
}

/** 曲名括号里若出现组合名，与判定结果比对。冲突说明两边至少错一个；一致则互相印证 */
function compareTitleUnit(
  title: string,
  unitId: string | null,
  tables: UnitTables,
): { conflict: string | null; agrees: boolean } {
  const m = title.match(/[（(]\s*([^（()）]+?)\s*Ver\.\s*[）)]/)
  if (!m?.[1]) return { conflict: null, agrees: false }
  const named = tables.aliasToUnit.get(normalizeName(m[1]))
  if (!named) return { conflict: null, agrees: false }
  return named === unitId ? { conflict: null, agrees: true } : { conflict: m[1], agrees: false }
}

const RISK_ORDER: Record<Risk, number> = { 高: 0, 中: 1, 低: 2 }

export async function buildReview(songs: SongMeta[], tables: UnitTables): Promise<ReviewRow[]> {
  const rows = await mapConcurrent(songs, 16, async (s): Promise<ReviewRow> => {
    const lrcCredits = await readCredits(s.mp3Path)
    const titleCmp = compareTitleUnit(s.title, s.unit, tables)
    const base = {
      title: s.title,
      album: s.album,
      fileArtist: s.rawArtist,
      resolvedArtist: s.displayArtist,
      unit: s.unit,
      unitName: s.unit ? (tables.unitById.get(s.unit)?.name ?? s.unit) : null,
      source: s.source,
      lrcCredits,
      artistIsCreditedStaff: matchesCredits(s.rawArtist, lrcCredits),
      titleUnitConflict: titleCmp.conflict,
      titleUnitAgrees: titleCmp.agrees,
    }
    const { risk, why } = assessRisk(base)
    return { risk, why, ...base }
  })

  rows.sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || a.title.localeCompare(b.title, 'ja'))
  return rows
}

function mdEscape(s: string): string {
  return s.replace(/\|/g, '\\|')
}

export async function writeReview(rows: ReviewRow[]): Promise<{ high: number; mid: number; low: number }> {
  await fs.mkdir(ASSETS_ROOT, { recursive: true })
  await fs.writeFile(REVIEW_JSON, JSON.stringify(rows, null, 2), 'utf8')

  const counts = {
    high: rows.filter((r) => r.risk === '高').length,
    mid: rows.filter((r) => r.risk === '中').length,
    low: rows.filter((r) => r.risk === '低').length,
  }

  const lines: string[] = []
  lines.push('# 演唱者判定复核表')
  lines.push('')
  lines.push(
    '曲库里 96 首歌的 ID3 `artist` 填的是**作曲/编曲者**而不是演唱者，我用 album 规则做了改写。',
    '这张表按风险排序，**只需要重点看「高」和「中」两档**。',
    '',
    '判据：`.lrc` 里有 `作曲 :` 行。若文件 artist 与作曲者重合，说明"artist 填的是作曲家"成立，改写有依据；',
    '若不重合，说明我可能推翻了一个本来正确的演唱者署名。',
    '',
    `- 🔴 高风险 **${counts.high}** 首 —— 请逐条确认`,
    `- 🟡 中风险 **${counts.mid}** 首 —— 抽查即可`,
    `- 🟢 低风险 **${counts.low}** 首 —— 基本无需看`,
    '',
    '改错了就编辑 `tools/prepare-audio/data/overrides.json` 的 `byTitle`，再跑 `pnpm assets scan`。',
    '',
  )

  // ── 按组合分组：作为粉丝，扫一遍「这个组合名下有哪些曲子」最容易发现张冠李戴 ──
  lines.push('---')
  lines.push('')
  lines.push('## 按组合分组速查')
  lines.push('')
  lines.push('扫一遍每个组合名下的曲目，看有没有明显不属于它的。发现错误直接记下曲名。')
  lines.push('')

  const byUnit = new Map<string, ReviewRow[]>()
  for (const r of rows) {
    const key = r.unitName ?? '（未归属 / 跨组合）'
    const arr = byUnit.get(key)
    if (arr) arr.push(r)
    else byUnit.set(key, [r])
  }
  const sortedUnits = [...byUnit.entries()].sort((a, b) => b[1].length - a[1].length)
  for (const [unitName, group] of sortedUnits) {
    lines.push(`### ${unitName} — ${group.length} 首`)
    lines.push('')
    for (const r of group.sort((a, b) => a.title.localeCompare(b.title, 'ja'))) {
      const mark = r.risk === '高' ? '🔴 ' : r.risk === '中' ? '🟡 ' : ''
      const changed = r.source.startsWith('album-') || r.source === 'seiyuu-table' || r.source === 'override'
      const note = changed ? `  ←原署名 \`${mdEscape(r.fileArtist)}\`` : ''
      lines.push(`- ${mark}${mdEscape(r.title)}${note}`)
    }
    lines.push('')
  }

  lines.push('---')
  lines.push('')
  lines.push('## 按风险分档明细')
  lines.push('')

  for (const risk of ['高', '中', '低'] as const) {
    const group = rows.filter((r) => r.risk === risk)
    if (group.length === 0) continue
    const icon = risk === '高' ? '🔴' : risk === '中' ? '🟡' : '🟢'
    lines.push(`## ${icon} ${risk}风险（${group.length} 首）`)
    lines.push('')
    lines.push('| 曲名 | 文件里写的 artist | 我判定的演唱者 | 组合 | 依据 | lrc 作曲/編曲 | 专辑 |')
    lines.push('|---|---|---|---|---|---|---|')
    for (const r of group) {
      lines.push(
        `| ${mdEscape(r.title)} | ${mdEscape(r.fileArtist)} | **${mdEscape(r.resolvedArtist)}** | ${mdEscape(r.unitName ?? '—')} | ${r.source} | ${mdEscape(r.lrcCredits || '—')} | ${mdEscape(r.album)} |`,
      )
    }
    lines.push('')
  }

  await fs.writeFile(REVIEW_MD, lines.join('\n'), 'utf8')
  return counts
}
