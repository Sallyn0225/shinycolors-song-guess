import { KARUTA_DEFAULTS } from '@scg/shared'

/** 上报 RTT 的可信区间。超出即钳制 */
const RTT_MIN_MS = 0
const RTT_MAX_MS = 800

/** 判定容差下限。作弊者的最大收益就被这个数封顶 */
const TOL_FLOOR_MS = 60

export interface Adjudicated {
  /** 采信的反应时间 */
  reactionMs: number
  /** 是否被服务端校正（客户端报了一个物理上不可能的值） */
  clamped: boolean
  verdict: 'ok' | 'too_early' | 'too_late'
}

/**
 * 单个玩家的计时状态。
 *
 * 核心思路：服务端独立算出一个**诚实但有噪声**的反应时间，
 * 用客户端**精确但可伪造**的数字去精修它。
 */
export class PlayerTiming {
  private rttSamples: number[] = []
  /**
   * 自校准的单向延迟下界。
   *
   * 对诚实玩家，`到达时刻 - 起播时刻 - 反应时间` 就约等于单向延迟。
   * 取历史最小值——少报 RTT 的人会把这个值压低，反而让自己后续更容易被判 clamped。
   */
  private owdFloor = Infinity

  clampedCount = 0
  reactions: number[] = []

  /** 客户端上报的 RTT。钳制到可信区间后保留最近若干个样本 */
  noteRtt(rttMs: number): void {
    const clamped = Math.min(RTT_MAX_MS, Math.max(RTT_MIN_MS, rttMs))
    this.rttSamples.push(clamped)
    if (this.rttSamples.length > 12) this.rttSamples.shift()
  }

  get rttMs(): number | null {
    if (this.rttSamples.length === 0) return null
    const sorted = [...this.rttSamples].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)] ?? null
  }

  /** 抖动：用于自适应容差。线路差的玩家不该因为线路差被冤枉 */
  get jitterMs(): number {
    if (this.rttSamples.length < 3) return 0
    const mean = this.rttSamples.reduce((a, b) => a + b, 0) / this.rttSamples.length
    const varSum = this.rttSamples.reduce((a, b) => a + (b - mean) ** 2, 0)
    return Math.sqrt(varSum / this.rttSamples.length)
  }

  private get owdMs(): number {
    const reported = (this.rttMs ?? 0) / 2
    // 取上报值与自校准下界的较小者：少报 RTT 换不来好处
    return Math.max(0, Math.min(reported, this.owdFloor === Infinity ? reported : this.owdFloor))
  }

  get toleranceMs(): number {
    return Math.max(TOL_FLOOR_MS, 3 * this.jitterMs)
  }

  /**
   * 判定一次点击。
   *
   * 关键洞察：作弊者只能把「到达时刻」推后，不可能让包在发出之前到达。
   * 所以 `到达时刻 - 起播时刻 - 单向延迟` 是诚实行为的**下界**，可以当锚点。
   */
  adjudicate(args: {
    claimedReactionMs: number
    arrivedAtServer: number
    roundStartServerTime: number
    windowMs: number
  }): Adjudicated {
    const { claimedReactionMs, arrivedAtServer, roundStartServerTime, windowMs } = args

    if (claimedReactionMs < KARUTA_DEFAULTS.minHumanReactionMs) {
      return { reactionMs: claimedReactionMs, clamped: false, verdict: 'too_early' }
    }
    if (claimedReactionMs > windowMs) {
      return { reactionMs: claimedReactionMs, clamped: false, verdict: 'too_late' }
    }

    const serverReaction = arrivedAtServer - roundStartServerTime - this.owdMs

    // 自校准：诚实玩家的这个差值就约等于单向延迟
    const implied = arrivedAtServer - roundStartServerTime - claimedReactionMs
    if (implied >= 0 && implied < this.owdFloor) this.owdFloor = implied

    if (serverReaction < claimedReactionMs - this.toleranceMs) {
      // 客户端报了一个物理上不可能这么早的值 —— 改用服务端自己算的
      this.clampedCount++
      const corrected = Math.max(KARUTA_DEFAULTS.minHumanReactionMs, serverReaction)
      this.reactions.push(corrected)
      return { reactionMs: corrected, clamped: true, verdict: 'ok' }
    }

    this.reactions.push(claimedReactionMs)
    return { reactionMs: claimedReactionMs, clamped: false, verdict: 'ok' }
  }

  get avgReactionMs(): number | null {
    if (this.reactions.length === 0) return null
    return Math.round(this.reactions.reduce((a, b) => a + b, 0) / this.reactions.length)
  }
}
