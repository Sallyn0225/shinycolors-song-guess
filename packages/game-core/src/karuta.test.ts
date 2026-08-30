import { describe, expect, it } from 'vitest'

import { applyLayout, cardsLeft, dealMatch, selectPool, DealError } from './deal.js'
import { adjudicate, applyRound, pendingSends } from './karuta.js'
import { pickNextReading, pickSlice, liveFieldSongs } from './select.js'
import { makeSongs, TEST_CONFIG } from './testing.js'
import type { CardId, MatchState, PlayerId, Reading, SongRef, Tap } from './types.js'

const cfg = TEST_CONFIG

function deal(seed = 'test-seed', songs: SongRef[] = makeSongs(120)) {
  return dealMatch(songs, seed, cfg)
}

/** 找一张属于指定玩家的牌 */
function ownCard(state: MatchState, player: PlayerId, at = 0): CardId {
  const id = state.layout[player][at]
  if (!id) throw new Error(`${player} 没有第 ${at} 张牌`)
  return id
}

function fieldReading(state: MatchState, cardId: CardId, roundNo = 1): Reading {
  const songId = state.cards[cardId]?.songId
  if (!songId) throw new Error('牌不存在')
  return { roundNo, songId, sliceIndex: 0, kind: 'field' }
}

function karafudaReading(state: MatchState, roundNo = 1): Reading {
  return { roundNo, songId: state.karafuda[0] as string, sliceIndex: 0, kind: 'karafuda' }
}

// ─────────────────────────────────────────────────────────

describe('发牌', () => {
  it('按配置分牌：24 张场上札（每人 12）+ 6 张空札', () => {
    const { state, pool } = deal()
    expect(pool).toHaveLength(cfg.poolSize)
    expect(Object.keys(state.cards)).toHaveLength(cfg.fieldCards)
    expect(state.layout.A).toHaveLength(cfg.fieldCards / 2)
    expect(state.layout.B).toHaveLength(cfg.fieldCards / 2)
    expect(state.karafuda).toHaveLength(cfg.karafuda)
  })

  it('空札与场上札不重叠', () => {
    const { state } = deal()
    const onField = new Set(Object.values(state.cards).map((c) => c.songId))
    for (const k of state.karafuda) expect(onField.has(k)).toBe(false)
  })

  it('同一 seed 发出同一副牌，不同 seed 发出不同的', () => {
    // 注意 layout 存的是卡片 id（c0…c23，按位置固定分配），随 seed 变的是每张卡对应哪首歌
    const songsOf = (s: MatchState) => Object.values(s.cards).map((c) => `${c.id}:${c.songId}`).sort()

    const a = deal('seed-1').state
    const b = deal('seed-1').state
    const c = deal('seed-2').state

    expect(songsOf(a)).toEqual(songsOf(b))
    expect(a.karafuda).toEqual(b.karafuda)

    expect(songsOf(a)).not.toEqual(songsOf(c))
    expect(a.karafuda).not.toEqual(c.karafuda)
  })

  // 互斥组：现役曲库里只有 Migratory Echoes 一组（9 个版本），去人声后几乎无法区分，
  // 同场出现会造成「无法靠实力避免的失误」。下面用合成数据造两组，是为了覆盖多组共存的情形。
  it('一局内同一易混淆组最多取 1 首', () => {
    const groups: Record<number, string> = {}
    for (let i = 0; i < 9; i++) groups[i] = 'migratory-echoes'
    for (let i = 9; i < 11; i++) groups[i] = 'reflect-sign'
    const songs = makeSongs(120, groups)

    for (let s = 0; s < 40; s++) {
      const pool = selectPool(songs, cfg.poolSize, `seed-${s}`)
      const seen = new Map<string, number>()
      for (const song of pool) {
        if (!song.confusableGroup) continue
        seen.set(song.confusableGroup, (seen.get(song.confusableGroup) ?? 0) + 1)
      }
      for (const [, n] of seen) expect(n).toBe(1)
    }
  })

  it('曲库不足以满足互斥约束时报错而不是静默产出残局', () => {
    const groups: Record<number, string> = {}
    for (let i = 0; i < 40; i++) groups[i] = 'same'
    expect(() => selectPool(makeSongs(40, groups), 30, 'x')).toThrow(DealError)
  })

  it('自陣重排只接受现有牌的排列', () => {
    const { state } = deal()
    const rev = [...state.layout.A].reverse()
    expect(applyLayout(state, 'A', rev).layout.A).toEqual(rev)
    expect(() => applyLayout(state, 'A', state.layout.A.slice(1))).toThrow(DealError)
    expect(() => applyLayout(state, 'A', [...state.layout.A.slice(1), 'bogus'])).toThrow(DealError)
  })
})

