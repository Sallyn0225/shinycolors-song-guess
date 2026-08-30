/**
 * 战报预览页的入口。开发期专用，**不进构建产物** ——
 * Vite 的 build input 只有 `index.html`，而这个模块没有任何生产代码引用。
 *
 * 存在的理由：战报是画在 canvas 上的，改完排版没有别的办法看见效果，
 * 除非真去打一局。用法与取证脚本见 `tools/ticket-preview/README.md`。
 *
 * 固定用 2026-08-31 这个日期、固定的假数据：预览要能逐像素比对，
 * 读一次 `new Date()` 就会让每天的截图都不一样，diff 全是噪声。
 */
import type { Difficulty } from '@scg/shared'

import {
  buildSoloTicket,
  buildVersusTicket,
  collectImageRequests,
  type DrawOp,
  type Measure,
  type SoloItemLike,
} from '../features/shareCard'
import { ensureFonts, loadImages, paintTicket, prepareCanvas } from '../ui/ticketPainter'

const DATE = new Date(2026, 7, 31)

const TITLES = [
  'アルストロメリア',
  'Fluorite',
  '光,END ROLLに知らない名前があるなら',
  'Multicolored Sky',
  'ヒカリのdestination',
  'なんどでも笑おう',
  'Pierrot',
  'ビヨンド・ザ・ジャーニー',
  'かがやきの向こう側へ！',
  'Wandering Dream Chaser',
]
const ARTISTS = [
  'イルミネーションスターズ',
  '放課後クライマックスガールズ',
  'アルストロメリア',
  'アンティーカ',
  'シーズ',
  'ノクチル',
]

interface ItemSpec {
  /** 答错的题号 */
  wrong?: number[]
  /** 未作答的题号 */
  skip?: number[]
  /** 所有曲名换成这一个（长曲名截断压力测试用） */
  title?: string
}

function items(n: number, spec: ItemSpec = {}): SoloItemLike[] {
  const wrong = spec.wrong ?? []
  const skip = spec.skip ?? []
  return Array.from({ length: n }, (_, i) => ({
    index: i,
    correct: skip.includes(i) ? null : wrong.includes(i) ? false : true,
    // 用固定的伪随机，别用 Math.random —— 每次刷新都变就没法比对
    elapsedMs: skip.includes(i) ? null : 1800 + ((i * 517) % 4200),
    song: {
      id: `dev${i}`,
      title: spec.title ?? TITLES[i % TITLES.length]!,
      artist: ARTISTS[i % ARTISTS.length]!,
    },
    chosen: wrong.includes(i) ? { title: 'Spread the Wings!!' } : null,
  }))
}

function solo(o: {
  playerId?: string
  difficulty: Difficulty
  total: number
  correct: number
  avgMs: number
  score: number
  maxScore: number
  items: SoloItemLike[]
}) {
  return (m: Measure): DrawOp[] => buildSoloTicket({ playerId: 'sallyn', date: DATE, ...o }, m)
}

export interface PreviewCase {
  id: string
  /** 页面上显示的说明：这一张在盯什么 */
  note: string
  build: (m: Measure) => DrawOp[]
}

/**
 * 每一张都对应一类会出问题的排版，不是为了好看才摆在这里。
 * 加新用例时请一并写清楚它在盯什么。
 */
