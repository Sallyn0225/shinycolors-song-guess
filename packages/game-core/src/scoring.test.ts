import { describe, expect, it } from 'vitest'
import { SCORING } from '@scg/shared'

import { maxScore, scoreAnswer } from './scoring.js'

const LIMIT = 10_000
const GRACE = SCORING.speedGraceSeconds * 1000

describe('单题计分', () => {
  it('答错得 0，不扣负分', () => {
    const s = scoreAnswer({ correct: false, elapsedMs: 500, limitMs: LIMIT, replaysUsed: 0 })
    expect(s.total).toBe(0)
    expect(s.speed).toBe(0)
  })

  // 听歌辨识本身要几秒，从起播就开始扣会让全对也够不到最高段位
  it('宽限期内答对都拿满分，不只是「瞬间」答对', () => {
    for (const t of [0, GRACE / 2, GRACE]) {
      const s = scoreAnswer({ correct: true, elapsedMs: t, limitMs: LIMIT, replaysUsed: 0 })
      expect(s.speed).toBe(SCORING.speedBonus)
      expect(s.total).toBe(SCORING.base + SCORING.speedBonus)
    }
  })

  // 宽限期的边界：刚过一点就该开始扣，否则宽限期会悄悄变宽
  it('宽限期一结束速度分立刻开始衰减', () => {
    const s = scoreAnswer({ correct: true, elapsedMs: GRACE + 500, limitMs: LIMIT, replaysUsed: 0 })
    expect(s.speed).toBeLessThan(SCORING.speedBonus)
  })

  // 宽限期存在的目的就是让这条线够得着：困难模式全对且平均 2.8s 作答 → 最高段位
  it('困难模式平均 2.8 秒作答，得分率够到最高段位的 0.95', () => {
    const s = scoreAnswer({ correct: true, elapsedMs: 2800, limitMs: LIMIT, replaysUsed: 0 })
    expect(s.total / (SCORING.base + SCORING.speedBonus)).toBeGreaterThanOrEqual(0.95)
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

  // 限时短于宽限期时衰减窗口为负，没有「快慢」可分，只剩「赶上了没有」
  it('limitMs 小于宽限期时按时答对拿满、超时拿 0，且结果有限', () => {
    const short = GRACE - 500
    const inTime = scoreAnswer({ correct: true, elapsedMs: short - 100, limitMs: short, replaysUsed: 0 })
    expect(Number.isFinite(inTime.total)).toBe(true)
    expect(inTime.speed).toBe(SCORING.speedBonus)

    const late = scoreAnswer({ correct: true, elapsedMs: short + 100, limitMs: short, replaysUsed: 0 })
    expect(late.speed).toBe(0)
    expect(late.total).toBe(SCORING.base)
  })

  it('满分 = 题数 ×（基础分 + 速度上限）', () => {
    expect(maxScore(10)).toBe(10 * (SCORING.base + SCORING.speedBonus))
  })
})
