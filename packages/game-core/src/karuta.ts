import { cardsLeft } from './deal.js'
import type {
  CardId,
  KarutaConfig,
  MatchState,
  PlayerId,
  Reading,
  RoundResult,
  SendChoices,
  SendRecord,
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
 *
 * `choices` 是玩家自选的送り札。不给、给错、给不够都会回落到自动规则
 * （送自陣待得最久的那张），所以这个函数**永远**能算出一个确定的结果——
 * 上层可以放心地先用无 choices 跑一遍拿到「谁需要选」，再带着选择重跑一遍定案。
 * 两次调用的输入相同，纯函数保证除送出的牌之外结果完全一致。
 */
export function adjudicate(
  state: MatchState,
  reading: Reading,
  taps: readonly Tap[],
  config: KarutaConfig,
  choices?: SendChoices,
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
  const sends: SendRecord[] = []
  const layout: Record<PlayerId, CardId[]> = { A: [...state.layout.A], B: [...state.layout.B] }
  const cards = { ...state.cards }

  const removeFrom = (p: PlayerId, cardId: CardId): void => {
    layout[p] = layout[p].filter((c) => c !== cardId)
  }

  const queues: Record<PlayerId, CardId[]> = {
    A: [...(choices?.A ?? [])],
    B: [...(choices?.B ?? [])],
  }
  /** 本回合刚收到的牌。刚到手的牌不能立刻再送出去 */
  const incoming: Record<PlayerId, Set<CardId>> = { A: new Set(), B: new Set() }

  /**
   * 从 `from` 的自陣挑一张送给 `to`，并落到 layout/cards/transfers 上。
   *
   * 优先用玩家排好的选择；不合法就丢弃继续往后找，全都不合法则回落到 `layout[from][0]`
   * ——即自陣里待得最久的那张。自动规则是**确定性**的，玩家能预判，
   * 所以它是策略的一部分而不是噪声。
   *
   * 候选集**排除本回合刚收到的牌**。这不只是「刚到手的牌不该马上转手」这条直觉——
   * 双方在同一回合各要送一张时（互相お手つき），若把收到的牌算进去，
   * 后一个人的候选集就会随前一个人的选择而变，等于上层提前公示给玩家的列表当场作废。
   * 排除之后两边的候选集互不影响，「先问后定案」才成立。
   */
  const sendOne = (from: PlayerId, to: PlayerId, cause: 'okuri' | 'otetsuki'): boolean => {
    const own = layout[from].filter((c) => !incoming[from].has(c))
    // 原有的牌全没了（被取走/已送出）才退而求其次，避免出现「有牌却送不出」的死局
    const candidates = own.length > 0 ? own : [...layout[from]]
    if (candidates.length === 0) return false // 已无牌可送——此时 from 其实已经赢了

    let picked: CardId | undefined
    let chosen = false
    while (queues[from].length > 0) {
      const want = queues[from].shift() as CardId
      if (candidates.includes(want)) {
        picked = want
        chosen = true
        break
      }
    }
    if (picked === undefined) picked = candidates[0] as CardId

    removeFrom(from, picked)
    layout[to].push(picked)
    incoming[to].add(picked)
    const sc = cards[picked]
    if (sc) cards[picked] = { ...sc, owner: to }
    transfers.push({ cardId: picked, from, to, cause })
    sends.push({ from, to, cause, cardId: picked, candidates, chosen })
    return true
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
      if (from !== winner) sendOne(winner, from, 'okuri')
    }
  }

  // ── 4. お手つき罚牌：对手送你 1 张 ─────────────────────
  const faulted = new Set<PlayerId>()
  for (const j of judged) {
    if (j.verdict === 'wrong' || j.verdict === 'otetsuki_karafuda' || j.verdict === 'too_early') {
      faulted.add(j.player)
    }
  }
  for (const p of faulted) sendOne(OPPONENT[p], p, 'otetsuki')

  return {
    roundNo: reading.roundNo,
    reading,
    taps: judged,
    winner,
    transfers,
    sends,
    cardsLeft: { A: layout.A.length, B: layout.B.length },
  }
}

/**
 * 本回合有哪些人要挑送り札、各要挑几张、当时能挑哪些。
 *
 * 上层的用法：先用无 choices 的 `adjudicate` 跑一遍拿到这个，问玩家，
 * 再带着答案重跑一遍定案。`candidates` 只给该玩家**第一次**选择时的集合——
 * 要送两张时后一张的可选集合会少掉前一张，由展示层自行排除即可，
 * 服务端重跑时 `adjudicate` 本来就会再校验一次。
 */
export function pendingSends(
  result: RoundResult,
): Array<{ player: PlayerId; count: number; candidates: CardId[] }> {
  const out: Array<{ player: PlayerId; count: number; candidates: CardId[] }> = []
  for (const s of result.sends) {
    const hit = out.find((o) => o.player === s.from)
    if (hit) hit.count++
    else out.push({ player: s.from, count: 1, candidates: s.candidates })
  }
  // 只剩一张可送时没有可选性，别拿一个假选择去打断节奏
  return out.filter((o) => o.candidates.length > 1)
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