describe('取牌', () => {
  it('取自陣牌：该牌移除，自陣 -1，对手不变', () => {
    const { state } = deal()
    const card = ownCard(state, 'A')
    const before = cardsLeft(state)

    const r = adjudicate(state, fieldReading(state, card), [{ player: 'A', cardId: card, reactionMs: 900 }], cfg)
    const next = applyRound(state, r)

    expect(r.winner).toBe('A')
    expect(next.cards[card]?.owner).toBeNull()
    expect(cardsLeft(next).A).toBe(before.A - 1)
    expect(cardsLeft(next).B).toBe(before.B)
  })

  // 真歌牌的账面：敵陣 -1（被取走）+1（收到送札）= 0，自陣 -1（送出去的）。
  // 牌数收益与取自陣牌相同；「取敵陣值 2 枚」说的是节奏——剥夺了对手用那张牌给自己 -1 的机会。
  it('取敵陣牌：该牌移除 + 从自陣送 1 张，自陣 -1、敵陣净变 0', () => {
    const { state } = deal()
    const card = ownCard(state, 'B')
    const sendCard = state.layout.A[0]
    const before = cardsLeft(state)

    const r = adjudicate(state, fieldReading(state, card), [{ player: 'A', cardId: card, reactionMs: 900 }], cfg)
    const next = applyRound(state, r)

    expect(r.winner).toBe('A')
    expect(r.transfers.map((t) => t.cause)).toEqual(['take', 'okuri'])
    expect(cardsLeft(next).A).toBe(before.A - 1)
    expect(cardsLeft(next).B).toBe(before.B)
    expect(next.layout.B).toContain(sendCard)
    expect(next.layout.A).not.toContain(sendCard)
    expect(next.cards[card]?.owner).toBeNull()
  })

  it('送り札送的是自陣待得最久的那张（确定性，玩家可预判）', () => {
    const { state: s0 } = deal()
    // 重排自陣，确认送的是重排后的队首
    const reordered = applyLayout(s0, 'A', [...s0.layout.A].reverse())
    const expected = reordered.layout.A[0]
    const enemy = ownCard(reordered, 'B')

    const r = adjudicate(
      reordered,
      fieldReading(reordered, enemy),
      [{ player: 'A', cardId: enemy, reactionMs: 800 }],
      cfg,
    )
    expect(r.transfers.find((t) => t.cause === 'okuri')?.cardId).toBe(expected)
  })

  it('玩家自选送り札时送的是他挑的那张', () => {
    const { state } = deal()
    const enemy = ownCard(state, 'B')
    const want = ownCard(state, 'A', 5) // 故意不是队首

    const r = adjudicate(
      state,
      fieldReading(state, enemy),
      [{ player: 'A', cardId: enemy, reactionMs: 800 }],
      cfg,
      { A: [want] },
    )
    expect(r.transfers.find((t) => t.cause === 'okuri')?.cardId).toBe(want)
    expect(r.sends[0]?.chosen).toBe(true)
    expect(applyRound(state, r).layout.B).toContain(want)
  })

  // 客户端可能乱报（已送出的牌、敵陣的牌、根本不存在的 id）。
  // 规则引擎必须照样算得出结果，否则一条脏消息就能把整局卡死。
  it('自选的牌不合法时静默回落到自动规则', () => {
    const { state } = deal()
    const enemy = ownCard(state, 'B')
    const auto = state.layout.A[0]

    for (const bogus of [['bogus-id'], [enemy], []]) {
      const r = adjudicate(
        state,
        fieldReading(state, enemy),
        [{ player: 'A', cardId: enemy, reactionMs: 800 }],
        cfg,
        { A: bogus },
      )
      expect(r.transfers.find((t) => t.cause === 'okuri')?.cardId).toBe(auto)
      expect(r.sends[0]?.chosen).toBe(false)
    }
  })

  // 一回合里同一个人可能要送两张：取敵陣的送り札 + 对手お手つき的罚牌
  it('同一回合要送两张时按队列依次消费，不会送重复的牌', () => {
    const { state } = deal()
    const enemy = ownCard(state, 'B')
    const wrong = ownCard(state, 'B', 1) // B 点错自陣的另一张
    const [w1, w2] = [ownCard(state, 'A', 4), ownCard(state, 'A', 7)]

    const r = adjudicate(
      state,
      fieldReading(state, enemy),
      [
        { player: 'A', cardId: enemy, reactionMs: 800 },
        { player: 'B', cardId: wrong, reactionMs: 900 },
      ],
      cfg,
      { A: [w1, w2] },
    )

    expect(r.sends.map((s) => s.cardId)).toEqual([w1, w2])
    expect(r.sends.map((s) => s.cause)).toEqual(['okuri', 'otetsuki'])
    // 第二次选择时第一张已经不在自陣里了
    expect(r.sends[1]?.candidates).not.toContain(w1)
    expect(r.sends.every((s) => s.chosen)).toBe(true)
  })

  // 双方互相お手つき时两张送札同回合发生。若把「刚收到的牌」算进候选，
  // 后一个人的候选集就会随前一个人的选择而变 —— 上层提前公示的列表当场作废
  it('同回合双方各送一张时，候选集互不影响', () => {
    const { state } = deal()
    const target = ownCard(state, 'A', 0)
    const taps: Tap[] = [
      { player: 'A', cardId: ownCard(state, 'A', 1), reactionMs: 800 },
      { player: 'B', cardId: ownCard(state, 'B', 1), reactionMs: 900 },
    ]
    const reading = fieldReading(state, target)

    const base = adjudicate(state, reading, taps, cfg)
    expect(base.sends).toHaveLength(2)

    const candidatesOf = (r: typeof base, p: PlayerId) => r.sends.find((s) => s.from === p)?.candidates
    expect(candidatesOf(base, 'A')).toEqual(state.layout.A)
    expect(candidatesOf(base, 'B')).toEqual(state.layout.B)

    // B 改挑另一张，A 的候选集必须一字不变
    const other = adjudicate(state, reading, taps, cfg, { B: [ownCard(state, 'B', 9)] })
    expect(candidatesOf(other, 'A')).toEqual(candidatesOf(base, 'A'))
    // 刚从对手手里收到的牌不会出现在自己的候选里
    const fromB = other.sends.find((s) => s.from === 'B')?.cardId as CardId
    expect(candidatesOf(other, 'A')).not.toContain(fromB)
  })

  it('pendingSends 按人合并，且只在真有得选时才问', () => {
    const { state } = deal()
    const enemy = ownCard(state, 'B')
    const wrong = ownCard(state, 'B', 1)

    const r = adjudicate(
      state,
      fieldReading(state, enemy),
      [
        { player: 'A', cardId: enemy, reactionMs: 800 },
        { player: 'B', cardId: wrong, reactionMs: 900 },
      ],
      cfg,
    )
    expect(pendingSends(r)).toEqual([
      { player: 'A', count: 2, candidates: state.layout.A },
    ])

    // 自陣只剩一张时没有可选性，不该拿一个假选择去打断节奏
    const last = applyLayout(
      { ...state, layout: { ...state.layout, A: state.layout.A.slice(0, 1) } },
      'A',
      state.layout.A.slice(0, 1),
    )
    const r2 = adjudicate(
      last,
      fieldReading(last, enemy),
      [{ player: 'A', cardId: enemy, reactionMs: 800 }],
      cfg,
    )
    expect(r2.sends).toHaveLength(1)
    expect(pendingSends(r2)).toEqual([])
  })

  // 上层要「先跑一遍问玩家、再带着答案跑一遍定案」，
  // 这条保证两遍除送出的牌之外完全一致——否则玩家看到的揭晓会和最终结果对不上
  it('带 choices 重跑只改送出的牌，判定与胜负不变', () => {
    const { state } = deal()
    const enemy = ownCard(state, 'B')
    const taps: Tap[] = [{ player: 'A', cardId: enemy, reactionMs: 800 }]
    const auto = adjudicate(state, fieldReading(state, enemy), taps, cfg)
    const picked = adjudicate(state, fieldReading(state, enemy), taps, cfg, {
      A: [ownCard(state, 'A', 3)],
    })

    expect(picked.winner).toBe(auto.winner)
    expect(picked.taps).toEqual(auto.taps)
    expect(picked.cardsLeft).toEqual(auto.cardsLeft)
    expect(picked.transfers.map((t) => t.cause)).toEqual(auto.transfers.map((t) => t.cause))
    expect(picked.transfers[0]).toEqual(auto.transfers[0]) // take 那条一模一样
  })

  it('更快的一方取得牌', () => {
    const { state } = deal()
    const card = ownCard(state, 'A')
    const r = adjudicate(
      state,
      fieldReading(state, card),
      [
        { player: 'A', cardId: card, reactionMs: 1200 },
        { player: 'B', cardId: card, reactionMs: 900 },
      ],
      cfg,
    )
    expect(r.winner).toBe('B')
  })
})

