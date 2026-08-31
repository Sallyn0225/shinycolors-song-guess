/**
 * 战报显示列表。
 *
 * 这里**只算不画**：输入结算数据，输出一串绘制原语（{@link DrawOp}）。
 * 画笔在 `ui/ticketPainter.ts`。
 *
 * 分成两半有两个理由：
 *
 * 1. `features/` 按 spec 是纯逻辑、不碰 DOM，而 `CanvasRenderingContext2D` 是 DOM。
 * 2. 排版计算（截断、对齐、溢出、条目上限）是这类功能里 bug 最集中的地方。
 *    做成数组之后它在 vitest 里就是普通断言，不需要 canvas、不需要浏览器。
 *
 * 文本宽度靠注入的 {@link Measure} 拿：生产传 `ctx.measureText`，测试传假量测。
 */

import { DIFFICULTY_PRESETS, type Difficulty } from '@scg/shared'

import { emoteAssetUrl, emotePlaceholderSvg, soloTier, versusTier, type Outcome, type Tier } from './grade'

// ─────────────────────────────────────────────────────────
// 原语
// ─────────────────────────────────────────────────────────

export type Align = 'left' | 'center' | 'right'

export type DrawOp =
  /** 纸底 + 纸纹噪点。永远是第一条 */
  | { k: 'paper'; w: number; h: number }
  | { k: 'rect'; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; lw?: number }
  | { k: 'rule'; x1: number; y1: number; x2: number; y2: number; color: string; lw: number; dash?: number[] }
  /** y 是基线 */
  | {
      k: 'text'
      x: number
      y: number
      text: string
      font: string
      color: string
      align?: Align
      /** 字距，px。Canvas 没有 letter-spacing，画笔逐字推进 */
      tracking?: number
    }
  /** 竖排。逐字居中，按 step 递增 y */
  | { k: 'vtext'; x: number; y: number; text: string; font: string; color: string; step: number }
  | {
      k: 'image'
      x: number
      y: number
      w: number
      h: number
      src: string
      fit: 'cover' | 'contain'
      /** src 拿不到时改用它。表情正式素材还没做，靠这个兜底 */
      fallback?: string
      /**
       * 把不透明的像素整片换成这个颜色，alpha 原样保留。
       * symbol 只存一份黑色原图，各处按需染色，不必为每个用色再存一个文件。
       */
      tint?: string
    }
  | { k: 'hole'; cx: number; cy: number; r: number }
  /** 四角星／棱镜印记。全站唯一的装饰母题 */
  | { k: 'mark'; cx: number; cy: number; r: number; color: string; lw: number }
  | { k: 'stamp'; cx: number; cy: number; r: number; main: string; ring: string; color: string; rotate: number }
  | { k: 'barcode'; x: number; y: number; w: number; h: number; seed: number; color: string }
  | { k: 'tick'; x: number; y: number; size: number; state: 'ok' | 'miss' | 'skip' }

export type Measure = (text: string, font: string) => number

// ─────────────────────────────────────────────────────────
// 版面常量
// ─────────────────────────────────────────────────────────

/** 逻辑画布。导出时 scale(2) → 1440×2160 */
export const CARD_W = 720
export const CARD_H = 1080

/** 双色。两个主色都从 DESIGN.md 推导，导出图才不会看着像另一个产品的东西 */
export const INK = '#2b2c5e' // crystal-violet-deep 压暗提蓝
export const ACCENT = '#e2669b' // 直接用设计系统的 sub-rose
export const PAPER = '#f5f2ea'

const M = 20 // 外边距
const PERF_X = 548 // 齿孔线
const MAIN = { x: M, y: M, w: PERF_X - 14 - M, h: CARD_H - 2 * M }
const STUB = { x: PERF_X + 14, y: M, w: CARD_W - M - (PERF_X + 14), h: CARD_H - 2 * M }
const PAD = 26
const CX = MAIN.x + PAD // 内容左边界 46
const CW = MAIN.w - 2 * PAD // 内容宽 462
const CR = CX + CW // 内容右边界 508

const latin = (weight: number, size: number) => `${weight} ${size}px Jost, sans-serif`
const jp = (weight: number, size: number) => `${weight} ${size}px "Noto Sans JP", sans-serif`

