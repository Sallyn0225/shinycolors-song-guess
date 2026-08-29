/**
 * 计分参数。答对是基础分，剩下的按「认出得有多快」给。
 *
 * 设计意图：让「一听就认出」和「拖到最后一秒蒙对」拉开差距——
 * 猜歌游戏考的是辨识速度，不只是辨识本身。
 */
export const SCORING = {
  /** 答对的基础分。只要答对就一定拿到 */
  base: 100,
  /** 速度奖励上限。瞬间答对拿满，卡着截止时间答对拿 0 */
  speedBonus: 100,
  /**
   * 速度曲线指数。
   * >1 会让奖励在前段衰减更慢——认出一首歌本来就需要几秒，
   * 线性衰减会让「正常速度答对」显得像失败。1.6 让前 40% 时间内仍能拿到大部分奖励。
   */
  speedCurve: 1.6,
  /**
   * 每次重听的额外扣分。
   * 重听本身已经在消耗答题时间（倒计时不暂停），这里只再加一点点，
   * 避免「反正时间够，先重听两遍」变成无脑最优解。
   */
  replayPenalty: 10,
} as const

export interface ScoreBreakdown {
  total: number
  base: number
  speed: number
  replayPenalty: number
}