describe('お手つき', () => {
  it('空札时点牌 → 对手送你 1 张', () => {
    const { state } = deal()
    const card = ownCard(state, 'A')
    const before = cardsLeft(state)

    const r = adjudicate(state, karafudaReading(state), [{ player: 'A', cardId: card, reactionMs: 800 }], cfg)
    const next = applyRound(state, r)

    expect(r.taps[0]?.verdict).toBe('otetsuki_karafuda')
    expect(r.winner).toBeNull()
    expect(cardsLeft(next).A).toBe(before.A + 1)
    expect(cardsLeft(next).B).toBe(before.B - 1)
  })

  it('点错牌 → 对手送你 1 张', () => {
    const { state } = deal()
    const target = ownCard(state, 'A', 0)
    const wrong = ownCard(state, 'A', 1)
    const before = cardsLeft(state)

    const r = adjudicate(state, fieldReading(state, target), [{ player: 'B', cardId: wrong, reactionMs: 800 }], cfg)
    const next = applyRound(state, r)

    expect(r.taps[0]?.verdict).toBe('wrong')
    expect(cardsLeft(next).B).toBe(before.B + 1)
    expect(cardsLeft(next).A).toBe(before.A - 1)
  })

  it('抢跑（低于人类反应下限）按お手つき处理', () => {
    const { state } = deal()
    const card = ownCard(state, 'A')
    const r = adjudicate(state, fieldReading(state, card), [{ player: 'B', cardId: card, reactionMs: 80 }], cfg)
    expect(r.taps[0]?.verdict).toBe('too_early')
    expect(r.winner).toBeNull()
    expect(r.transfers.some((t) => t.cause === 'otetsuki')).toBe(true)
  })

  it('超时不算失误，也不得牌', () => {
    const { state } = deal()
    const card = ownCard(state, 'A')
    const r = adjudicate(
      state,
      fieldReading(state, card),
      [{ player: 'B', cardId: card, reactionMs: cfg.windowMs + 500 }],
      cfg,
    )
    expect(r.taps[0]?.verdict).toBe('too_late')
    expect(r.winner).toBeNull()
    expect(r.transfers).toHaveLength(0)
  })

  it('取牌方与失误方可以在同一回合各自结算', () => {
    const { state } = deal()
    const target = ownCard(state, 'A', 0)
    const wrong = ownCard(state, 'B', 0)
    const r = adjudicate(
      state,
      fieldReading(state, target),
      [
        { player: 'A', cardId: target, reactionMs: 700 },
        { player: 'B', cardId: wrong, reactionMs: 900 },
      ],
      cfg,
    )
    expect(r.winner).toBe('A')
    expect(r.transfers.some((t) => t.cause === 'take')).toBe(true)
    expect(r.transfers.some((t) => t.cause === 'otetsuki')).toBe(true)
  })
})

