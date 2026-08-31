import { describe, expect, it } from 'vitest'

import {
  emotePlaceholderSvg,
  soloTier,
  versusTier,
  SOLO_TIERS,
  VERSUS_TIERS,
  type Outcome,
} from './grade'

describe('soloTier', () => {
  // 边界值是这种分段函数唯一会出错的地方：写 > 还是 >= 决定了满分算不算最高段
  it.each([
    [1.0, 'omniscient'],
    [0.95, 'omniscient'],
    [0.9499, 'ace'],
    [0.85, 'ace'],
    [0.8499, 'veteran'],
    [0.7, 'veteran'],
    [0.6999, 'apprentice'],
    [0.5, 'apprentice'],
    [0.4999, 'rookie'],
    [0.25, 'rookie'],
    [0.2499, 'newcomer'],
    [0, 'newcomer'],
  ])('得分率 %f 落在 %s', (rate, id) => {
    expect(soloTier(rate * 2000, 2000).id).toBe(id)
  })

  // 0/0 会算出 NaN，而 NaN >= min 恒为 false —— 不特判的话 find 全落空
  it('maxScore 为 0 时按最低段', () => {
    expect(soloTier(0, 0).id).toBe('newcomer')
    expect(soloTier(500, 0).id).toBe('newcomer')
  })

  it('每段都有称号、评价和表情', () => {
    for (const t of SOLO_TIERS) {
      expect(t.title.length).toBeGreaterThan(0)
      expect(t.blurb.length).toBeGreaterThan(0)
      expect(t.emote.length).toBeGreaterThan(0)
    }
  })

  /*
    称号会原样印在战报存根的「判定」一行，那条竖栏内容宽只有 122px，
    18px 的中日文按每字约 18px 算，6 字就到顶。写长一点不会报错，
    只会安静地顶进齿孔里去。印章的二字判定同理，超过 2 字画笔会自动换小字号。
  */
  it('称号不超过 6 字、印章判定不超过 3 字 —— 存根那条竖栏放不下更多', () => {
    for (const t of [...SOLO_TIERS, ...VERSUS_TIERS]) {
      expect([...t.title].length, `称号「${t.title}」太长`).toBeLessThanOrEqual(6)
      expect([...t.stamp].length, `印章「${t.stamp}」太长`).toBeLessThanOrEqual(3)
    }
  })

  /*
    评价印在战报段位块里，可用宽度 CR - (CX + 76 + 18) = 368px。14px 中日文
    按每字 14px 算，26 字到顶，超出的部分被 truncate() 悄悄切成「…」——
    页面上能读完整，图上读一半，而且不会报错。留一字余量取 25。
  */
  it('评价不超过 25 字 —— 再长战报上会被截断', () => {
    for (const t of [...SOLO_TIERS, ...VERSUS_TIERS]) {
      expect([...t.blurb].length, `评价「${t.blurb}」太长`).toBeLessThanOrEqual(25)
    }
  })
})

describe('versusTier', () => {
  const v = (outcome: Outcome, otetsuki: number, margin: number) =>
    versusTier({ outcome, otetsuki, margin }).id

  it('胜 + 零误札 + 大比分 → 秒杀（三条都命中时优先级最高的那个）', () => {
    expect(v('win', 0, 5)).toBe('perfect')
    expect(v('win', 0, 12)).toBe('perfect')
  })

  it('胜 + 零误札但比分接近 → 完璧无瑕', () => {
    expect(v('win', 0, 4)).toBe('clean')
    expect(v('win', 0, 1)).toBe('clean')
  })

  it('胜 + 有误札 + 大比分 → 手拿把掐', () => {
    expect(v('win', 2, 5)).toBe('dominant')
  })

  it('胜 + 有误札 + 小比分 → 拿下', () => {
    expect(v('win', 3, 1)).toBe('narrow')
  })

  it('平局无视误札与比分', () => {
    expect(v('draw', 0, 0)).toBe('drawn')
    expect(v('draw', 5, 9)).toBe('drawn')
  })

  it('负 + 差距 ≤2 → 可惜兄弟可惜，否则流脓了', () => {
    expect(v('loss', 0, 2)).toBe('close')
    expect(v('loss', 0, 3)).toBe('defeat')
    expect(v('loss', 4, 11)).toBe('defeat')
  })

  it('输了不会因为零误札就拿到胜方段位', () => {
    expect(v('loss', 0, 8)).toBe('defeat')
  })
})

describe('emotePlaceholderSvg', () => {
  it('返回可直接用作 img src 的 data URI', () => {
    const uri = emotePlaceholderSvg('starry')
    expect(uri.startsWith('data:image/svg+xml,')).toBe(true)
    expect(decodeURIComponent(uri)).toContain('<svg')
  })

  it('六个表情各不相同', () => {
    const ids = ['starry', 'grin', 'smile', 'neutral', 'sweat', 'blank'] as const
    const set = new Set(ids.map((i) => emotePlaceholderSvg(i)))
    expect(set.size).toBe(6)
  })

  it('颜色可换，换了就出现在输出里', () => {
    expect(decodeURIComponent(emotePlaceholderSvg('grin', '#e2669b'))).toContain('#e2669b')
  })
})