// ─────────────────────────────────────────────────────────
// 输入
// ─────────────────────────────────────────────────────────

/**
 * 结构上兼容 `api.ts` 的 `ResultItem`，但**不 import 它**——
 * `features/` 只许 import `@scg/shared`，而 `Summary` 住在 `api.ts` 里。
 * 靠 TypeScript 的结构化类型，screen 直接把 `Summary` 传进来就能过。
 */
export interface SoloItemLike {
  index: number
  correct: boolean | null
  elapsedMs: number | null
  song: { id: string; title: string; artist: string }
  chosen: { title: string } | null
}

export interface SoloReportInput {
  playerId: string
  difficulty: Difficulty
  total: number
  correct: number
  avgMs: number
  score: number
  maxScore: number
  items: readonly SoloItemLike[]
  /** 由调用方给，保持本函数是纯的（不读时钟） */
  date: Date
}

export interface VersusSide {
  name: string
  left: number
  taken: number
  otetsuki: number
  avgReactionMs: number | null
  clamped: number
}

export interface VersusReportInput {
  playerId: string
  outcome: Outcome
  /** 胜负原因，页面上已有的那句 */
  reason: string
  rounds: number
  mine: VersusSide
  foe: VersusSide
  date: Date
}

/** ID 留空时图上顶替的文案。不能留白，那看着像渲染坏了 */
export const ANON_ID = '匿名P'

/** 战报上最多列几首曲子。再多字号要压到 10px 以下，聊天软件二次压缩后不可读 */
export const SONG_LIMIT = 5

// ─────────────────────────────────────────────────────────
// 小工具
// ─────────────────────────────────────────────────────────