describe('平局', () => {
  it('反应时间差小于阈值 → 牌判给领地方，双方都不罚', () => {
    const { state } = deal()
    const card = ownCard(state, 'B') // B 的领地
    const r = adjudicate(
      state,
      fieldReading(state, card),
      [
        { player: 'A', cardId: card, reactionMs: 900 },
        { player: 'B', cardId: card, reactionMs: 910 },
      ],
      cfg,
    )
    expect(r.taps.every((t) => t.verdict === 'tie')).toBe(true)
    expect(r.winner).toBe('B') // 自陣优势
    expect(r.transfers.some((t) => t.cause === 'otetsuki')).toBe(false)
    // 判给领地方 = 取自陣牌，不触发送り札
    expect(r.transfers.some((t) => t.cause === 'okuri')).toBe(false)
  })

  it('差距刚好超过阈值就不算平局', () => {
    const { state } = deal()
    const card = ownCard(state, 'B')
    const r = adjudicate(
      state,
      fieldReading(state, card),
      [
        { player: 'A', cardId: card, reactionMs: 900 },
        { player: 'B', cardId: card, reactionMs: 900 + cfg.tieEpsilonMs },
      ],
      cfg,
    )
    expect(r.winner).toBe('A')
  })
})

describe('出题策略', () => {
  it('第 1 回合不出空札', () => {
    for (let s = 0; s < 30; s++) {
      const { state, pool } = deal(`seed-${s}`)
      const byId = new Map(pool.map((p) => [p.id, p]))
      expect(pickNextReading(state, byId).reading.kind).toBe('field')
    }
  })

  // 这条守的是空札机制本身：如果重复的空札放同一段音频，
  // 玩家会学会「这段我听过 → 是空札 → 别点」，机制当场塌掉，变成免费通行证
  it('同一首歌重复读到时，切片下标必须不同（直到切片用尽）', () => {
    const { state, pool } = deal()
    const song = pool[0] as SongRef
    let cur = state
    const seen: number[] = []

    for (let i = 0; i < song.sliceCount; i++) {
      const { sliceIndex, usedSlices } = pickSlice(cur, song)
      expect(seen).not.toContain(sliceIndex)
      seen.push(sliceIndex)
      cur = { ...cur, usedSlices: { ...cur.usedSlices, [song.id]: usedSlices } }
    }
    expect(new Set(seen).size).toBe(song.sliceCount)
  })

  it('切片用尽后取最久未用的那段（LRU），而不是随机重复', () => {
    const { state, pool } = deal()
    const song: SongRef = { ...(pool[0] as SongRef), sliceCount: 3 }
    let cur: MatchState = { ...state, usedSlices: { [song.id]: [0, 1, 2] } }

    // 全部用过 → 取队首（最久未用）0，并把它移到队尾
    let r = pickSlice(cur, song)
    expect(r.sliceIndex).toBe(0)
    expect(r.usedSlices).toEqual([1, 2, 0])

    // 继续轮转：1 → 2 → 0 …
    cur = { ...cur, usedSlices: { [song.id]: r.usedSlices } }
    r = pickSlice(cur, song)
    expect(r.sliceIndex).toBe(1)

    cur = { ...cur, usedSlices: { [song.id]: r.usedSlices } }
    r = pickSlice(cur, song)
    expect(r.sliceIndex).toBe(2)
  })

  it('整局里同一首歌从不连续两次用同一段切片', () => {
    const { state, pool } = deal('slice-guard')
    const byId = new Map(pool.map((p) => [p.id, p]))
    let cur = state
    const lastSliceOf = new Map<string, number>()

    for (let i = 0; i < 60; i++) {
      const { reading, usedSlices } = pickNextReading(cur, byId)
      const prev = lastSliceOf.get(reading.songId)
      if (prev !== undefined) expect(reading.sliceIndex).not.toBe(prev)
      lastSliceOf.set(reading.songId, reading.sliceIndex)
      cur = {
        ...cur,
        roundNo: cur.roundNo + 1,
        usedSlices: { ...cur.usedSlices, [reading.songId]: usedSlices },
        history: [
          ...cur.history,
          {
            roundNo: cur.roundNo + 1,
            reading,
            taps: [],
            winner: null,
            transfers: [],
            sends: [],
            cardsLeft: { A: 12, B: 12 },
          },
        ],
      }
    }
  })

  it('牌被取走的曲子退出可读池，不会产生没有对应牌的假场上札', () => {
    const { state } = deal()
    const card = ownCard(state, 'A')
    const songId = state.cards[card]?.songId as string
    const r = adjudicate(state, fieldReading(state, card), [{ player: 'A', cardId: card, reactionMs: 800 }], cfg)
    const next = applyRound(state, r)
    expect(liveFieldSongs(next)).not.toContain(songId)
    expect(next.retired).toContain(songId)
  })
})

