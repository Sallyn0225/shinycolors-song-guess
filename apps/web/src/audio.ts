/**
 * 音频引擎。
 *
 * 用 Web Audio API 而不是 `<audio>`，理由是后者做不到这里需要的几件事：
 *  - `AudioBufferSourceNode.start(when, offset, duration)` 是采样级精确的调度；
 *    `<audio>.play()` 的启动延迟 50~300ms 且不可预测，1v1 里直接不可用
 *  - 难度截断要精确播前 N 秒；`<audio>` 要靠 setTimeout + pause()，会漂移几十毫秒
 *  - `GainNode` 的 ramp 是采样级的，`<audio>.volume` 分步改会有 zipper noise
 *  - 可以在当前题播放时把下一题**完全解码**成 PCM，起播延迟为 0
 *
 * 单例，绝不放进 React state——音频对象进 state 会因 re-render 重建节点、爆音、泄漏。
 */

const SAMPLE_RATE = 48_000
/** 调度提前量，吸收主线程抖动 */
const LEAD_SEC = 0.06
/**
 * 播放端淡入淡出。
 * 编码时已经烘焙了 20ms/60ms 处理文件两端，但难度截断会在**文件中间**切断
 * （比如只播 6 秒），文件自带的 14.94s 处淡出完全帮不上忙，所以这里必须再做一层。
 */
const FADE_IN_SEC = 0.025
const FADE_OUT_SEC = 0.06

