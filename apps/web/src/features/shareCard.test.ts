import { describe, expect, it } from 'vitest'

import {
  ANON_ID,
  SONG_LIMIT,
  barcodeSeed,
  buildSoloTicket,
  buildVersusTicket,
  collectImageRequests,
  truncate,
  type DrawOp,
  type Measure,
  type SoloItemLike,
  type SoloReportInput,
  type VersusReportInput,
} from './shareCard'

/**
 * 假量测：每个字符 10px，与字号无关。
 * 真 `measureText` 在 vitest 里拿不到，而排版逻辑要验的是「在什么宽度上截断」，
 * 不是「Jost 的 a 有多宽」——固定宽度反而让断言能写死。
 */
const m: Measure = (t) => t.length * 10

const DATE = new Date(2026, 7, 31) // 2026.08.31，月份从 0 数

function item(i: number, over: Partial<SoloItemLike> = {}): SoloItemLike {
  return {
    index: i,
    correct: true,
    elapsedMs: 3200,
    song: { id: `s${i}`, title: `曲目${i}`, artist: `艺人${i}` },
    chosen: null,
    ...over,
  }
}

function solo(over: Partial<SoloReportInput> = {}): SoloReportInput {
  return {
    playerId: 'sallyn',
    difficulty: 'easy',
    total: 10,
    correct: 8,
    avgMs: 3200,
    score: 1420,
    maxScore: 2000,
    items: Array.from({ length: 10 }, (_, i) => item(i)),
    date: DATE,
    ...over,
  }
}

function versus(over: Partial<VersusReportInput> = {}): VersusReportInput {
  return {
    playerId: 'sallyn',
    outcome: 'win',
    reason: 'sallyn 先清空自陣',
    rounds: 18,
    mine: { name: 'sallyn', left: 0, taken: 9, otetsuki: 1, avgReactionMs: 820, clamped: 0 },
    foe: { name: '对手', left: 6, taken: 4, otetsuki: 3, avgReactionMs: 1140, clamped: 0 },
    date: DATE,
    ...over,
  }
}

const texts = (ops: DrawOp[]) =>
  ops.filter((o): o is Extract<DrawOp, { k: 'text' }> => o.k === 'text').map((o) => o.text)

const srcs = (ops: DrawOp[]) => collectImageRequests(ops).map((r) => r.src)

describe('truncate', () => {
  it('放得下就原样返回', () => {
    expect(truncate('abc', 100, 'f', m)).toBe('abc')
  })

  it('放不下时截到最长能放下的前缀 + 省略号', () => {
    // 每字符 10px：50px 只能放 5 个字符，其中一个要留给「…」
    expect(truncate('abcdefghij', 50, 'f', m)).toBe('abcd…')
  })

  it('宽度小到连一个省略号都放不下时返回纯省略号', () => {
    expect(truncate('abcdef', 5, 'f', m)).toBe('…')
  })
})

describe('barcodeSeed', () => {
  it('同样的输入给同样的种子 —— 同一局导出两次条码相同', () => {
    expect(barcodeSeed(['a', 'b'])).toBe(barcodeSeed(['a', 'b']))
  })

  it('换 ID 就换种子', () => {
    expect(barcodeSeed(['sallyn', 'x'])).not.toBe(barcodeSeed(['other', 'x']))
  })

  it('分段不会因为拼接方式相同而撞车', () => {
    expect(barcodeSeed(['ab', 'c'])).not.toBe(barcodeSeed(['a', 'bc']))
  })

  it('永远是 32 位无符号整数', () => {
    const s = barcodeSeed(['字符串', '很长的一段内容用来撑一下'])
    expect(Number.isInteger(s)).toBe(true)
    expect(s).toBeGreaterThanOrEqual(0)
    expect(s).toBeLessThanOrEqual(0xffffffff)
  })
})

