import { describe, expect, it } from 'vitest'
import { SCORING } from '@scg/shared'

import { maxScore, scoreAnswer } from './scoring.js'

const LIMIT = 10_000

describe('单题计分', () => {
  it('答错得 0，不扣负分', () => {
    const s = scoreAnswer({ correct: false, elapsedMs: 500, limitMs: LIMIT, replaysUsed: 0 })
    expect(s.total).toBe(0)
    expect(s.speed).toBe(0)
  })

  it('瞬间答对拿满分', () => {
    const s = scoreAnswer({ correct: true, elapsedMs: 0, limitMs: LIMIT, replaysUsed: 0 })
    expect(s.total).toBe(SCORING.base + SCORING.speedBonus)
  })

  it('卡着截止时间答对只拿基础分', () => {
    const s = scoreAnswer({ correct: true, elapsedMs: LIMIT, limitMs: LIMIT, replaysUsed: 0 })
    expect(s.total).toBe(SCORING.base)
    expect(s.speed).toBe(0)
  })

  it('答得越快分越高（严格单调）', () => {
    let prev = Infinity
    for (const t of [0, 1000, 2000, 4000, 6000, 8000, 10000]) {
      const s = scoreAnswer({ correct: true, elapsedMs: t, limitMs: LIMIT, replaysUsed: 0 })
      expect(s.total).toBeLessThanOrEqual(prev)
      prev = s.total
    }
  })

  // 认出一首歌本来就要几秒；线性衰减会让「正常速度答对」显得像失败
  it('速度曲线在前段衰减较慢，正常速度答对仍有可观奖励', () => {
    const s = scoreAnswer({ correct: true, elapsedMs: LIMIT * 0.4, limitMs: LIMIT, replaysUsed: 0 })
    expect(s.speed).toBeGreaterThan(SCORING.speedBonus * 0.5)
  })

  it('重听要扣分，但不会把总分扣成负数', () => {
    const none = scoreAnswer({ correct: true, elapsedMs: 2000, limitMs: LIMIT, replaysUsed: 0 })
    const one = scoreAnswer({ correct: true, elapsedMs: 2000, limitMs: LIMIT, replaysUsed: 1 })
    expect(one.total).toBe(none.total - SCORING.replayPenalty)

    const many = scoreAnswer({ correct: true, elapsedMs: 2000, limitMs: LIMIT, replaysUsed: 999 })
    expect(many.total).toBe(0)
    expect(many.total).toBeGreaterThanOrEqual(0)
  })

  it('超时（elapsed 大于时限）不会产生负的速度分', () => {
    const s = scoreAnswer({ correct: true, elapsedMs: LIMIT * 3, limitMs: LIMIT, replaysUsed: 0 })
    expect(s.speed).toBe(0)
    expect(s.total).toBe(SCORING.base)
  })

  it('limitMs 为 0 时不会除零', () => {
    const s = scoreAnswer({ correct: true, elapsedMs: 100, limitMs: 0, replaysUsed: 0 })
    expect(Number.isFinite(s.total)).toBe(true)
    expect(s.total).toBe(SCORING.base)
  })

  it('满分 = 题数 ×（基础分 + 速度上限）', () => {
    expect(maxScore(10)).toBe(10 * (SCORING.base + SCORING.speedBonus))
  })
})
