import { describe, expect, it } from 'vitest'
import { DIFFICULTY_PRESETS } from '@scg/shared'

import { generateSoloRound, gradeAnswer, SoloError, type SoloSong } from './solo.js'

const UNITS = ['lantica', 'noctchill', 'straylight', 'alstroemeria', null]

/** 造一个结构接近真实曲库的假数据：有组合、有专辑、有邻居 */
function makeCatalog(n = 120, groups: Record<number, string> = {}): SoloSong[] {
  const songs: SoloSong[] = Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    unit: UNITS[i % UNITS.length] ?? null,
    album: `album-${Math.floor(i / 6)}`,
    confusableGroup: groups[i] ?? null,
    neighbours: [],
    sliceCount: 6,
    sliceDifficulty: [0.9, 0.8, 0.6, 0.4, 0.3, 0.1],
  }))
  // 邻居：同组合的相似度高，其余递减
  for (const s of songs) {
    s.neighbours = songs
      .filter((o) => o.id !== s.id)
      .map((o) => ({ id: o.id, sim: o.unit === s.unit ? 0.8 : o.album === s.album ? 0.5 : 0.1 }))
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 24)
  }
  return songs
}

describe('单机出题', () => {
  it('按难度产出正确的题量与选项数', () => {
    for (const d of ['easy', 'hard'] as const) {
      const preset = DIFFICULTY_PRESETS[d]
      const round = generateSoloRound(makeCatalog(), d, 'seed-1')
      expect(round.questions).toHaveLength(preset.questionCount)
      for (const q of round.questions) {
        expect(q.optionIds).toHaveLength(preset.optionCount)
        expect(new Set(q.optionIds).size).toBe(preset.optionCount)
        expect(q.optionIds).toContain(q.songId)
      }
    }
  })

  it('同一轮内不出重复曲目', () => {
    const round = generateSoloRound(makeCatalog(), 'hard', 'seed-2')
    const ids = round.questions.map((q) => q.songId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('切片下标始终落在有效范围内', () => {
    const round = generateSoloRound(makeCatalog(), 'hard', 'seed-3')
    for (const q of round.questions) {
      expect(q.sliceIndex).toBeGreaterThanOrEqual(0)
      expect(q.sliceIndex).toBeLessThan(6)
    }
  })

  it('同一 seed 出同一套题，不同 seed 出不同的', () => {
    const a = generateSoloRound(makeCatalog(), 'hard', 'x')
    const b = generateSoloRound(makeCatalog(), 'hard', 'x')
    const c = generateSoloRound(makeCatalog(), 'hard', 'y')
    expect(a.questions).toEqual(b.questions)
    expect(a.questions).not.toEqual(c.questions)
  })

  it('答案位置分布均匀，不会总在同一个位置', () => {
    const positions = new Map<number, number>()
    for (let i = 0; i < 60; i++) {
      for (const q of generateSoloRound(makeCatalog(), 'hard', `p-${i}`).questions) {
        const at = q.optionIds.indexOf(q.songId)
        positions.set(at, (positions.get(at) ?? 0) + 1)
      }
    }
    expect(positions.size).toBe(4)
    const counts = [...positions.values()]
    const total = counts.reduce((a, b) => a + b, 0)
    for (const c of counts) expect(c / total).toBeGreaterThan(0.15)
  })
})

describe('易混淆组约束', () => {
  const groups: Record<number, string> = {}
  for (let i = 0; i < 9; i++) groups[i] = 'migratory-echoes'
  for (let i = 9; i < 11; i++) groups[i] = 'reflect-sign'

  it('一轮里同组最多考 1 首', () => {
    for (let s = 0; s < 30; s++) {
      const round = generateSoloRound(makeCatalog(120, groups), 'hard', `g-${s}`)
      const seen = new Map<string, number>()
      for (const q of round.questions) {
        const g = makeCatalog(120, groups).find((x) => x.id === q.songId)?.confusableGroup
        if (g) seen.set(g, (seen.get(g) ?? 0) + 1)
      }
      for (const [, n] of seen) expect(n).toBe(1)
    }
  })

  // 这条守的是「不能出现无法靠实力避免的失误」
  it('同组曲目永远不会互为干扰项', () => {
    const catalog = makeCatalog(120, groups)
    const byId = new Map(catalog.map((s) => [s.id, s]))
    for (let s = 0; s < 30; s++) {
      for (const q of generateSoloRound(catalog, 'hard', `d-${s}`).questions) {
        const answer = byId.get(q.songId)
        if (!answer?.confusableGroup) continue
        for (const opt of q.optionIds) {
          if (opt === q.songId) continue
          expect(byId.get(opt)?.confusableGroup).not.toBe(answer.confusableGroup)
        }
      }
    }
  })

  it('曲库不足以满足约束时报错而不是静默少出题', () => {
    const allSame: Record<number, string> = {}
    for (let i = 0; i < 30; i++) allSame[i] = 'same'
    expect(() => generateSoloRound(makeCatalog(30, allSame), 'hard', 'x')).toThrow(SoloError)
  })
})

describe('干扰项策略', () => {
  it('困难：干扰项以同组合为主', () => {
    const catalog = makeCatalog()
    const byId = new Map(catalog.map((s) => [s.id, s]))
    let sameUnit = 0
    let total = 0
    for (let s = 0; s < 20; s++) {
      for (const q of generateSoloRound(catalog, 'hard', `h-${s}`).questions) {
        const answer = byId.get(q.songId)
        if (!answer?.unit) continue
        for (const opt of q.optionIds) {
          if (opt === q.songId) continue
          total++
          if (byId.get(opt)?.unit === answer.unit) sameUnit++
        }
      }
    }
    expect(sameUnit / total).toBeGreaterThan(0.7)
  })

  it('简单：干扰项刻意避开同组合', () => {
    const catalog = makeCatalog()
    const byId = new Map(catalog.map((s) => [s.id, s]))
    let sameUnit = 0
    let total = 0
    for (let s = 0; s < 20; s++) {
      for (const q of generateSoloRound(catalog, 'easy', `e-${s}`).questions) {
        const answer = byId.get(q.songId)
        if (!answer?.unit) continue
        for (const opt of q.optionIds) {
          if (opt === q.songId) continue
          total++
          if (byId.get(opt)?.unit === answer.unit) sameUnit++
        }
      }
    }
    expect(sameUnit / total).toBeLessThan(0.05)
  })

  // 降级链是必需的：活动限定组合往往只有 2 首同伴，凑不满 3 个干扰项
  it('组合只有 2 首曲子时仍能凑够干扰项（降级到 album / 相似度 / 随机）', () => {
    const catalog = makeCatalog(60)
    // 造一个只有 2 首的迷你组合
    catalog[0]!.unit = 'tiny-unit'
    catalog[1]!.unit = 'tiny-unit'
    const round = generateSoloRound(catalog, 'hard', 'tiny')
    for (const q of round.questions) {
      expect(q.optionIds).toHaveLength(4)
      expect(new Set(q.optionIds).size).toBe(4)
    }
  })

  it('unit 为 null（跨组合合同曲）也能正常出题', () => {
    const catalog = makeCatalog(60).map((s) => ({ ...s, unit: null }))
    const round = generateSoloRound(catalog, 'hard', 'nounit')
    expect(round.questions).toHaveLength(DIFFICULTY_PRESETS.hard.questionCount)
    for (const q of round.questions) expect(new Set(q.optionIds).size).toBe(4)
  })

  // 曲目不会重复当答案，所以让旧答案出现在后面的选项里，
  // 等于奖励「记账排除」而不是听力
  it('已经当过答案的曲目不会再出现在后面的选项里', () => {
    for (const d of ['easy', 'hard'] as const) {
      for (let s = 0; s < 20; s++) {
        const round = generateSoloRound(makeCatalog(), d, `used-${d}-${s}`)
        const seenAnswers = new Set<string>()
        for (const q of round.questions) {
          for (const opt of q.optionIds) {
            if (opt === q.songId) continue
            expect(seenAnswers.has(opt)).toBe(false)
          }
          seenAnswers.add(q.songId)
        }
      }
    }
  })

  it('同一轮里不会反复用同一批干扰项', () => {
    const round = generateSoloRound(makeCatalog(), 'hard', 'variety')
    const used = new Map<string, number>()
    for (const q of round.questions) {
      for (const o of q.optionIds) {
        if (o !== q.songId) used.set(o, (used.get(o) ?? 0) + 1)
      }
    }
    const maxRepeat = Math.max(...used.values())
    expect(maxRepeat).toBeLessThanOrEqual(4)
  })
})

describe('判分', () => {
  it('只有选中答案所在位置才算对', () => {
    const round = generateSoloRound(makeCatalog(), 'easy', 'grade')
    for (const q of round.questions) {
      const correct = q.optionIds.indexOf(q.songId)
      for (let i = 0; i < q.optionIds.length; i++) {
        expect(gradeAnswer(q, i)).toBe(i === correct)
      }
    }
  })

  it('越界的选择判为错，不抛异常', () => {
    const q = generateSoloRound(makeCatalog(), 'easy', 'oob').questions[0]!
    expect(gradeAnswer(q, -1)).toBe(false)
    expect(gradeAnswer(q, 99)).toBe(false)
  })
})