describe('buildSoloTicket', () => {
  it('逐题三态各自映射到对应的 tick', () => {
    const ops = buildSoloTicket(
      solo({
        items: [
          item(0, { correct: true }),
          item(1, { correct: false }),
          item(2, { correct: null, elapsedMs: null }),
        ],
        total: 3,
      }),
      m,
    )
    const ticks = ops.filter((o): o is Extract<DrawOp, { k: 'tick' }> => o.k === 'tick')
    expect(ticks.map((t) => t.state)).toEqual(['ok', 'miss', 'skip'])
  })

  it(`曲目多于 ${SONG_LIMIT} 首时只列前 ${SONG_LIMIT} 首并注明剩余`, () => {
    const ops = buildSoloTicket(
      solo({ items: Array.from({ length: 12 }, (_, i) => item(i)), total: 12 }),
      m,
    )
    const thumbs = srcs(ops).filter((s) => s.startsWith('/thumb/'))
    expect(thumbs).toHaveLength(SONG_LIMIT)
    expect(texts(ops)).toContain('他 7 曲')
  })

  it('曲目正好不超上限时不写「他 N 曲」', () => {
    const ops = buildSoloTicket(solo({ items: [item(0), item(1)], total: 2 }), m)
    expect(texts(ops).some((t) => t.startsWith('他 '))).toBe(false)
  })

  it('题号只在题目不多于 10 道时画', () => {
    const few = buildSoloTicket(solo({ items: Array.from({ length: 10 }, (_, i) => item(i)) }), m)
    const many = buildSoloTicket(
      solo({ items: Array.from({ length: 20 }, (_, i) => item(i)), total: 20 }),
      m,
    )
    // 20 题时 tick 仍然是 20 个，只是不再逐个标号
    expect(many.filter((o) => o.k === 'tick')).toHaveLength(20)
    const numbered = (ops: DrawOp[]) =>
      ops.filter((o) => o.k === 'text' && o.align === 'center' && /^\d+$/.test(o.text)).length
    expect(numbered(few)).toBe(10)
    expect(numbered(many)).toBe(0)
  })

  it('20 题时 tick 不会超出内容宽度', () => {
    const ops = buildSoloTicket(
      solo({ items: Array.from({ length: 20 }, (_, i) => item(i)), total: 20 }),
      m,
    )
    const ticks = ops.filter((o): o is Extract<DrawOp, { k: 'tick' }> => o.k === 'tick')
    const last = ticks[ticks.length - 1]!
    expect(last.x + last.size).toBeLessThanOrEqual(508) // CR
    expect(ticks.every((t) => t.size > 0)).toBe(true)
  })

  it('ID 留空时图上是占位文案，不是空字符串', () => {
    expect(texts(buildSoloTicket(solo({ playerId: '   ' }), m))).toContain(ANON_ID)
  })

  it('答错时副行显示玩家选了什么', () => {
    const ops = buildSoloTicket(
      solo({ items: [item(0, { correct: false, chosen: { title: '别的曲子' } })], total: 1 }),
      m,
    )
    expect(texts(ops).some((t) => t.includes('你选了：别的曲子'))).toBe(true)
  })

  it('答对时副行是艺人名而不是「你选了」', () => {
    const ops = buildSoloTicket(
      solo({ items: [item(0, { correct: true, chosen: { title: '别的曲子' } })], total: 1 }),
      m,
    )
    expect(texts(ops).some((t) => t.includes('你选了'))).toBe(false)
    expect(texts(ops)).toContain('艺人0')
  })

  it('段位的称号、评价与印章都进了图', () => {
    // 1420/2000 = 71% → 资深P
    const t = texts(buildSoloTicket(solo(), m))
    expect(t).toContain('资深P')
    expect(t).toContain('熟得很，只在冷门曲上栽跟头')
    const stamp = buildSoloTicket(solo(), m).find(
      (o): o is Extract<DrawOp, { k: 'stamp' }> => o.k === 'stamp',
    )
    expect(stamp?.main).toBe('合格')
  })

  it('maxScore 为 0 的局不会画出 NaN', () => {
    const t = texts(buildSoloTicket(solo({ score: 0, maxScore: 0, total: 0, items: [] }), m))
    expect(t.some((s) => s.includes('NaN'))).toBe(false)
  })

  it('第一条永远是纸底', () => {
    expect(buildSoloTicket(solo(), m)[0]).toMatchObject({ k: 'paper' })
  })

  // 正式表情素材还没做，/emote/*.webp 现在必然 404。没有 fallback 的话
  // 段位块左边就是一个洞 —— 而且不会有任何报错告诉你
  it('表情图带着占位 SVG 作为 fallback', () => {
    const emote = collectImageRequests(buildSoloTicket(solo(), m)).find((r) =>
      r.src.startsWith('/emote/'),
    )
    expect(emote?.fallback?.startsWith('data:image/svg+xml,')).toBe(true)
  })

  it('封面没有 fallback —— 缺了就不画，不该拿表情去顶', () => {
    const thumb = collectImageRequests(buildSoloTicket(solo(), m)).find((r) =>
      r.src.startsWith('/thumb/'),
    )
    expect(thumb?.fallback).toBeUndefined()
  })
})

