import type { PlayerId, RoundResultView, TapVerdict } from '@scg/shared'
import type { TFunction } from 'i18next'

import i18n from '../i18n'

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
  translate: TFunction = i18n.getFixedT('zh'),
): Narration {
  const t = translate
  const label = (p: PlayerId) => (p === me ? t('common.you') : names[p])
  const taps = result.taps
  const good = taps.filter((t) => GOOD.includes(t.verdict))
  const faults = taps.filter((t) => FAULT.includes(t.verdict))
  const tooLate = taps.filter((t) => t.verdict === 'too_late')
  const isTie = taps.some((t) => t.verdict === 'tie')

  const faultLine = faults.length
    ? faults
        .map((f) => `${label(f.player)} ${f.verdict === 'too_early' ? t('karuta.tooEarly') : t('karuta.otetsuki')}`)
        .join('，')
    : ''

  // ── 空札 ────────────────────────────────────────────
  if (result.kind === 'karafuda') {
    if (faults.length === 0) {
      return {
        headline: t('narrate.karafudaSafeHeadline'),
        detail: taps.length ? t('narrate.karafudaSafeLate') : t('narrate.karafudaSafeNone'),
        tone: 'good',
      }
    }
    if (faults.length === 2) {
      return { headline: t('narrate.karafudaBothFault'), detail: t('narrate.karafudaBothFaultDetail'), tone: 'neutral' }
    }
    const f = faults[0]!
    return {
      headline: t('narrate.karafudaFault', { name: label(f.player) }),
      detail: t('narrate.karafudaFaultDetail', { name: label(f.player === me ? me : f.player) }),
      tone: f.player === me ? 'bad' : 'good',
    }
  }

  // ── 场上札 ──────────────────────────────────────────
  if (!result.winner) {
    if (taps.length === 0) {
      return { headline: t('narrate.noWinner'), detail: t('narrate.cardRemains'), tone: 'neutral' }
    }
    if (faults.length === 2) {
      return { headline: t('narrate.bothWrong'), detail: t('narrate.bothWrongDetail', { faults: faultLine }), tone: 'neutral' }
    }
    if (faults.length === 1) {
      const f = faults[0]!
      return {
        headline: t('narrate.oneWrong', { name: label(f.player) }),
        detail: t('narrate.oneWrongDetail', { faults: faultLine }),
        tone: f.player === me ? 'bad' : 'good',
      }
    }
    return { headline: t('narrate.noWinner'), detail: tooLate.length ? t('narrate.tooLate') : t('narrate.cardRemains'), tone: 'neutral' }
  }

  const winner = result.winner
  const mine = winner === me
  const winTap = good.find((t) => t.player === winner)
  const other = good.find((t) => t.player !== winner)

  if (isTie) {
    return {
      headline: t('narrate.tieHeadline', { name: label(winner) }),
      detail: t('narrate.tieDetail'),
      tone: mine ? 'good' : 'bad',
    }
  }

  const took = result.transfers.find((t) => t.cause === 'take')
  const fromEnemy = took && took.from !== 'field' && took.from !== winner
  const okuri = result.transfers.find((t) => t.cause === 'okuri')

  const parts: string[] = []
  if (winTap) parts.push(t('narrate.reactionMs', { ms: winTap.reactionMs }))
  if (winTap && other) parts.push(t('narrate.fasterBy', { ms: Math.abs(other.reactionMs - winTap.reactionMs) }))
  if (fromEnemy) parts.push(okuri ? t('narrate.takeEnemyAndSend') : t('narrate.takeEnemy'))
  else parts.push(t('narrate.takeOwn'))
  if (faultLine) parts.push(faultLine)

  return {
    headline: t('narrate.takenBy', { name: label(winner) }),
    detail: parts.join(' · '),
    tone: mine ? 'good' : 'bad',
  }
}