export const CASES: PreviewCase[] = [
  {
    id: 'solo-easy',
    note: '简单：10 题、满分 2000。逐题格带题号，曲目 5 首 + 他 5 曲',
    build: solo({
      difficulty: 'easy',
      total: 10,
      correct: 8,
      avgMs: 3240,
      score: 1420,
      maxScore: 2000,
      items: items(10, { wrong: [3], skip: [7] }),
    }),
  },
  {
    id: 'solo-hard',
    note: '困难：20 题、满分 4000。逐题格缩到 ~19px 且不再画题号，曲目折成他 15 曲',
    build: solo({
      difficulty: 'hard',
      total: 20,
      correct: 15,
      avgMs: 4180,
      score: 2680,
      maxScore: 4000,
      items: items(20, { wrong: [2, 9, 13, 17], skip: [19] }),
    }),
  },
  {
    id: 'solo-perfect',
    note: '满分：最高段位 + 完璧印章，逐题格全对。分数是四位数里最宽的一种',
    build: solo({
      difficulty: 'hard',
      total: 20,
      correct: 20,
      avgMs: 1480,
      score: 4000,
      maxScore: 4000,
      items: items(20),
    }),
  },
  {
    id: 'solo-zero',
    note: '零分且 maxScore=0 的边界：不能画出 NaN，段位要落到最低段',
    build: solo({
      difficulty: 'easy',
      total: 0,
      correct: 0,
      avgMs: 0,
      score: 0,
      maxScore: 0,
      items: [],
    }),
  },
  {
    id: 'solo-overflow',
    note: '截断压力：16 字满长 ID + 每首都是超长曲名，全部该收在省略号里',
    build: solo({
      playerId: 'ロングロングロングID',
      difficulty: 'easy',
      total: 10,
      correct: 6,
      avgMs: 5200,
      score: 980,
      maxScore: 2000,
      items: items(10, {
        wrong: [1, 4, 8],
        title: '光,END ROLLに知らない名前があるなら それはきっと私のこと',
      }),
    }),
  },
  {
    id: 'versus-win',
    note: '联机胜：无曲目清单、无逐题格，四行对比表撑满下半张',
    build: (m) =>
      buildVersusTicket(
        {
          playerId: 'sallyn',
          outcome: 'win',
          reason: 'sallyn 先清空自陣',
          rounds: 18,
          mine: { name: 'sallyn', left: 0, taken: 9, otetsuki: 1, avgReactionMs: 824, clamped: 0 },
          foe: { name: 'ハムスター', left: 6, taken: 4, otetsuki: 3, avgReactionMs: 1147, clamped: 2 },
          date: DATE,
        },
        m,
      ),
  },
  {
    id: 'versus-loss',
    note: '联机负 + 平均反应缺值：破折号而不是 null，且不画校正框',
    build: (m) =>
      buildVersusTicket(
        {
          playerId: 'sallyn',
          outcome: 'loss',
          reason: 'ハムスター 先清空自陣',
          rounds: 22,
          mine: { name: 'sallyn', left: 5, taken: 7, otetsuki: 4, avgReactionMs: null, clamped: 0 },
          foe: { name: 'ハムスター', left: 0, taken: 12, otetsuki: 1, avgReactionMs: 903, clamped: 0 },
          date: DATE,
        },
        m,
      ),
  },
  {
    id: 'versus-draw',
    note: '联机平局：胜负字是两个字而不是一个，字号要换小一档才不撞到右边',
    build: (m) =>
      buildVersusTicket(
        {
          playerId: 'sallyn',
          outcome: 'draw',
          reason: '对局结束',
          rounds: 24,
          mine: { name: 'sallyn', left: 3, taken: 8, otetsuki: 2, avgReactionMs: 950, clamped: 0 },
          foe: { name: 'ハムスター', left: 3, taken: 8, otetsuki: 2, avgReactionMs: 961, clamped: 0 },
          date: DATE,
        },
        m,
      ),
  },
]

function measurerFor(ctx: CanvasRenderingContext2D): Measure {
  return (text, font) => {
    ctx.font = font
    return ctx.measureText(text).width
  }
}

/** 把一个用例画到给定 canvas，并把它的显示列表返回给取证脚本 */
async function render(c: PreviewCase, canvas: HTMLCanvasElement): Promise<DrawOp[]> {
  const ctx = prepareCanvas(canvas)
  if (!ctx) throw new Error('拿不到 2d context')
  const ops = c.build(measurerFor(ctx))
  paintTicket(ctx, ops, await loadImages(collectImageRequests(ops)))
  return ops
}

async function main(): Promise<void> {
  // 字体没就位就画，会按回退字体的宽度排版，量出来的每个数都是错的
  await ensureFonts()

  const only = new URLSearchParams(location.search).get('case')
  const cases = only ? CASES.filter((c) => c.id === only) : CASES
  const root = document.getElementById('cases')!
  const ops: Record<string, DrawOp[]> = {}

  for (const c of cases) {
    const fig = document.createElement('figure')
    const canvas = document.createElement('canvas')
    canvas.dataset['case'] = c.id
    const cap = document.createElement('figcaption')
    cap.innerHTML = `<b>${c.id}</b><span>${c.note}</span>`
    fig.append(canvas, cap)
    root.append(fig)
    ops[c.id] = await render(c, canvas)
  }

  // 取证脚本从这里取显示列表做断言，不必自己再构一遍
  ;(window as unknown as { __ticketOps: Record<string, DrawOp[]> }).__ticketOps = ops
  document.body.dataset['ready'] = 'true'
}

void main()
