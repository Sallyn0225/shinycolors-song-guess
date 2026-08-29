import { describe, expect, it } from 'vitest'
import type { PlayerId, RoundResultView, TapVerdict } from '@scg/shared'

import { narrateRound } from './narrate'

const NAMES: Record<PlayerId, string> = { A: '我方', B: '对手' }

function round(over: Partial<RoundResultView> = {}): RoundResultView {
  return {
    roundNo: 1,
    kind: 'field',
    revealed: { songId: 's', title: '曲名', artist: '组合', coverUrl: '/cover/s.webp' },
    taps: [],
    winner: null,
    transfers: [],
    cardsLeft: { A: 12, B: 12 },
    ...over,
  }
}

const tap = (player: PlayerId, verdict: TapVerdict, reactionMs = 900, cardId = 'c1') => ({
  player,
  cardId,
  reactionMs,
  verdict,
})

describe('空札', () => {
  it('双方都没出手 —— 这是正确的应对', () => {
    const n = narrateRound(round({ kind: 'karafuda' }), NAMES, 'A')
    expect(n.tone).toBe('good')
    expect(n.headline).toContain('空札')
    expect(n.headline).toContain('忍住')
  })

  it('我出手了 —— 我お手つき', () => {
    const n = narrateRound(
      round({ kind: 'karafuda', taps: [tap('A', 'otetsuki_karafuda')] }),
      NAMES,
      'A',
    )
    expect(n.tone).toBe('bad')
    expect(n.headline).toContain('你')
    expect(n.headline).toContain('お手つき')
  })

  it('对手出手了 —— 对我是好事', () => {
    const n = narrateRound(
      round({ kind: 'karafuda', taps: [tap('B', 'otetsuki_karafuda')] }),
      NAMES,
      'A',
    )
    expect(n.tone).toBe('good')
    expect(n.headline).toContain('对手')
  })

  it('双方都出手 —— 互相送牌，净变化为零', () => {
    const n = narrateRound(
      round({
        kind: 'karafuda',
        taps: [tap('A', 'otetsuki_karafuda'), tap('B', 'otetsuki_karafuda')],
      }),
      NAMES,
      'A',
    )
    expect(n.tone).toBe('neutral')
    expect(n.headline).toContain('双方')
  })
})

describe('场上札', () => {
  it('无人出手 —— 牌留在场上', () => {
    const n = narrateRound(round(), NAMES, 'A')
    expect(n.headline).toContain('无人取得')
    expect(n.detail).toContain('留在场上')
  })

  it('我取自陣牌', () => {
    const n = narrateRound(
      round({
        taps: [tap('A', 'correct', 820)],
        winner: 'A',
        transfers: [{ cardId: 'c1', from: 'A', to: 'removed', cause: 'take' }],
      }),
      NAMES,
      'A',
    )
    expect(n.tone).toBe('good')
    expect(n.headline).toBe('你取得')
    expect(n.detail).toContain('820ms')
    expect(n.detail).toContain('取自陣')
  })

  it('我取敵陣牌 —— 要说明送出了一张', () => {
    const n = narrateRound(
      round({
        taps: [tap('A', 'correct', 700)],
        winner: 'A',
        transfers: [
          { cardId: 'c1', from: 'B', to: 'removed', cause: 'take' },
          { cardId: 'c9', from: 'A', to: 'B', cause: 'okuri' },
        ],
      }),
      NAMES,
      'A',
    )
    expect(n.detail).toContain('取敵陣')
    expect(n.detail).toContain('送出一张')
  })

  it('双方都点对 —— 要说明快了多少', () => {
    const n = narrateRound(
      round({
        taps: [tap('A', 'correct', 800), tap('B', 'correct', 950)],
        winner: 'A',
        transfers: [{ cardId: 'c1', from: 'A', to: 'removed', cause: 'take' }],
      }),
      NAMES,
      'A',
    )
    expect(n.headline).toBe('你取得')
    expect(n.detail).toContain('800ms')
    expect(n.detail).toContain('快 150ms')
  })

  it('同時 —— 判给领地方，双方都不算失误', () => {
    const n = narrateRound(
      round({
        taps: [tap('A', 'tie', 900), tap('B', 'tie', 910)],
        winner: 'B',
        transfers: [{ cardId: 'c1', from: 'B', to: 'removed', cause: 'take' }],
      }),
      NAMES,
      'A',
    )
    expect(n.headline).toContain('同時')
    expect(n.headline).toContain('对手')
    expect(n.detail).toContain('领地')
    expect(n.tone).toBe('bad')
  })

  it('一人对一人错 —— 两件事都要说', () => {
    const n = narrateRound(
      round({
        taps: [tap('A', 'correct', 800), tap('B', 'wrong', 900, 'c2')],
        winner: 'A',
        transfers: [
          { cardId: 'c1', from: 'A', to: 'removed', cause: 'take' },
          { cardId: 'c7', from: 'A', to: 'B', cause: 'otetsuki' },
        ],
      }),
      NAMES,
      'A',
    )
    expect(n.headline).toBe('你取得')
    expect(n.detail).toContain('对手')
    expect(n.detail).toContain('お手つき')
  })

  it('双方都点错 —— 正确的牌仍在场上', () => {
    const n = narrateRound(
      round({ taps: [tap('A', 'wrong', 800, 'c2'), tap('B', 'wrong', 900, 'c3')] }),
      NAMES,
      'A',
    )
    expect(n.headline).toContain('双方都点错')
    expect(n.tone).toBe('neutral')
  })

  it('只有我点错 —— 正确的牌仍在场上', () => {
    const n = narrateRound(round({ taps: [tap('A', 'wrong', 800, 'c2')] }), NAMES, 'A')
    expect(n.headline).toContain('你点错')
    expect(n.detail).toContain('仍在场上')
    expect(n.tone).toBe('bad')
  })

  it('抢跑要说「抢跑」而不是笼统的お手つき', () => {
    const n = narrateRound(round({ taps: [tap('A', 'too_early', 40)] }), NAMES, 'A')
    expect(n.detail).toContain('抢跑')
  })

  it('超时不算失误', () => {
    const n = narrateRound(round({ taps: [tap('A', 'too_late', 9000)] }), NAMES, 'A')
    expect(n.headline).toContain('无人取得')
    expect(n.detail).not.toContain('お手つき')
  })
})
