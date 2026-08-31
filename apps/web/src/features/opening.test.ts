import { describe, expect, it } from 'vitest'

import { IDOLS } from './idols'
import {
  advance,
  createPlaylist,
  currentClip,
  pickIdol,
  remaining,
  type AmbienceTrack,
} from './opening'

describe('pickIdol', () => {
  it('28 人都选得到', () => {
    const seen = new Set<string>()
    // 1/28 的均匀分布，2000 次抽不满 28 个的概率低到可以忽略
    for (let i = 0; i < 2000; i++) seen.add(pickIdol().id)
    expect(seen.size).toBe(IDOLS.length)
  })

  it('排除上一位 —— 连着两次撞上同一个人，观感是「随机坏了」', () => {
    for (let i = 0; i < 500; i++) {
      expect(pickIdol('mano').id).not.toBe('mano')
    }
  })

  it('exclude 传了个不认识的 id 时仍然可用', () => {
    // 池子退化成全量而不是空，不能因为一个脏值就抛
    expect(pickIdol('nobody').id).toBeTruthy()
  })
})

describe('IDOLS 数据表', () => {
  it('28 人，id 不重复', () => {
    expect(IDOLS).toHaveLength(28)
    expect(new Set(IDOLS.map((i) => i.id)).size).toBe(28)
  })

  it('id 是纯小写罗马音 —— 它同时是三个文件的文件名', () => {
    for (const i of IDOLS) expect(i.id).toMatch(/^[a-z]+$/)
  })

  it('组合色是合法 hex，且同组合的人色值一致', () => {
    const byUnit = new Map<string, Set<string>>()
    for (const i of IDOLS) {
      expect(i.unitColor).toMatch(/^#[0-9a-f]{6}$/)
      const s = byUnit.get(i.unit) ?? new Set()
      s.add(i.unitColor)
      byUnit.set(i.unit, s)
    }
    expect(byUnit.size).toBe(8)
    for (const [unit, colors] of byUnit) {
      expect(colors.size, `${unit} 的成员色值不一致`).toBe(1)
    }
  })
})

const track = (...clips: string[]): AmbienceTrack => ({ clips })

describe('Playlist', () => {
  it('先在曲目内走完，再跳下一个曲目 —— 这就是「同一首歌连播 3~4 段」', () => {
    let p = createPlaylist([track('a1', 'a2', 'a3'), track('b1', 'b2')])
    const order: string[] = []
    for (;;) {
      const c = currentClip(p)
      if (!c) break
      order.push(c)
      const next = advance(p)
      if (!next) break
      p = next
    }
    expect(order).toEqual(['a1', 'a2', 'a3', 'b1', 'b2'])
  })

  it('播完最后一段返回 null —— 调用方据此去续取，而不是从头循环', () => {
    let p = createPlaylist([track('only')])
    expect(currentClip(p)).toBe('only')
    expect(advance(p)).toBeNull()

    p = createPlaylist([track('a1', 'a2')])
    const second = advance(p)
    expect(second).not.toBeNull()
    expect(currentClip(second as typeof p)).toBe('a2')
    expect(advance(second as typeof p)).toBeNull()
  })

  it('空列表不炸', () => {
    const p = createPlaylist([])
    expect(currentClip(p)).toBeNull()
    expect(advance(p)).toBeNull()
    expect(remaining(p)).toBe(0)
  })

  it('remaining 随播放递减，用来决定何时续取', () => {
    let p = createPlaylist([track('a1', 'a2', 'a3'), track('b1')])
    expect(remaining(p)).toBe(4)
    p = advance(p) as typeof p
    expect(remaining(p)).toBe(3)
    p = advance(p) as typeof p
    p = advance(p) as typeof p
    expect(remaining(p)).toBe(1)
  })

  it('续取是往后追加，不动当前游标', () => {
    const p = createPlaylist([track('a1', 'a2')])
    const moved = advance(p) as typeof p
    const refilled = { ...moved, tracks: [...moved.tracks, track('c1')] }
    // 追加之后当前这一段还是 a2，没有被打断
    expect(currentClip(refilled)).toBe('a2')
    expect(currentClip(advance(refilled) as typeof p)).toBe('c1')
  })
})
