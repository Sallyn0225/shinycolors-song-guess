import { afterEach, describe, expect, it, vi } from 'vitest'

import { IpQuota } from './quota.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('IpQuota', () => {
  it('窗口内到达上限之前放行，超过之后拒绝', () => {
    const q = new IpQuota()
    // max=3：前三次放行，第四次越界
    expect(q.hit('1.1.1.1', 'create', 60_000, 3)).toBe(false)
    expect(q.hit('1.1.1.1', 'create', 60_000, 3)).toBe(false)
    expect(q.hit('1.1.1.1', 'create', 60_000, 3)).toBe(false)
    expect(q.hit('1.1.1.1', 'create', 60_000, 3)).toBe(true)
  })

  it('不同 IP 互不影响', () => {
    const q = new IpQuota()
    q.hit('1.1.1.1', 'create', 60_000, 1)
    expect(q.hit('1.1.1.1', 'create', 60_000, 1)).toBe(true)
    expect(q.hit('2.2.2.2', 'create', 60_000, 1)).toBe(false)
  })

  it('不同桶互不影响——建房超限不该连带把加入也封了', () => {
    const q = new IpQuota()
    q.hit('1.1.1.1', 'create', 60_000, 1)
    expect(q.hit('1.1.1.1', 'create', 60_000, 1)).toBe(true)
    expect(q.hit('1.1.1.1', 'joinFail', 60_000, 1)).toBe(false)
  })

  it('窗口滑过之后额度自己回来', () => {
    vi.useFakeTimers()
    const q = new IpQuota()
    expect(q.hit('1.1.1.1', 'create', 1000, 1)).toBe(false)
    expect(q.hit('1.1.1.1', 'create', 1000, 1)).toBe(true)

    vi.advanceTimersByTime(1001)
    expect(q.hit('1.1.1.1', 'create', 1000, 1)).toBe(false)
  })

  it('max 为 0 时第一次就拒绝——这是应急关停开关的依据', () => {
    const q = new IpQuota()
    expect(q.hit('1.1.1.1', 'create', 60_000, 0)).toBe(true)
  })

  it('过期的时间戳会被裁掉，桶不会无限增长', () => {
    vi.useFakeTimers()
    const q = new IpQuota()
    for (let i = 0; i < 50; i++) {
      q.hit('1.1.1.1', 'create', 1000, 1000)
      vi.advanceTimersByTime(100)
    }
    // 窗口 1000ms、每 100ms 一次 —— 里面最多留得下 10 条左右，不是 50 条
    expect(q.peek('1.1.1.1', 'create', 1000)).toBeLessThanOrEqual(11)
  })

  it('peek 只看不记', () => {
    const q = new IpQuota()
    q.hit('1.1.1.1', 'create', 60_000, 5)
    expect(q.peek('1.1.1.1', 'create', 60_000)).toBe(1)
    expect(q.peek('1.1.1.1', 'create', 60_000)).toBe(1)
  })
})
