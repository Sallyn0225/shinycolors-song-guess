import type { PlayerId, RoundResultView, TapVerdict } from '@scg/shared'

/** 算「取到了」的判定 */
const GOOD: TapVerdict[] = ['correct', 'tie', 'clamped']
/** 算お手つき的判定 */
const FAULT: TapVerdict[] = ['wrong', 'otetsuki_karafuda', 'too_early']

export interface Narration {
  headline: string
  detail: string
  tone: 'good' | 'bad' | 'neutral'
}

/**
 * 把一回合的结果讲清楚。
 *
 * 情况比想象中多：空札 / 场上札 × 无人出手 / 一人出手 / 双方出手，
 * 双方出手里又分「都对」「一对一错」「都错」「同時」「抢跑」。
 * 每种都要说清楚发生了什么、谁快多少，否则玩家只看到牌变了却不知道为什么。
 */
export function narrateRound(
  result: RoundResultView,
  names: Record<PlayerId, string>,
  me: PlayerId,
): Narration {
  const label = (p: PlayerId) => (p === me ? '你' : names[p])
  const taps = result.taps
  const good = taps.filter((t) => GOOD.includes(t.verdict))
  const faults = taps.filter((t) => FAULT.includes(t.verdict))
  const tooLate = taps.filter((t) => t.verdict === 'too_late')
  const isTie = taps.some((t) => t.verdict === 'tie')

  const faultLine = faults.length
    ? faults
        .map((f) => `${label(f.player)} ${f.verdict === 'too_early' ? '抢跑' : 'お手つき'}`)
        .join('，')
    : ''

  // ── 空札 ────────────────────────────────────────────
  if (result.kind === 'karafuda') {
    if (faults.length === 0) {
      return {
        headline: '空札 —— 都忍住了',
        detail: taps.length ? '有人出手但已超时，不计失误' : '场上没有这张牌，不出手才是对的',
        tone: 'good',
      }
    }
    if (faults.length === 2) {
      return { headline: '空札 —— 双方都お手つき', detail: '互相送一张，净变化为零', tone: 'neutral' }
    }
    const f = faults[0]!
    return {
      headline: `空札 —— ${label(f.player)}お手つき`,
      detail: `${label(f.player === me ? me : f.player)}被送一张牌`,
      tone: f.player === me ? 'bad' : 'good',
    }
  }

  // ── 场上札 ──────────────────────────────────────────
  if (!result.winner) {
    if (taps.length === 0) {
      return { headline: '无人取得', detail: '这张牌留在场上，之后还会再读', tone: 'neutral' }
    }
    if (faults.length === 2) {
      return { headline: '双方都点错了', detail: `${faultLine}，互相送一张`, tone: 'neutral' }
    }
    if (faults.length === 1) {
      const f = faults[0]!
      return {
        headline: `${label(f.player)}点错了`,
        detail: `${faultLine}；正确的那张仍在场上`,
        tone: f.player === me ? 'bad' : 'good',
      }
    }
    return { headline: '无人取得', detail: tooLate.length ? '出手已超时' : '这张牌留在场上', tone: 'neutral' }
  }

  const winner = result.winner
  const mine = winner === me
  const winTap = good.find((t) => t.player === winner)
  const other = good.find((t) => t.player !== winner)

  if (isTie) {
    return {
      headline: `同時 —— 判给${label(winner)}`,
      detail: `两边差不到判定阈值，牌归其所在领地的一方；双方都不算お手つき`,
      tone: mine ? 'good' : 'bad',
    }
  }

  const took = result.transfers.find((t) => t.cause === 'take')
  const fromEnemy = took && took.from !== 'field' && took.from !== winner
  const okuri = result.transfers.find((t) => t.cause === 'okuri')

  const parts: string[] = []
  if (winTap) parts.push(`${winTap.reactionMs}ms`)
  if (winTap && other) parts.push(`快 ${Math.abs(other.reactionMs - winTap.reactionMs)}ms`)
  if (fromEnemy) parts.push(okuri ? '取敵陣，送出一张' : '取敵陣')
  else parts.push('取自陣')
  if (faultLine) parts.push(faultLine)

  return {
    headline: `${label(winner)}取得`,
    detail: parts.join(' · '),
    tone: mine ? 'good' : 'bad',
  }
}
