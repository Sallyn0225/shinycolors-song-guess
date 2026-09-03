import { describe, expect, it } from 'vitest'

import {
  emptyRecords,
  normalizeRecords,
  modeView,
  record,
  RECENT_MAX,
  SEEN_MAX,
  UNIT_MIN,
  unitRanking,
  weakestSongs,
  type SoloSummaryInput,
} from './records'

function makeSummary(overrides: Partial<SoloSummaryInput> = {}): SoloSummaryInput {
  return {
    difficulty: 'easy',
    total: 10,
    correct: 8,
    score: 800,
    maxScore: 1000,
    items: [
      {
        correct: true,
        song: { id: 's1', title: 'Song 1', unit: 'illumination-stars' },
      },
      {
        correct: false,
        song: { id: 's2', title: 'Song 2', unit: 'lantica' },
      },
    ],
    ...overrides,
  }
}

describe('features/records', () => {
  it('幂等：同一个 sessionId 记两次，games 只 +1', () => {
    let r = emptyRecords()
    const summary = makeSummary()
    r = record(r, 'session-1', summary)
    expect(r.modes.easy.games).toBe(1)
    expect(r.seen).toEqual(['session-1'])

    const r2 = record(r, 'session-1', summary)
    expect(r2).toBe(r) // 相同引用原样返回
    expect(r2.modes.easy.games).toBe(1)
  })

  it('分档：easy / hard 互不串', () => {
    let r = emptyRecords()
    r = record(r, 's-easy-1', makeSummary({ difficulty: 'easy', score: 600 }))
    r = record(r, 's-hard-1', makeSummary({ difficulty: 'hard', score: 900 }))

    expect(r.modes.easy.games).toBe(1)
    expect(r.modes.easy.bestScore).toBe(600)
    expect(r.modes.easy.worstScore).toBe(600)

    expect(r.modes.hard.games).toBe(1)
    expect(r.modes.hard.bestScore).toBe(900)
    expect(r.modes.hard.worstScore).toBe(900)
  })

  it('首局的最低分：只打一局时 worst === best === 本局分', () => {
    let r = emptyRecords()
    r = record(r, 's1', makeSummary({ score: 750 }))
    expect(r.modes.easy.bestScore).toBe(750)
    expect(r.modes.easy.worstScore).toBe(750)

    r = record(r, 's2', makeSummary({ score: 950 }))
    expect(r.modes.easy.bestScore).toBe(950)
    expect(r.modes.easy.worstScore).toBe(750)

    r = record(r, 's3', makeSummary({ score: 500 }))
    expect(r.modes.easy.bestScore).toBe(950)
    expect(r.modes.easy.worstScore).toBe(500)
  })

  it('未作答题：correct === null 不进单曲与组合分母，但计入 totalQuestions', () => {
    let r = emptyRecords()
    const summary = makeSummary({
      total: 3,
      correct: 1,
      items: [
        { correct: true, song: { id: 's1', title: 'S1', unit: 'straylight' } },
        { correct: false, song: { id: 's2', title: 'S2', unit: 'straylight' } },
        { correct: null, song: { id: 's3', title: 'S3', unit: 'straylight' } },
      ],
    })
    r = record(r, 's1', summary)

    // 模式总量口径：计入 totalQuestions
    expect(r.modes.easy.totalQuestions).toBe(3)
    expect(r.modes.easy.totalCorrect).toBe(1)

    // straylight 组合：只有 2 题作答，1 对 1 错，seen 为 2 而非 3
    const u = r.modes.easy.units['straylight']
    expect(u).toBeDefined()
    expect(u?.seen).toBe(2)
    expect(u?.correct).toBe(1)

    // 未作答的 s3 歌曲：不计入 songs 的 seen
    expect(r.modes.easy.songs['s3']).toBeUndefined()
    // 但曲名快照会留下
    expect(r.titles['s3']?.title).toBe('S3')
  })

  it('组合过滤：shuffle unit 与 unit === null 不进 units 统计，但进 songs 与 titles', () => {
    let r = emptyRecords()
    const summary = makeSummary({
      items: [
        { correct: true, song: { id: 's-shuf', title: 'Shuffle', unit: 'Team.Luna' } },
        { correct: true, song: { id: 's-none', title: 'NoUnit', unit: null } },
        { correct: true, song: { id: 's-reg', title: 'Regular', unit: 'noctchill' } },
      ],
    })
    r = record(r, 's1', summary)

    // shuffle 和 null 不在 units 里
    expect(r.modes.easy.units['Team.Luna']).toBeUndefined()
    expect(r.modes.easy.units['null']).toBeUndefined()
    expect(r.modes.easy.units['noctchill']?.seen).toBe(1)

    // 但单曲与快照保留
    expect(r.modes.easy.songs['s-shuf']?.seen).toBe(1)
    expect(r.modes.easy.songs['s-none']?.seen).toBe(1)
    expect(r.titles['s-shuf']?.unit).toBe('Team.Luna')
    expect(r.titles['s-none']?.unit).toBeNull()
  })

  it('阈值与组合排行：seen < UNIT_MIN 的组合 enough === false 并沉底', () => {
    let r = emptyRecords()
    // 让 noctchill 达到 UNIT_MIN (5 次)，4 次答对 (80%)
    for (let i = 0; i < UNIT_MIN; i++) {
      r = record(
        r,
        `sess-noct-${i}`,
        makeSummary({
          items: [
            {
              correct: i < 4,
              song: { id: `ns-${i}`, title: 'N', unit: 'noctchill' },
            },
          ],
        }),
      )
    }

    // 让 shhis 只有 2 次 (100%)，未达到阈值
    for (let i = 0; i < 2; i++) {
      r = record(
        r,
        `sess-shhis-${i}`,
        makeSummary({
          items: [
            {
              correct: true,
              song: { id: `sh-${i}`, title: 'S', unit: 'shhis' },
            },
          ],
        }),
      )
    }

    const ranking = unitRanking(r, 'easy')
    expect(ranking).toHaveLength(9)

    // noctchill 达标排第一且被标记为最高
    expect(ranking[0]?.id).toBe('noctchill')
    expect(ranking[0]?.enough).toBe(true)
    expect(ranking[0]?.isHighest).toBe(true)

    // shhis 虽然 100% 但样本不足，排在达标项后面
    const shhisRow = ranking.find((x) => x.id === 'shhis')
    expect(shhisRow?.enough).toBe(false)
    expect(shhisRow?.isHighest).toBeFalsy()
  })

  it('排序稳定：同正确率的两个达标组合顺序确定（按 seen 降序再按 id 升序）', () => {
    let r = emptyRecords()
    // u1 6次全对，u2 5次全对
    for (let i = 0; i < 6; i++) {
      r = record(
        r,
        `sess-cometik-${i}`,
        makeSummary({
          items: [
            {
              correct: true,
              song: { id: `c-${i}`, title: 'C', unit: 'cometik' },
            },
          ],
        }),
      )
    }
    for (let i = 0; i < 5; i++) {
      r = record(
        r,
        `sess-alstro-${i}`,
        makeSummary({
          items: [
            {
              correct: true,
              song: { id: `a-${i}`, title: 'A', unit: 'alstroemeria' },
            },
          ],
        }),
      )
    }

    const ranking = unitRanking(r, 'easy')
    // 正确率都是 1.0，但 cometik seen=6 > alstroemeria seen=5
    expect(ranking[0]?.id).toBe('cometik')
    expect(ranking[1]?.id).toBe('alstroemeria')
  })

  it('recent 上限与顺序：打 25 局后只剩 20 条，且顺序是「新的在尾部」', () => {
    let r = emptyRecords()
    for (let i = 1; i <= 25; i++) {
      r = record(
        r,
        `sess-${i}`,
        makeSummary({
          score: i * 10,
          maxScore: 1000,
        }),
      )
    }
    expect(r.modes.easy.recent).toHaveLength(RECENT_MAX)
    // 最近一局是第 25 局，得分率 250 / 1000 = 0.25，在尾部
    expect(r.modes.easy.recent[RECENT_MAX - 1]).toBeCloseTo(0.25)
    // 最老的一条是第 6 局 (25 - 20 + 1)，得分率 60 / 1000 = 0.06
    expect(r.modes.easy.recent[0]).toBeCloseTo(0.06)
  })

  it('seen 窗口上限：超过 SEEN_MAX 时截断旧的', () => {
    let r = emptyRecords()
    for (let i = 1; i <= SEEN_MAX + 5; i++) {
      r = record(r, `sid-${i}`, makeSummary())
    }
    expect(r.seen).toHaveLength(SEEN_MAX)
    expect(r.seen[SEEN_MAX - 1]).toBe(`sid-${SEEN_MAX + 5}`)
    expect(r.seen[0]).toBe('sid-6')
  })

  it('版本回落：传入 v: 999 的对象 → 得到空 Records', () => {
    const invalid = {
      v: 999,
      seen: ['old-session'],
      modes: { easy: { games: 10 } },
    }
    const normalized = normalizeRecords(invalid)
    expect(normalized).toEqual(emptyRecords())
  })

  it('normalizeRecords 对损坏数据具备容错回落', () => {
    expect(normalizeRecords(null)).toEqual(emptyRecords())
    expect(normalizeRecords('corrupted')).toEqual(emptyRecords())
    expect(normalizeRecords({ v: 1, modes: null })).toMatchObject({
      v: 1,
      modes: {
        easy: { games: 0 },
        hard: { games: 0 },
      },
    })
  })

  it('modeView 计算准确与空态判定', () => {
    const r = emptyRecords()
    expect(modeView(r, 'easy')).toEqual({
      empty: true,
      games: 0,
      bestScore: null,
      worstScore: null,
      avgScore: null,
      accuracy: null,
      totalQuestions: 0,
      totalCorrect: 0,
    })

    const filled = record(
      r,
      's1',
      makeSummary({
        total: 10,
        correct: 7,
        score: 750,
      }),
    )
    expect(modeView(filled, 'easy')).toEqual({
      empty: false,
      games: 1,
      bestScore: 750,
      worstScore: 750,
      avgScore: 750,
      accuracy: 0.7,
      totalQuestions: 10,
      totalCorrect: 7,
    })
  })

  it('weakestSongs 易错榜：仅 seen >= SONG_MIN 上榜，正确率升序排列', () => {
    let r = emptyRecords()
    // s1 考了 3 次，答对 1 次 (33%)
    // s2 考了 4 次，答对 0 次 (0%)
    // s3 考了 2 次，答对 0 次 (0% 但样本不足 3 次)
    for (let i = 0; i < 4; i++) {
      r = record(
        r,
        `sess-${i}`,
        makeSummary({
          items: [
            ...(i < 3
              ? [{ correct: i === 0, song: { id: 's1', title: 'Song 1', unit: 'lantica' } }]
              : []),
            { correct: false, song: { id: 's2', title: 'Song 2', unit: 'lantica' } },
            ...(i < 2
              ? [{ correct: false, song: { id: 's3', title: 'Song 3', unit: null } }]
              : []),
          ],
        }),
      )
    }

    const weak = weakestSongs(r, 'easy')
    expect(weak).toHaveLength(2)
    // s2 正确率 0% 最低，排第 1
    expect(weak[0]?.id).toBe('s2')
    expect(weak[0]?.rate).toBe(0)
    // s1 正确率 33%，排第 2
    expect(weak[1]?.id).toBe('s1')
    // s3 未达到 SONG_MIN=3，不上榜
    expect(weak.find((x) => x.id === 's3')).toBeUndefined()
  })
})
