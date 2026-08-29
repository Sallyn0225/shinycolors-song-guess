import { cardsLeft } from './deal.js'
import type {
  CardId,
  KarutaConfig,
  MatchState,
  PlayerId,
  Reading,
  RoundResult,
  Tap,
  TapVerdict,
  Transfer,
} from './types.js'
import { OPPONENT } from './types.js'

interface Judged extends Tap {
  verdict: TapVerdict
}

/**
 * 判定一回合。纯函数：给定状态、读札、双方的点击，算出结果。
 *
 * 判定基于**相对片段起播的反应时间**，不是服务器收包时间——这样网络延迟不影响胜负。
 * （服务器侧还要做一层交叉校验来防伪报，那属于传输层，不在规则引擎里。）
 */
export function adjudicate(
  state: MatchState,
  reading: Reading,
  taps: readonly Tap[],
  config: KarutaConfig,
): RoundResult {
  const judged: Judged[] = []

  // ── 1. 逐个分类 ──────────────────────────────────────
  for (const tap of taps) {
    const card = state.cards[tap.cardId]
    if (!card || card.owner === null) {
      judged.push({ ...tap, verdict: 'wrong' })
      continue
    }
    if (tap.reactionMs < config.minHumanReactionMs) {
      // 辨认一首还没听到的歌是不可能的——抢跑按お手つき处理
      judged.push({ ...tap, verdict: 'too_early' })
      continue
    }
    if (tap.reactionMs > config.windowMs) {
      judged.push({ ...tap, verdict: 'too_late' })
      continue
    }
    if (reading.kind === 'karafuda') {
      // 空札时碰任何牌都是お手つき
      judged.push({ ...tap, verdict: 'otetsuki_karafuda' })
      continue
    }
    judged.push({ ...tap, verdict: card.songId === reading.songId ? 'correct' : 'wrong' })
  }

  // ── 2. 定胜者 ────────────────────────────────────────
  const corrects = judged
    .filter((j) => j.verdict === 'correct')
    .sort((a, b) => a.reactionMs - b.reactionMs)

  let winner: PlayerId | null = null
  let takenCardId: CardId | null = null

  if (corrects.length > 0) {
    const first = corrects[0] as Judged
    const second = corrects[1]
    takenCardId = first.cardId

    if (second && Math.abs(second.reactionMs - first.reactionMs) < config.tieEpsilonMs) {
      // 同時：牌判给该牌所在领地的一方（自陣优势），双方都不算お手つき。
      // 确定性优于抛硬币，也契合歌牌的领地逻辑，且无法被主动制造。
      for (const j of judged) if (j.verdict === 'correct') j.verdict = 'tie'
      winner = state.cards[first.cardId]?.owner ?? null
    } else {
      winner = first.player
    }
  }

  // ── 3. 转移 ──────────────────────────────────────────
  const transfers: Transfer[] = []
  const layout: Record<PlayerId, CardId[]> = { A: [...state.layout.A], B: [...state.layout.B] }
  const cards = { ...state.cards }

  const removeFrom = (p: PlayerId, cardId: CardId): void => {
    layout[p] = layout[p].filter((c) => c !== cardId)
  }

  if (winner && takenCardId) {
    const card = cards[takenCardId]
    const from = card?.owner
    if (card && from) {
      cards[takenCardId] = { ...card, owner: null }
      removeFrom(from, takenCardId)
      transfers.push({ cardId: takenCardId, from, to: 'removed', cause: 'take' })

      // 取敵陣牌要从自陣送 1 张给对手（送り札）。
      //
      // 账面：敵陣 -1（被取走）+1（收到送札）= 0，自陣 -1（送出去的）。
      // 也就是说**牌数上和取自陣牌一样，都是自陣 -1**——常说的「取敵陣值 2 枚」
      // 指的是节奏而非牌数：你拿走那张牌，等于剥夺了对手用它给自己 -1 的机会，
      // 外加送札由你挑（把最难记的那张丢过去）。
      if (from !== winner) {
        const send = layout[winner][0]
        if (send) {
          removeFrom(winner, send)
          layout[from].push(send)
          const sc = cards[send]
          if (sc) cards[send] = { ...sc, owner: from }
          transfers.push({ cardId: send, from: winner, to: from, cause: 'okuri' })
        }
      }
    }
  }

  // ── 4. お手つき罚牌：对手送你 1 张 ─────────────────────
  const faulted = new Set<PlayerId>()
  for (const j of judged) {
    if (j.verdict === 'wrong' || j.verdict === 'otetsuki_karafuda' || j.verdict === 'too_early') {
      faulted.add(j.player)
    }
  }
  for (const p of faulted) {
    const opp = OPPONENT[p]
    const send = layout[opp][0]
    if (!send) continue // 对手已无牌可送——此时对手其实已经赢了
    removeFrom(opp, send)
    layout[p].push(send)
    const sc = cards[send]
    if (sc) cards[send] = { ...sc, owner: p }
    transfers.push({ cardId: send, from: opp, to: p, cause: 'otetsuki' })
  }

  return {
    roundNo: reading.roundNo,
    reading,
    taps: judged,
    winner,
    transfers,
    cardsLeft: { A: layout.A.length, B: layout.B.length },
  }
}

/**
 * 把回合结果落到状态上。
 *
 * adjudicate 已经算出了全部转移，这里重放它们，保证「判定」和「落库」用的是同一套逻辑。
 */
export function applyRound(state: MatchState, result: RoundResult): MatchState {
  const cards = { ...state.cards }
  const layout: Record<PlayerId, CardId[]> = { A: [...state.layout.A], B: [...state.layout.B] }

  for (const t of result.transfers) {
    if (t.from !== 'field') layout[t.from] = layout[t.from].filter((c) => c !== t.cardId)
    if (t.to === 'removed') {
      const c = cards[t.cardId]
      if (c) cards[t.cardId] = { ...c, owner: null }
    } else {
      layout[t.to].push(t.cardId)
      const c = cards[t.cardId]
      if (c) cards[t.cardId] = { ...c, owner: t.to }
    }
  }

  const retired = [...state.retired]
  if (result.winner && result.reading.kind === 'field') {
    const taken = result.transfers.find((t) => t.cause === 'take')
    if (taken) {
      const stillOnField = Object.values(cards).some(
        (c) => c.owner !== null && c.songId === result.reading.songId,
      )
      // 该曲在场上已无牌 → 退役，避免读到没有对应牌的「假场上札」
      if (!stillOnField) retired.push(result.reading.songId)
    }
  }

  const next: MatchState = {
    ...state,
    roundNo: result.roundNo,
    cards,
    layout,
    retired,
    usedSlices: {
      ...state.usedSlices,
      [result.reading.songId]: state.usedSlices[result.reading.songId] ?? [],
    },
    history: [...state.history, result],
    phase: 'playing',
    winner: null,
  }

  // 先清空自陣者胜
  const left = cardsLeft(next)
  if (left.A === 0 || left.B === 0) {
    next.phase = 'over'
    next.winner = left.A === 0 ? 'A' : 'B'
  }
  return next
}

/** 记录本回合用掉的切片下标，保证同一首歌重播时换一段 */
export function noteSliceUsed(state: MatchState, songId: string, usedSlices: number[]): MatchState {
  return { ...state, usedSlices: { ...state.usedSlices, [songId]: usedSlices } }
}
