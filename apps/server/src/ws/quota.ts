/**
 * 按来源 IP 的滑动窗口计数器。
 *
 * 存在的理由：房间列表把建房入口开放给了任何拿到网址的人，
 * 而 `hub.ts` 原有的限流是**按连接**的（1s / 60 条），对「开一条连接建一个房、
 * 建完就断、再开一条」这种模式完全无效——每条连接都是干净的。
 * 配额必须挂在比连接更长命的东西上，这里选 IP。
 *
 * 实现上刻意不开清理定时器：每次 `hit` 先把过期时间戳裁掉，
 * 桶空了就顺手删掉整个键。这样内存占用与「最近一个窗口内活跃过的 IP 数」成正比，
 * 而不是与「历史上出现过的 IP 数」成正比。
 */
export type QuotaBucket = 'create' | 'joinFail'

interface Bucket {
  hits: number[]
}

export class IpQuota {
  private readonly buckets = new Map<string, Bucket>()

  /**
   * 记一次并判断是否超限。
   *
   * @returns `true` = 这一次**已经越界**，调用方应当拒绝
   *
   * `max` 为 0 时永远越界（用于把某个入口整体关掉）。
   */
  hit(ip: string, bucket: QuotaBucket, windowMs: number, max: number): boolean {
    const key = `${bucket}:${ip}`
    const now = Date.now()
    const b = this.buckets.get(key) ?? { hits: [] }

    // 先裁窗口再记这一次，否则窗口边界上会多放行一次
    b.hits = b.hits.filter((t) => now - t < windowMs)
    b.hits.push(now)

    if (b.hits.length === 0) this.buckets.delete(key)
    else this.buckets.set(key, b)

    return b.hits.length > max
  }

  /** 只看不记。用于「先查配额再决定要不要计数」的场景 */
  peek(ip: string, bucket: QuotaBucket, windowMs: number): number {
    const b = this.buckets.get(`${bucket}:${ip}`)
    if (!b) return 0
    const now = Date.now()
    return b.hits.filter((t) => now - t < windowMs).length
  }

  /** 测试用。生产代码里不需要——过期的桶会在下一次 `hit` 时自己消失 */
  clear(): void {
    this.buckets.clear()
  }
}
