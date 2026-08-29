import { SCORING, type ScoreBreakdown } from '@scg/shared'

export interface ScoreInput {
  correct: boolean
  /** 从题目开始计时到提交的毫秒数 */
  elapsedMs: number
  /** 该难度的答题时限（毫秒） */
  limitMs: number
  replaysUsed: number
}

/**
 * 单题得分。
 *
 * 答错得 0——不用负分，因为惩罚已经体现在「没拿到这题的分」上，
 * 再扣分会让一局里的一次失误产生不成比例的挫败感。
 */
export function scoreAnswer(input: ScoreInput): ScoreBreakdown {
  if (!input.correct) {
    return { total: 0, base: 0, speed: 0, replayPenalty: 0 }
  }

  const ratio = input.limitMs > 0 ? input.elapsedMs / input.limitMs : 1
  const left = Math.min(1, Math.max(0, 1 - ratio))
  const speed = Math.round(SCORING.speedBonus * left ** (1 / SCORING.speedCurve))
  const penalty = Math.min(
    SCORING.base + speed,
    Math.max(0, input.replaysUsed) * SCORING.replayPenalty,
  )

  return {
    total: SCORING.base + speed - penalty,
    base: SCORING.base,
    speed,
    replayPenalty: penalty,
  }
}

/** 一局的满分，用于展示「x / 满分」 */
export function maxScore(questionCount: number): number {
  return questionCount * (SCORING.base + SCORING.speedBonus)
}