describe('buildVersusTicket', () => {
  it('联机票里没有逐题条，也没有曲目缩略图 —— 联机端根本没这两项数据', () => {
    const ops = buildVersusTicket(versus(), m)
    expect(ops.some((o) => o.k === 'tick')).toBe(false)
    expect(srcs(ops).some((s) => s.startsWith('/thumb/'))).toBe(false)
  })

  it('四项对比都在，且两侧数值都画了', () => {
    const t = texts(buildVersusTicket(versus(), m))
    for (const label of ['剩余自陣', '取牌', 'お手つき', '平均反应']) expect(t).toContain(label)
    expect(t).toContain('820ms')
    expect(t).toContain('1140ms')
  })

  it('平均反应为 null 时画破折号而不是 null', () => {
    const t = texts(
      buildVersusTicket(versus({ mine: { ...versus().mine, avgReactionMs: null } }), m),
    )
    expect(t).toContain('—')
    expect(t.some((s) => s.includes('null'))).toBe(false)
  })

  it('没有校正时不画校正框', () => {
    const t = texts(buildVersusTicket(versus(), m))
    expect(t.some((s) => s.includes('校正'))).toBe(false)
  })

  it('有校正时把双方次数都写进图 —— 页面公示了，图上不能藏起来', () => {
    const v = versus()
    const t = texts(
      buildVersusTicket({ ...v, mine: { ...v.mine, clamped: 2 }, foe: { ...v.foe, clamped: 1 } }, m),
    )
    expect(t.some((s) => s.includes('反应时间被服务端校正'))).toBe(true)
    expect(t.some((s) => s.includes('你 2 次') && s.includes('1 次'))).toBe(true)
  })

  it('胜负字与段位随结果变化', () => {
    // 赢，有 1 次误札所以不是「无瑕」，剩余差 6-0=6 ≥5 所以是「压倒性胜利」
    const win = texts(buildVersusTicket(versus(), m))
    expect(win).toContain('勝')
    expect(win).toContain('压倒性胜利')

    // 同样是赢，把差距收窄到 1 张就掉到「险胜」—— margin 确实参与了判定
    const narrow = texts(buildVersusTicket(versus({ foe: { ...versus().foe, left: 1 } }), m))
    expect(narrow).toContain('险胜')

    const draw = texts(buildVersusTicket(versus({ outcome: 'draw' }), m))
    expect(draw).toContain('引分')
    expect(draw).toContain('平分秋色')

    const loss = texts(
      buildVersusTicket(
        versus({
          outcome: 'loss',
          mine: { ...versus().mine, left: 6 },
          foe: { ...versus().foe, left: 5 },
        }),
        m,
      ),
    )
    expect(loss).toContain('負')
    expect(loss).toContain('惜败')
  })

  it('对手昵称出现在表头与对阵行', () => {
    const t = texts(buildVersusTicket(versus({ foe: { ...versus().foe, name: '玄野' } }), m))
    expect(t.filter((s) => s.includes('玄野')).length).toBeGreaterThanOrEqual(2)
  })

  it('段位表情图进了预加载清单', () => {
    expect(srcs(buildVersusTicket(versus(), m)).some((s) => s.startsWith('/emote/'))).toBe(true)
  })
})
