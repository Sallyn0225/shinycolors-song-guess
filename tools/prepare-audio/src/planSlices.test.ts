import { describe, expect, it } from 'vitest'

import { planSlices, type Interval } from './planSlices.js'
import { SLICE } from './config.js'

/** 切片窗口不得越过曲子末尾 */
function assertInBounds(startSec: number, durationSec: number): void {
  expect(startSec).toBeGreaterThanOrEqual(0)
  expect(startSec + SLICE.durationSec).toBeLessThanOrEqual(durationSec)
}

describe('planSlices', () => {
  it('普通长度的曲子能排满 6 段且不降级', () => {
    const { slices, degradeLevel } = planSlices(241, [])
    expect(slices).toHaveLength(SLICE.count)
    expect(degradeLevel).toBe(0)
    for (const s of slices) assertInBounds(s.startSec, 241)
  })

  it('切片按时间升序且互不重叠', () => {
    const { slices } = planSlices(241, [])
    for (let i = 1; i < slices.length; i++) {
      const prev = slices[i - 1]!
      const cur = slices[i]!
      expect(cur.startSec).toBeGreaterThan(prev.startSec)
      expect(cur.startSec).toBeGreaterThanOrEqual(prev.startSec + SLICE.durationSec - 1e-6)
    }
  })

  // 全库最短：キズナシェアリング 159.2s
  it('最短曲（159.2s）不会切到 EOF 之外', () => {
    const duration = 159.2
    const { slices } = planSlices(duration, [])
    expect(slices.length).toBeGreaterThanOrEqual(3)
    for (const s of slices) assertInBounds(s.startSec, duration)
  })

  // 全库最长：感謝のコントレイル 617.8s
  it('最长曲（617.8s）的切片铺开在全曲而非挤在开头', () => {
    const duration = 617.8
    const { slices } = planSlices(duration, [])
    expect(slices).toHaveLength(SLICE.count)
    for (const s of slices) assertInBounds(s.startSec, duration)
    const last = slices[slices.length - 1]!
    // 固定秒数偏移会让全部 6 段挤在前 1/3；按比例偏移则应覆盖到后半段
    expect(last.startSec).toBeGreaterThan(duration * 0.5)
  })

  it('避开静音区间：起播处不得是静音', () => {
    // 模拟 Lit up my sky 的真实静音：前奏淡入 + 中段 3.6s 间奏空白
    const silences: Interval[] = [
      [0, 0.563],
      [166.32, 169.967],
    ]
    const duration = 170
    const { slices } = planSlices(duration, silences)
    for (const s of slices) {
      // 起播后 1 秒内不得落入任何静音区
      for (const [a, b] of silences) {
        const overlap = Math.min(s.startSec + 1, b) - Math.max(s.startSec, a)
        expect(overlap).toBeLessThanOrEqual(0)
      }
    }
  })

  it('静音极多时降级但仍产出至少 3 段', () => {
    const duration = 200
    // 每 10 秒挖掉 6 秒，可用区支离破碎
    const silences: Interval[] = []
    for (let t = 0; t < duration; t += 10) silences.push([t + 4, t + 10])
    const { slices, degradeLevel } = planSlices(duration, silences)
    expect(slices.length).toBeGreaterThanOrEqual(3)
    expect(degradeLevel).toBeGreaterThan(0)
    for (const s of slices) assertInBounds(s.startSec, duration)
  })

  // 这条守的是出题策略里最关键的一条规则：同一首歌重播时必须换一段。
  // 如果两段重叠 80%，换了等于没换，玩家照样能靠「这段我听过」推断出是空札。
  it('任意两段的重叠都不超过 50%（含降级路径）', () => {
    const cases: Array<{ duration: number; silences: Interval[] }> = [
      { duration: 241, silences: [] },
      { duration: 159.2, silences: [] },
      { duration: 617.8, silences: [] },
      { duration: 170, silences: [[0, 0.563], [166.32, 169.967]] },
      { duration: 200, silences: Array.from({ length: 20 }, (_, i): Interval => [i * 10 + 4, i * 10 + 10]) },
    ]
    for (const { duration, silences } of cases) {
      const { slices } = planSlices(duration, silences)
      for (let i = 0; i < slices.length; i++) {
        for (let j = i + 1; j < slices.length; j++) {
          const gap = Math.abs(slices[j]!.startSec - slices[i]!.startSec)
          expect(gap).toBeGreaterThanOrEqual(SLICE.durationSec * 0.5 - 1e-6)
        }
      }
    }
  })

  it('极短曲也不会产出越界切片', () => {
    const duration = 60
    const { slices } = planSlices(duration, [])
    expect(slices.length).toBeGreaterThanOrEqual(1)
    for (const s of slices) assertInBounds(s.startSec, duration)
  })
})