describe('胜负', () => {
  it('先清空自陣者胜', () => {
    const { state } = deal()
    let cur = state
    // 让 A 不断取自陣牌直到清空
    while (cur.layout.A.length > 0) {
      const card = cur.layout.A[0] as CardId
      const r = adjudicate(
        cur,
        fieldReading(cur, card, cur.roundNo + 1),
        [{ player: 'A', cardId: card, reactionMs: 800 }],
        cfg,
      )
      cur = applyRound(cur, r)
    }
    expect(cur.phase).toBe('over')
    expect(cur.winner).toBe('A')
  })
})

describe('整局模拟', () => {
  /** 从固定 seed 驱动一整局，双方按确定性策略应答 */
  function simulate(seed: string): MatchState {
    const { state, pool } = deal(seed)
    const byId = new Map(pool.map((p) => [p.id, p]))
    let cur = state
    let guard = 0

    while (cur.phase !== 'over' && guard++ < 300) {
      const { reading, usedSlices } = pickNextReading(cur, byId)
      cur = { ...cur, usedSlices: { ...cur.usedSlices, [reading.songId]: usedSlices } }

      const taps: Tap[] = []
      if (reading.kind === 'field') {
        const card = Object.values(cur.cards).find(
          (c) => c.owner !== null && c.songId === reading.songId,
        )
        if (card) {
          // A 稍快，B 偶尔点错——制造出各种分支
          taps.push({ player: 'A', cardId: card.id, reactionMs: 800 + (guard % 7) * 30 })
          if (guard % 3 === 0) {
            const other = Object.values(cur.cards).find((c) => c.owner !== null && c.id !== card.id)
            if (other) taps.push({ player: 'B', cardId: other.id, reactionMs: 1500 })
          }
        }
      } else if (guard % 5 === 0) {
        // 偶尔在空札上失误
        const any = Object.values(cur.cards).find((c) => c.owner !== null)
        if (any) taps.push({ player: 'B', cardId: any.id, reactionMs: 1000 })
      }

      cur = applyRound(cur, adjudicate(cur, reading, taps, cfg))
    }
    return cur
  }

  it('能在合理回合数内分出胜负', () => {
    const cur = simulate('match-1')
    expect(cur.phase).toBe('over')
    expect(cur.winner).not.toBeNull()
    expect(cur.history.length).toBeGreaterThan(5)
    expect(cur.history.length).toBeLessThan(300)
  })

  it('同一 seed 复现同一局（可从 seed 复现任何 bug）', () => {
    const a = simulate('match-42')
    const b = simulate('match-42')
    expect(a.winner).toBe(b.winner)
    expect(a.history.length).toBe(b.history.length)
    expect(a.history.map((h) => h.reading)).toEqual(b.history.map((h) => h.reading))
  })

  it('全程牌数守恒：场上牌 = 双方自陣之和 + 已移除', () => {
    const cur = simulate('match-7')
    const removed = Object.values(cur.cards).filter((c) => c.owner === null).length
    expect(cur.layout.A.length + cur.layout.B.length + removed).toBe(cfg.fieldCards)
  })

  it('任何一张牌都不会同时出现在双方自陣', () => {
    const cur = simulate('match-9')
    const overlap = cur.layout.A.filter((c) => cur.layout.B.includes(c))
    expect(overlap).toEqual([])
  })

  it('多个 seed 都能正常收敛', () => {
    for (let i = 0; i < 25; i++) {
      const cur = simulate(`bulk-${i}`)
      expect(cur.phase).toBe('over')
      expect(cur.winner).not.toBeNull()
    }
  })
})
