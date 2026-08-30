import { describe, expect, it } from 'vitest'

import { emotePlaceholderSvg, soloTier, versusTier, SOLO_TIERS, type Outcome } from './grade'

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
})

describe('versusTier', () => {
  const v = (outcome: Outcome, otetsuki: number, margin: number) =>
    versusTier({ outcome, otetsuki, margin }).id

  it('胜 + 零误札 + 大比分 → 完全制圧（三条都命中时优先级最高的那个）', () => {
    expect(v('win', 0, 5)).toBe('perfect')
    expect(v('win', 0, 12)).toBe('perfect')
  })

  it('胜 + 零误札但比分接近 → 无瑕担当', () => {
    expect(v('win', 0, 4)).toBe('clean')
    expect(v('win', 0, 1)).toBe('clean')
  })

  it('胜 + 有误札 + 大比分 → 压倒性胜利', () => {
    expect(v('win', 2, 5)).toBe('dominant')
  })

  it('胜 + 有误札 + 小比分 → 险胜', () => {
    expect(v('win', 3, 1)).toBe('narrow')
  })

  it('平局无视误札与比分', () => {
    expect(v('draw', 0, 0)).toBe('drawn')
    expect(v('draw', 5, 9)).toBe('drawn')
  })

  it('负 + 差距 ≤2 → 惜败，否则修行中', () => {
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