export class AudioEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private analyser: AnalyserNode | null = null
  private freq: Uint8Array | null = null
  private current: AudioBufferSourceNode | null = null
  /** 当前这次播放的结束时刻（ctx 时间轴）。由引擎自己维护，避免 React state 走味 */
  private playUntil = 0
  /** 只保留 3 个解码好的 buffer（15s mono 解码后约 2.9MB），移动端不会被杀 */
  private readonly cache = new Map<string, AudioBuffer>()
  private readonly order: string[] = []
  private readonly inflight = new Map<string, Promise<AudioBuffer>>()
  /** 这台设备解不了 Opus，已切到 AAC 兜底 */
  private preferFallback = false

  get unlocked(): boolean {
    return this.ctx !== null && this.ctx.state === 'running'
  }

  /**
   * 必须在**真实用户手势**的调用栈里执行。
   * 忘了这一步，线上第一题全场静音——而本地热重载的开发页面永远不会复现。
   */
  async unlock(): Promise<void> {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' })
      this.master = this.ctx.createGain()
      // 可视化挂在 master 之后：画面直接由正在播放的音频驱动，不是假动画
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = 256
      this.analyser.smoothingTimeConstant = 0.72
      this.freq = new Uint8Array(this.analyser.frequencyBinCount)
      this.master.connect(this.analyser)
      this.analyser.connect(this.ctx.destination)
    }
    await this.ctx.resume()
    // 播一个空 buffer，某些 iOS 版本要靠这个才真正解锁
    const s = this.ctx.createBufferSource()
    s.buffer = this.ctx.createBuffer(1, 1, SAMPLE_RATE)
    s.connect(this.ctx.destination)
    s.start(0)
  }

  private remember(key: string, buf: AudioBuffer): void {
    this.cache.set(key, buf)
    this.order.push(key)
    while (this.order.length > 3) {
      const drop = this.order.shift()
      if (drop && drop !== key) this.cache.delete(drop)
    }
  }

  private async fetchDecode(ctx: AudioContext, url: string): Promise<AudioBuffer> {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const bytes = await res.arrayBuffer()
    // decodeAudioData 会 detach 传入的 ArrayBuffer，所以先留一份副本
    return ctx.decodeAudioData(bytes.slice(0))
  }

  /**
   * 下载并解码，结果进 LRU。可提前对下一题调用以消除起播等待。
   *
   * `fallbackUrl` 是 AAC 兜底：Safari 18.4（2025-03）以前 Ogg Opus 解不了，
   * 而这**不能靠 `canPlayType` 提前判断**——iOS 上它会说谎。只能真解一次看它成不成，
   * 成功切到兜底后记住，后续直接走兜底，不再每题白试一遍 Opus。
   */
  async prefetch(key: string, url: string, fallbackUrl?: string): Promise<AudioBuffer> {
    const hit = this.cache.get(key)
    if (hit) return hit
    const pending = this.inflight.get(key)
    if (pending) return pending

    const task = (async () => {
      if (!this.ctx) await this.unlock()
      const ctx = this.ctx
      if (!ctx) throw new Error('AudioContext 未初始化')

      const urls = this.preferFallback && fallbackUrl ? [fallbackUrl] : [url, ...(fallbackUrl ? [fallbackUrl] : [])]

      let lastErr: unknown
      for (let attempt = 0; attempt < 3; attempt++) {
        for (const [i, u] of urls.entries()) {
          try {
            const buf = await this.fetchDecode(ctx, u)
            // 主格式解不了、兜底能解 —— 这台设备以后一律走兜底
            if (i > 0) this.preferFallback = true
            this.remember(key, buf)
            return buf
          } catch (err) {
            lastErr = err
          }
        }
        await new Promise((r) => setTimeout(r, 200 * 3 ** attempt))
      }
      throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
    })()

    this.inflight.set(key, task)
    try {
      return await task
    } finally {
      this.inflight.delete(key)
    }
  }

  /**
   * 是否正在出声。
   *
   * 由引擎依据实际调度的结束时刻判断，而不是 React state ——
   * 之前用 `setTimeout` 配合 state 标记，重听时旧的 timeout 会把新播放的可视化误杀掉。
   */
  get isPlaying(): boolean {
    const ctx = this.ctx
    return ctx !== null && ctx.currentTime < this.playUntil
  }

  stop(): void {
    if (this.current) {
      try {
        this.current.stop()
      } catch {
        /* 已经停了 */
      }
      this.current = null
    }
    this.playUntil = 0
  }

  /** 把本地 Date.now() 时刻换算成 AudioContext 时间轴上的时刻 */
  ctxTimeFor(localEpochMs: number): number {
    const ctx = this.ctx
    if (!ctx) return 0
    return ctx.currentTime + (localEpochMs - Date.now()) / 1000
  }

  /**
   * 播放某个切片的前 `seconds` 秒。
   * 切片文件恒为 15 秒——难度只体现在这里的截断，文件本身不携带任何难度信息。
   *
   * `atCtxTime` 用于 1v1：双方按同步过的时钟换算出同一个起播时刻，
   * 这样比较「相对起播的反应时间」才有意义。
   */
  async play(
    key: string,
    url: string,
    seconds: number,
    atCtxTime?: number,
    fallbackUrl?: string,
  ): Promise<{ startedAtCtxTime: number }> {
    const buf = await this.prefetch(key, url, fallbackUrl)
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) throw new Error('AudioContext 未初始化')

    this.stop()

    const dur = Math.min(seconds, buf.duration)
    const t0 = Math.max(ctx.currentTime + 0.01, atCtxTime ?? ctx.currentTime + LEAD_SEC)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0, t0)
    gain.gain.linearRampToValueAtTime(1, t0 + FADE_IN_SEC)
    gain.gain.setValueAtTime(1, t0 + dur - FADE_OUT_SEC)
    gain.gain.linearRampToValueAtTime(0.0001, t0 + dur)

    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(gain).connect(master)
    src.start(t0, 0, dur + 0.01)
    src.stop(t0 + dur + 0.01)
    this.current = src
    this.playUntil = t0 + dur

    return { startedAtCtxTime: t0 }
  }

  /**
   * 玩家**听到**片段第几毫秒时按下的。
   *
   * 不能用 `ctx.currentTime` —— 那是调度时钟，实际出声还要加硬件输出延迟：
   * 有线 20~40ms，**蓝牙 150~300ms**。戴蓝牙耳机的玩家每回合都晚听到四分之一秒，
   * 会输掉所有接近的回合，而这在有线台式机上测试时完全看不出来。
   * `getOutputTimestamp()` 报告的是当前**正在被听到**的采样，能自动吸收这段延迟。
   */
  reactionMsSince(startedAtCtxTime: number, eventTimeStamp: number): number | null {
    const ctx = this.ctx
    if (!ctx) return null
    const ts = ctx.getOutputTimestamp?.()
    if (!ts || ts.contextTime === undefined || ts.performanceTime === undefined) {
      return (ctx.currentTime - startedAtCtxTime) * 1000
    }
    const heardNow = ts.contextTime + (eventTimeStamp - ts.performanceTime) / 1000
    return (heardNow - startedAtCtxTime) * 1000
  }

  /**
   * 取当前频谱（0~1）。给可视化用。
   * 复用同一个 Uint8Array，避免每帧分配。
   */
  spectrum(out: Float32Array): boolean {
    const a = this.analyser
    const f = this.freq
    if (!a || !f) return false
    a.getByteFrequencyData(f as unknown as Uint8Array<ArrayBuffer>)
    const n = Math.min(out.length, f.length)
    for (let i = 0; i < n; i++) out[i] = (f[i] as number) / 255
    return true
  }

  /** 输出延迟（秒）。明显偏大时提示玩家换有线 */
  get outputLatency(): number {
    const ctx = this.ctx
    if (!ctx) return 0
    return ctx.outputLatency || ctx.baseLatency || 0
  }
}

export const audio = new AudioEngine()