/** FNV-1a。同一局导出两次条码相同，换一局才变 */
export function barcodeSeed(parts: readonly string[]): number {
  let h = 0x811c9dc5
  for (const p of parts) {
    for (let i = 0; i < p.length; i++) {
      h ^= p.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    h ^= 0x2f // 分隔，免得 ['ab','c'] 和 ['a','bc'] 撞在一起
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** 超宽换省略号。二分找最长能放下的前缀 */
export function truncate(text: string, maxW: number, font: string, m: Measure): string {
  if (m(text, font) <= maxW) return text
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (m(text.slice(0, mid) + '…', font) <= maxW) lo = mid
    else hi = mid - 1
  }
  return text.slice(0, lo) + '…'
}

function idText(raw: string): string {
  const t = raw.trim()
  return t.length > 0 ? t : ANON_ID
}

function dateText(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`
}

function serialText(seed: number): string {
  return `SCG-${String(seed % 100000000).padStart(8, '0')}`
}

export interface ImageRequest {
  src: string
  /** src 失败时退而求其次的地址 */
  fallback?: string
}

/** 收集所有需要预加载的图片。让「要加载什么」和「画什么」只有一处定义 */
export function collectImageRequests(ops: readonly DrawOp[]): ImageRequest[] {
  const seen = new Map<string, ImageRequest>()
  for (const o of ops) {
    if (o.k !== 'image' || seen.has(o.src)) continue
    seen.set(o.src, o.fallback === undefined ? { src: o.src } : { src: o.src, fallback: o.fallback })
  }
  return [...seen.values()]
}

// ─────────────────────────────────────────────────────────
// 共用骨架
// ─────────────────────────────────────────────────────────

interface StubInfo {
  date: Date
  seed: number
  /** 顶部方框里的类别：SOLO / VERSUS */
  kind: string
  /** 段位称号 */
  verdict: string
  /** 種別一行的值：难度名或「対戦」 */
  category: string
}

/** 纸、边框、齿孔、存根、底栏 —— 两种战报完全共用的部分 */
function pushFrame(ops: DrawOp[], info: StubInfo): void {
  const { seed } = info
  ops.push({ k: 'paper', w: CARD_W, h: CARD_H })

  // 主票双线边框：外粗内细，是票据印刷最省事也最有效的一个信号
  ops.push({ k: 'rect', x: MAIN.x, y: MAIN.y, w: MAIN.w, h: MAIN.h, stroke: INK, lw: 2 })
  ops.push({ k: 'rect', x: MAIN.x + 5, y: MAIN.y + 5, w: MAIN.w - 10, h: MAIN.h - 10, stroke: INK, lw: 0.7 })

  // 齿孔：一条虚线 + 一列圆孔。孔画在纸色上，看着像真被打穿了
  ops.push({ k: 'rule', x1: PERF_X, y1: M, x2: PERF_X, y2: CARD_H - M, color: INK, lw: 1, dash: [3, 5] })
  for (let cy = M + 18; cy < CARD_H - M; cy += 34) {
    ops.push({ k: 'hole', cx: PERF_X, cy, r: 4.5 })
  }

  pushStub(ops, info)
  pushFooter(ops, seed)
}

const SL = STUB.x + 9 // 存根内容左边界
const SR = STUB.x + STUB.w - 9 // 右边界
const SX = STUB.x + STUB.w / 2 // 中线

/** 顶部那个描边方框标签 */
function pushStubHead(ops: DrawOp[], kind: string): void {
  ops.push({ k: 'rect', x: SL, y: 40, w: SR - SL, h: 24, stroke: INK, lw: 1 })
  ops.push({
    k: 'text',
    x: SX,
    y: 57,
    text: kind,
    font: latin(700, 11),
    color: INK,
    align: 'center',
    tracking: 2.2,
  })
}

/** 一组 label / value / 分隔线 */
function pushStubRows(
  ops: DrawOp[],
  rows: readonly [string, string][],
  top: number,
  step: number,
  size: number,
): number {
  let y = top
  for (const [k, v] of rows) {
    ops.push({ k: 'text', x: SL, y, text: k, font: latin(600, 10), color: ACCENT, tracking: 1.6 })
    ops.push({ k: 'text', x: SL, y: y + size + 5, text: v, font: latin(600, size), color: INK })
    ops.push({ k: 'rule', x1: SL, y1: y + size + 15, x2: SR, y2: y + size + 15, color: INK, lw: 0.7 })
    y += step
  }
  return y - step + size + 15
}

/** 底部的竖排 wordmark 与三颗星 */
function pushStubFoot(ops: DrawOp[], top: number): void {
  ops.push({ k: 'vtext', x: SX, y: top, text: '猜歌', font: jp(700, 22), color: ACCENT, step: 26 })
  for (let i = 0; i < 3; i++) {
    ops.push({ k: 'mark', cx: SX + (i - 1) * 20, cy: top + 74, r: 6, color: ACCENT, lw: 1.2 })
  }
}

/**
 * 存根。版式取「克制」一路：不把主票的数字再列一遍，
 * 中段交给 symbol，靠字号与节奏撑住整条，而不是靠信息密度。
 *
 * 纵向刻意排满：标题、symbol、判定、三行字段、wordmark、星标各占一段，
 * 空白匀在段与段之间。原来的版本把空白堆在两处（标题下方、编号到底部），
 * 同样的留白量看着就是「没排完」。
 */
function pushStub(ops: DrawOp[], info: StubInfo): void {
  pushStubHead(ops, info.kind)

  ops.push({ k: 'vtext', x: SX, y: 118, text: 'バトルリポート', font: jp(700, 29), color: INK, step: 35 })

  // 官方 symbol，染成粉色。染色而不是备一份粉色图：这一份黑色原图
  // 换个颜色还能用在别处，也不必为每个用色再存一个文件。
  const s = 96
  ops.push({
    k: 'image',
    x: SX - s / 2,
    y: 372,
    w: s,
    h: s,
    src: '/mark/shiny-symbol.png',
    fit: 'contain',
    tint: ACCENT,
  })

  ops.push({
    k: 'text',
    x: SX,
    y: 514,
    text: info.verdict,
    font: jp(700, 18),
    color: INK,
    align: 'center',
  })
  ops.push({ k: 'rule', x1: SL, y1: 542, x2: SR, y2: 542, color: INK, lw: 1 })

  pushStubRows(
    ops,
    [
      ['DATE', dateText(info.date)],
      ['NO.', serialText(info.seed)],
      ['種別', info.category],
    ],
    582,
    72,
    16,
  )

  pushStubFoot(ops, 852)
}

function pushFooter(ops: DrawOp[], seed: number): void {
  const y = 964
  ops.push({ k: 'rule', x1: CX, y1: y, x2: CR, y2: y, color: INK, lw: 1 })

  ops.push({ k: 'text', x: CX, y: y + 30, text: '闪耀色彩 猜歌', font: jp(700, 20), color: INK })
  ops.push({
    k: 'text',
    x: CX,
    y: y + 48,
    text: 'SHINY COLORS SONG QUIZ',
    font: latin(600, 9),
    color: ACCENT,
    tracking: 1.8,
  })

  ops.push({ k: 'barcode', x: CR - 168, y: y + 12, w: 168, h: 34, seed, color: INK })
  ops.push({
    k: 'text',
    x: CR,
    y: y + 58,
    text: serialText(seed),
    font: latin(600, 10),
    color: INK,
    align: 'right',
    tracking: 1.2,
  })
}

/** 头栏：RESULT / リザルト ····· 日期 */
function pushHeader(ops: DrawOp[], date: Date): void {
  ops.push({ k: 'text', x: CX, y: 62, text: 'RESULT', font: latin(700, 20), color: INK, tracking: 2.6 })
  ops.push({ k: 'text', x: CX + 108, y: 62, text: '/ リザルト', font: jp(400, 15), color: INK })
  ops.push({ k: 'text', x: CR, y: 62, text: dateText(date), font: latin(600, 15), color: INK, align: 'right' })
  ops.push({ k: 'rule', x1: CX, y1: 76, x2: CR, y2: 76, color: INK, lw: 1.6 })
}

/** 段位块：表情 + 称号 + 评价。两种战报共用，保证图上和网页说同一句话 */
function pushGrade(ops: DrawOp[], tier: Tier, m: Measure, top: number): number {
  /*
    76 而不是原来的 58：表情从简笔脸换成了带字的贴纸，58px 下角色和图上那两个字
    一起糊成一团色块。上下留白到头了 —— 段位块夹在 y=158 与 y=254 两条分隔线之间，
    76 高从 176 画到 252，再大就压线。
  */
  const size = 76
  // 正式表情在 public/emote/。拿不到就退到内置简笔 SVG——缺图不该在段位块左边留一个洞
  ops.push({
    k: 'image',
    x: CX,
    y: top,
    w: size,
    h: size,
    src: emoteAssetUrl(tier.emote),
    fallback: emotePlaceholderSvg(tier.emote, INK),
    fit: 'contain',
  })

  // 两行文字在放大后的方框里垂直居中，否则称号会贴着表情的头顶
  const tx = CX + size + 18
  ops.push({ k: 'text', x: tx, y: top + 35, text: tier.title, font: jp(700, 25), color: INK })
  ops.push({
    k: 'text',
    x: tx,
    y: top + 59,
    text: truncate(tier.blurb, CR - tx, jp(400, 14), m),
    font: jp(400, 14),
    color: ACCENT,
  })
  return top + size
}

/** 玩家行。联机多一段 vs 对手 */
function pushPlayer(ops: DrawOp[], id: string, m: Measure, foe?: string): void {
  ops.push({ k: 'text', x: CX, y: 104, text: 'PLAYER', font: latin(600, 10), color: ACCENT, tracking: 3 })

  const idFont = latin(700, 28)
  const shown = truncate(idText(id), foe ? 240 : CW, idFont, m)
  ops.push({ k: 'text', x: CX, y: 136, text: shown, font: idFont, color: INK })
  // 手写签名式的下划线，粉色。宽度跟着实际文字走，不是固定值
  const w = m(shown, idFont)
  ops.push({ k: 'rule', x1: CX, y1: 143, x2: CX + w + 6, y2: 143, color: ACCENT, lw: 2.4 })

  if (foe !== undefined) {
    const vsX = CX + Math.max(w + 22, 150)
    ops.push({ k: 'text', x: vsX, y: 136, text: 'vs', font: latin(600, 17), color: ACCENT })
    ops.push({
      k: 'text',
      x: vsX + 30,
      y: 136,
      text: truncate(foe, CR - vsX - 30, jp(700, 21), m),
      font: jp(700, 21),
      color: INK,
    })
  }
}

/** 带引导虚线的一行统计。虚线比逐个数点画「·」更简单，看着一模一样 */
function pushLeaderRow(ops: DrawOp[], m: Measure, y: number, label: string, value: string): void {
  const lf = jp(400, 15)
  const vf = latin(600, 16)
  ops.push({ k: 'text', x: CX, y, text: label, font: lf, color: INK })
  ops.push({ k: 'text', x: CR, y, text: value, font: vf, color: INK, align: 'right' })
  const from = CX + m(label, lf) + 8
  const to = CR - m(value, vf) - 8
  if (to > from) {
    ops.push({ k: 'rule', x1: from, y1: y - 4, x2: to, y2: y - 4, color: INK, lw: 1, dash: [1.5, 4] })
  }
}

function pushStamp(ops: DrawOp[], tier: Tier, cy: number): void {
  ops.push({
    k: 'stamp',
    cx: 436,
    cy,
    r: 54,
    main: tier.stamp,
    ring: 'BATTLE REPORT ★ SONG QUIZ ★',
    color: ACCENT,
    rotate: -0.14,
  })
}

// ─────────────────────────────────────────────────────────
// 单机
// ─────────────────────────────────────────────────────────

export function buildSoloTicket(input: SoloReportInput, m: Measure): DrawOp[] {
  const ops: DrawOp[] = []
  const preset = DIFFICULTY_PRESETS[input.difficulty]
  const tier = soloTier(input.score, input.maxScore)
  const seed = barcodeSeed([idText(input.playerId), dateText(input.date), String(input.score), input.difficulty])

  pushFrame(
    ops,
    {
      date: input.date,
      seed,
      kind: 'SOLO',
      verdict: tier.title,
      category: preset.label,
    },
  )
  pushHeader(ops, input.date)
  pushPlayer(ops, input.playerId, m)
  ops.push({ k: 'rule', x1: CX, y1: 158, x2: CR, y2: 158, color: INK, lw: 0.7 })
  pushGrade(ops, tier, m, 176)

  // ── 得分
  ops.push({ k: 'rule', x1: CX, y1: 254, x2: CR, y2: 254, color: INK, lw: 0.7 })
  ops.push({ k: 'text', x: CX, y: 282, text: 'SCORE', font: latin(600, 10), color: ACCENT, tracking: 3 })

  const scoreFont = latin(700, 78)
  const scoreText = String(input.score)
  ops.push({ k: 'text', x: CX, y: 352, text: scoreText, font: scoreFont, color: INK })
  ops.push({
    k: 'text',
    x: CX + m(scoreText, scoreFont) + 8,
    y: 352,
    text: `/${input.maxScore}`,
    font: latin(600, 26),
    color: INK,
  })
  ops.push({ k: 'text', x: CR, y: 352, text: preset.label, font: jp(700, 19), color: ACCENT, align: 'right' })
  ops.push({ k: 'text', x: CR, y: 330, text: 'DIFFICULTY', font: latin(600, 9), color: INK, align: 'right', tracking: 2 })

  // ── 逐题条
  const n = Math.max(input.items.length, 1)
  const cell = CW / n
  const tickSize = Math.min(24, cell - 4)
  const tickY = 376
  input.items.forEach((it, i) => {
    ops.push({
      k: 'tick',
      x: CX + i * cell + (cell - tickSize) / 2,
      y: tickY,
      size: tickSize,
      state: it.correct === null ? 'skip' : it.correct ? 'ok' : 'miss',
    })
  })
  // 题号只在题目不多时画。20 题时数字挤成一团，反而不如没有
  if (n <= 10) {
    input.items.forEach((it, i) => {
      ops.push({
        k: 'text',
        x: CX + i * cell + cell / 2,
        y: tickY + tickSize + 16,
        text: String(it.index + 1),
        font: latin(600, 11),
        color: INK,
        align: 'center',
      })
    })
  }

  // ── 统计
  const statsTop = n <= 10 ? 438 : 424
  const rate = input.total > 0 ? input.correct / input.total : 0
  const stats: [string, string][] = [
    ['正答', `${input.correct} / ${input.total}`],
    ['正答率', `${Math.round(rate * 100)}%`],
    ['平均用时', `${(input.avgMs / 1000).toFixed(1)}s`],
    ['片段长度', `${preset.clipSeconds}s`],
  ]
  stats.forEach(([k, v], i) => pushLeaderRow(ops, m, statsTop + i * 28, k, v))
  const statsEnd = statsTop + stats.length * 28

  // ── 曲目
  ops.push({ k: 'rule', x1: CX, y1: statsEnd - 12, x2: CR, y2: statsEnd - 12, color: INK, lw: 1 })
  const listTop = statsEnd + 18
  const rowH = 54
  const shown = input.items.slice(0, SONG_LIMIT)

  shown.forEach((it, i) => {
    const top = listTop + i * rowH
    const ok = it.correct === true

    ops.push({
      k: 'text',
      x: CX,
      y: top + 30,
      text: String(it.index + 1).padStart(2, '0'),
      font: latin(700, 20),
      color: ACCENT,
    })
    ops.push({ k: 'image', x: CX + 34, y: top, w: 44, h: 44, src: `/thumb/${it.song.id}.webp`, fit: 'cover' })

    const tx = CX + 90
    const tw = CW - 90 - 96 // 给右侧的判定与用时留位置
    ops.push({
      k: 'text',
      x: tx,
      y: top + 19,
      text: truncate(it.song.title, tw, jp(700, 16), m),
      font: jp(700, 16),
      color: INK,
    })
    const sub = it.chosen && !ok ? `你选了：${it.chosen.title}` : it.song.artist
    ops.push({
      k: 'text',
      x: tx,
      y: top + 38,
      text: truncate(sub, tw, jp(400, 12), m),
      font: jp(400, 12),
      color: ok ? INK : ACCENT,
    })

    ops.push({
      k: 'text',
      x: CR,
      y: top + 19,
      text: ok ? '正解' : it.correct === null ? '未答' : '不正解',
      font: jp(700, 13),
      color: ok ? INK : ACCENT,
      align: 'right',
    })
    if (it.elapsedMs !== null) {
      ops.push({
        k: 'text',
        x: CR,
        y: top + 37,
        text: `${(it.elapsedMs / 1000).toFixed(1)}s`,
        font: latin(600, 12),
        color: INK,
        align: 'right',
      })
    }
    ops.push({
      k: 'rule',
      x1: CX,
      y1: top + rowH - 6,
      x2: CR,
      y2: top + rowH - 6,
      color: INK,
      lw: 0.7,
      dash: [2, 3],
    })
  })

  const rest = input.items.length - shown.length
  if (rest > 0) {
    ops.push({
      k: 'text',
      x: CX,
      y: listTop + shown.length * rowH + 18,
      text: `他 ${rest} 曲`,
      font: jp(400, 13),
      color: INK,
    })
  }

  pushStamp(ops, tier, 906)
  return ops
}

// ─────────────────────────────────────────────────────────
// 联机
// ─────────────────────────────────────────────────────────

const OUTCOME_GLYPH: Record<Outcome, string> = { win: '勝', draw: '引分', loss: '負' }

export function buildVersusTicket(input: VersusReportInput, m: Measure): DrawOp[] {
  const ops: DrawOp[] = []
  const margin = Math.abs(input.foe.left - input.mine.left)
  const tier = versusTier({ outcome: input.outcome, otetsuki: input.mine.otetsuki, margin })
  const seed = barcodeSeed([
    idText(input.playerId),
    input.foe.name,
    dateText(input.date),
    input.outcome,
    String(input.rounds),
  ])

  pushFrame(
    ops,
    {
      date: input.date,
      seed,
      kind: 'VERSUS',
      verdict: tier.title,
      category: '対戦',
    },
  )
  pushHeader(ops, input.date)
  pushPlayer(ops, input.playerId, m, input.foe.name)
  ops.push({ k: 'rule', x1: CX, y1: 158, x2: CR, y2: 158, color: INK, lw: 0.7 })
  pushGrade(ops, tier, m, 176)

  // ── 胜负
  ops.push({ k: 'rule', x1: CX, y1: 254, x2: CR, y2: 254, color: INK, lw: 0.7 })
  ops.push({ k: 'text', x: CX, y: 282, text: 'MATCH', font: latin(600, 10), color: ACCENT, tracking: 3 })

  const glyph = OUTCOME_GLYPH[input.outcome]
  const glyphFont = jp(700, input.outcome === 'draw' ? 54 : 78)
  ops.push({ k: 'text', x: CX, y: 352, text: glyph, font: glyphFont, color: INK })

  const rx = CX + m(glyph, glyphFont) + 20
  ops.push({
    k: 'text',
    x: rx,
    y: 330,
    text: truncate(input.reason, CR - rx, jp(400, 14), m),
    font: jp(400, 14),
    color: INK,
  })
  ops.push({ k: 'text', x: rx, y: 352, text: `${input.rounds} 回合`, font: jp(700, 17), color: ACCENT })

  // ── 对比表
  const tableTop = 396
  ops.push({ k: 'rule', x1: CX, y1: tableTop, x2: CR, y2: tableTop, color: INK, lw: 1.6 })

  const colYou = CX + CW * 0.68
  const colFoe = CR
  ops.push({ k: 'text', x: colYou, y: tableTop + 24, text: '你', font: jp(700, 13), color: ACCENT, align: 'right' })
  ops.push({
    k: 'text',
    x: colFoe,
    y: tableTop + 24,
    text: truncate(input.foe.name, CW * 0.28, jp(700, 13), m),
    font: jp(700, 13),
    color: ACCENT,
    align: 'right',
  })

  const ms = (v: number | null) => (v === null ? '—' : `${v}ms`)
  const rows: [string, string, string][] = [
    ['剩余自陣', String(input.mine.left), String(input.foe.left)],
    ['取牌', String(input.mine.taken), String(input.foe.taken)],
    ['お手つき', String(input.mine.otetsuki), String(input.foe.otetsuki)],
    ['平均反应', ms(input.mine.avgReactionMs), ms(input.foe.avgReactionMs)],
  ]
  /*
    行高 68、数值 26px：联机票没有曲目清单，信息量只有单机的一半。
    照单机的密度排，下半张会空出三百多像素的白 —— 那不是留白，是没排满。
    把这张票仅有的四组数字放大占满，反而更像一张战报。
  */
  const rowH = 68
  rows.forEach(([label, a, b], i) => {
    const y = tableTop + 68 + i * rowH
    ops.push({ k: 'text', x: CX, y, text: label, font: jp(400, 16), color: INK })
    ops.push({ k: 'text', x: colYou, y, text: a, font: latin(700, 26), color: INK, align: 'right' })
    ops.push({ k: 'text', x: colFoe, y, text: b, font: latin(600, 26), color: INK, align: 'right' })
    ops.push({
      k: 'rule',
      x1: CX,
      y1: y + 20,
      x2: CR,
      y2: y + 20,
      color: INK,
      lw: 0.7,
      dash: [2, 3],
    })
  })

  // 表格最后一行的分隔线所在，也是「没有校正提示时」的内容底部
  let bottom = tableTop + 68 + (rows.length - 1) * rowH + 20

  // ── 校正公示。页面上已经公示了，图上不写就等于换个地方把它藏起来
  const clampedTop = tableTop + 68 + rows.length * rowH + 28
  if (input.mine.clamped > 0 || input.foe.clamped > 0) {
    bottom = clampedTop + 34
    ops.push({
      k: 'rect',
      x: CX,
      y: clampedTop - 18,
      w: CW,
      h: 52,
      stroke: ACCENT,
      lw: 0.8,
    })
    ops.push({
      k: 'text',
      x: CX + 12,
      y: clampedTop + 4,
      text: '反应时间被服务端校正',
      font: jp(700, 12),
      color: ACCENT,
    })
    ops.push({
      k: 'text',
      x: CX + 12,
      y: clampedTop + 24,
      text: truncate(
        `你 ${input.mine.clamped} 次 · ${input.foe.name} ${input.foe.clamped} 次`,
        CW - 24,
        jp(400, 12),
        m,
      ),
      font: jp(400, 12),
      color: INK,
    })
  }

  /*
    印章跟着内容底部走，不写死。
    校正提示是可选区块（只在服务端真校正过时才有），写死位置的话，
    没有它的那一局下半张就空出一百多像素 —— 排版不该隐含依赖一个可能不出现的块。
    上限 892 是为了不压到底栏那条线。
  */
  pushStamp(ops, tier, Math.min(bottom + 94, 892))
  return ops
}
