/**
 * 旁路音频层：开场问候语音 + 环境 BGM。
 *
 * 与 `audio.ts` 的关系是**共用 AudioContext、不共用信号链**。
 * 题目音频走 `master → analyser → destination`，这两条声音都不能走：
 *  - 进 `master` 就受音量滑块管，而它们的音量是固定的（见下面两个常量）
 *  - 进 `analyser` 就污染 PrismRail 的频谱，那条频谱的意义是「当前这道题长这样」
 *
 * 所以从 `audio.bypass` 取 ctx 与 destination，自己接一条平行的链。
 *
 * 单例，绝不进 React state —— 音频节点进 state 会因 re-render 重建、爆音、泄漏。
 * 换曲逻辑的纯函数部分在 `features/opening.ts`，那边可以脱离音频引擎直接测。
 *
 * 不走 `api.ts`：那个文件是产线 bugfix 的沉淀，按 spec 不参与 UI 工作的改动。
 * 这里的两个请求足够简单，自己发。
 */

import { audio } from './audio'
import {
  advance,
  createPlaylist,
  currentClip,
  remaining,
  type AmbienceTrack,
  type Playlist,
} from './features/opening'

/**
 * 问候语音的固定增益。
 *
 * 需求是「80% 音量，不可调」。取的是**滑杆语义**的 80%（`audio.ts` 的平方律，
 * 0.8² = 0.64），不是直接 0.8：界面上「音量」一词一直指滑杆位置，
 * VolumeControl 显示的就是那个百分比，需求里的 80% 按用户看得见的那套语义解释。
 *
 * 参照点：默认滑杆位置 0.5（见 prefs.ts）过平方律后是 0.25。
 * 问候比默认响 8dB 是有意的 —— 它是开场焦点，且整局只响一次。
 */
const GREET_GAIN = 0.64

/**
 * BGM 的固定增益。
 *
 * 需求是「比默认音量还要再低一点，不想干扰用户」。默认是 0.25，这里取 0.12，
 * 低 6dB。它是氛围不是内容，压到「注意到有音乐、但不会去听它」的位置。
 */
const BGM_GAIN = 0.12

/** 交叉淡化时长。两段是不同的歌，没有相位相关性，线性 ramp 的中点凹陷听不出来 */
const CROSSFADE_SEC = 2.5
/** 进入答题屏 / 牌场时的淡出。必须赶在题目音频起播之前完成 */
const FADE_OUT_SEC = 0.9
/** 切走标签页时的淡出。比上面短，因为没人在听 */
const FADE_HIDE_SEC = 0.35
/** BGM 渐入（开场语音结束后的那一次） */
const FADE_IN_SEC = 2.5

/**
 * 提前多久去准备下一段。
 *
 * 真正的交叉淡化已经排进了 AudioContext 时钟，即使这个 setTimeout 晚到几百毫秒
 * 也不影响已排好的那一次。它只负责「解码再下一段 + 排下一次调度」，
 * 3 秒足够一次网络往返加解码。
 */
const LOOKAHEAD_SEC = 3
/** 剩这么多段就去续取下一批，不等播空 */
const REFILL_AT = 2
/** 一次取几个曲目。服务端上限是 4 */
const FETCH_TRACKS = 3

/** 记住上一次问候是谁，避免连着两次刷新撞上同一个人 */
const LAST_GREET_KEY = 'scg.lastGreet'

interface Voice {
  src: AudioBufferSourceNode
  gain: GainNode
}

class Ambience {
  /** BGM 总线。承载 BGM_GAIN 与全局淡入淡出；每段自己的交叉淡化在各自的 gain 上 */
  private bus: GainNode | null = null
  /** 正在发声的段。交叉淡化期间会有两段并存 */
  private voices: Voice[] = []
  private timer = 0

  private playlist: Playlist | null = null
  private fetching: Promise<void> | null = null

  /** 三个正交条件，任何一个不成立就不出声 */
  private enabled = false
  private muted = false
  private bgmOn = true

  /** 这台设备解不了 Opus，已切到 AAC 兜底。与 audio.ts 各记各的，互不影响 */
  private preferFallback = false
  /** 已经挂过监听了，别重复挂 */
  private watching = false

  // ── 问候语音 ────────────────────────────────────────

  /** 上一次是谁。选人时排除掉它 */
  get lastGreeted(): string | undefined {
    try {
      return localStorage.getItem(LAST_GREET_KEY) ?? undefined
    } catch {
      // Safari 无痕模式下 localStorage 存在但会抛。记不住只是偶尔重复一次，不值得让开场挂掉
      return undefined
    }
  }

  rememberGreeted(id: string): void {
    try {
      localStorage.setItem(LAST_GREET_KEY, id)
    } catch {
      /* 同上，记不住就算了 */
    }
  }

  /**
   * 播一段问候，**等它自然播完才 resolve**。
   *
   * 失败一律 resolve 而不是 reject：开场绝不能因为一段问候放不出来就卡住。
   * 调用点必须在**真实用户手势**的调用栈里（它会先 unlock）。
   */
  async playGreeting(url: string, fallbackUrl: string): Promise<void> {
    try {
      if (!audio.bypass) await audio.unlock()
      const bypass = audio.bypass
      if (!bypass) return

      const { ctx, out } = bypass
      const buf = await this.fetchDecode(ctx, url, fallbackUrl)

      const gain = ctx.createGain()
      gain.gain.value = GREET_GAIN
      gain.connect(out)

      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(gain)

      const t0 = ctx.currentTime + 0.02
      src.start(t0)

      await new Promise<void>((resolve) => {
        // onended 而不是 setTimeout(时长)：后者在主线程卡顿时会早于实际播完触发，
        // 表现是 BGM 抢在问候的尾音上淡入
        src.onended = () => {
          gain.disconnect()
          resolve()
        }
      })
    } catch {
      // 网络断了、解码失败、AudioContext 起不来 —— 都只是没有这一声，不是错误
    }
  }

  // ── 开关 ────────────────────────────────────────────

  /**
   * 在不在铺 BGM 的那三屏。由 App 用既有的 ambient 布尔量驱动。
   *
   * **刻意不做 `已经是这个值就返回` 的短路**，这一条要幂等且可重试：
   * 页面刚加载时 App 就会调一次 `setEnabled(true)`，但那时 AudioContext 还没被
   * 手势解锁，`start()` 只能空手而归。Splash 在点击解锁之后再调一次同样的 true，
   * 靠的就是这里不短路。重复调用是安全的 —— `start()` 见 bus 已在就返回，
   * `stop()` 见 bus 为空也返回。
   */
  setEnabled(on: boolean): void {
    this.enabled = on
    this.sync(FADE_OUT_SEC)
  }

  /**
   * 跟随静音开关。
   *
   * 滑杆位置**不**影响 BGM 音量（那是需求），但静音必须让世界安静下来 ——
   * 点了静音还在响就是 bug。由 VolumeControl 与 main.tsx 两个已知调用点同步过来；
   * `audio.ts` 是禁区，不在那边加订阅机制。
   */
  setMuted(on: boolean): void {
    if (this.muted === on) return
    this.muted = on
    this.sync(FADE_HIDE_SEC)
  }

  /**
   * 首页那个开关当前的位置。
   *
   * 控件的初值从这里读，不从 localStorage 读 —— 与音量滑杆同一条规矩：
   * **引擎是运行时的唯一真相，存储只是它的副本**。main.tsx 在任何界面挂载之前
   * 就已经把偏好灌进来了。
   */
  get bgmEnabled(): boolean {
    return this.bgmOn
  }

  /** 首页那个独立开关。与静音正交：只想关掉 BGM 但仍要听题目的人需要它 */
  setBgmOn(on: boolean): void {
    if (this.bgmOn === on) return
    this.bgmOn = on
    this.sync(FADE_HIDE_SEC)
  }

  /** 三个条件的合取。任何一个不成立就不该有声音 */
  private get shouldPlay(): boolean {
    return this.enabled && !this.muted && this.bgmOn && document.visibilityState !== 'hidden'
  }

  /**
   * 让实际状态追上 `shouldPlay`。
   *
   * `fade` 只在停止时有意义 —— 起播永远走 FADE_IN_SEC，
   * 那是「音乐进场」这件事本身的时长，与什么原因触发的无关。
   */
  private sync(fade: number): void {
    if (this.shouldPlay) void this.start()
    else this.stop(fade)
  }

  // ── BGM ─────────────────────────────────────────────

  private async start(): Promise<void> {
    const bypass = audio.bypass
    // 还没解锁就先记下状态；解锁后 Splash 会再调一次 setEnabled 把它带起来
    if (!bypass) return
    if (this.bus) return // 已经在播

    const { ctx, out } = bypass
    this.bus = ctx.createGain()
    this.bus.gain.setValueAtTime(0.0001, ctx.currentTime)
    this.bus.gain.linearRampToValueAtTime(BGM_GAIN, ctx.currentTime + FADE_IN_SEC)
    this.bus.connect(out)

    this.watch()
    await this.schedule(ctx.currentTime + 0.05)
  }

  /**
   * 排一段的播放，并安排好下一次排程。
   *
   * 起播时刻走 AudioContext 时钟而不是 setTimeout：主线程抖动会在接缝处
   * 留下听得见的空隙，而 ctx 时钟是采样级的。
   */
  private async schedule(at: number): Promise<void> {
    if (!this.shouldPlay) return
    const bypass = audio.bypass
    const bus = this.bus
    if (!bypass || !bus) return
    const { ctx } = bypass

    await this.ensureClips()
    const token = this.playlist ? currentClip(this.playlist) : null
    if (!token) return

    let buf: AudioBuffer
    try {
      buf = await this.fetchDecode(
        ctx,
        `/api/ambience/clip/${token}`,
        `/api/ambience/clip/${token}.m4a`,
      )
    } catch {
      // 这一段拿不到就跳过它，别让整条 BGM 停在这里
      this.playlist = this.playlist ? advance(this.playlist) : null
      if (this.playlist) void this.schedule(Math.max(at, ctx.currentTime + 0.05))
      return
    }

    // 等解码的这段时间里可能已经切走了
    if (!this.shouldPlay || this.bus !== bus) return

    const dur = buf.duration
    const t0 = Math.max(at, ctx.currentTime + 0.02)

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.linearRampToValueAtTime(1, t0 + CROSSFADE_SEC)
    gain.gain.setValueAtTime(1, t0 + dur - CROSSFADE_SEC)
    gain.gain.linearRampToValueAtTime(0.0001, t0 + dur)
    gain.connect(bus)

    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(gain)
    src.start(t0)
    src.stop(t0 + dur + 0.02)

    const voice: Voice = { src, gain }
    this.voices.push(voice)
    src.onended = () => {
      gain.disconnect()
      this.voices = this.voices.filter((v) => v !== voice)
    }

    this.playlist = this.playlist ? advance(this.playlist) : null

    // 下一段提前 CROSSFADE_SEC 起播，两段的 ramp 正好交叠
    const nextAt = t0 + dur - CROSSFADE_SEC
    const waitMs = Math.max(0, (nextAt - LOOKAHEAD_SEC - ctx.currentTime) * 1000)
    window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => void this.schedule(nextAt), waitMs)
  }

  /** 曲目快播完了就去续一批。不循环旧的那批 —— 在首页多待几分钟就会听出来「又是这几首」 */
  private async ensureClips(): Promise<void> {
    if (this.playlist && remaining(this.playlist) > REFILL_AT) return
    if (this.fetching) return this.fetching

    this.fetching = (async () => {
      try {
        const res = await fetch(`/api/ambience/tracks?n=${FETCH_TRACKS}`)
        if (!res.ok) return
        const body = (await res.json()) as { tracks: AmbienceTrack[] }
        const fresh = body.tracks.filter((t) => t.clips.length > 0)
        if (fresh.length === 0) return

        this.playlist =
          this.playlist && currentClip(this.playlist)
            ? { ...this.playlist, tracks: [...this.playlist.tracks, ...fresh] }
            : createPlaylist(fresh)
      } catch {
        // 断网时静静地停在最后一段上；网络回来后下一次 schedule 会再试
      } finally {
        this.fetching = null
      }
    })()

    return this.fetching
  }

  private stop(fade: number): void {
    window.clearTimeout(this.timer)
    this.timer = 0

    const bus = this.bus
    const bypass = audio.bypass
    if (!bus || !bypass) {
      this.bus = null
      return
    }

    const { ctx } = bypass
    const t = ctx.currentTime
    // cancelScheduledValues + 从当前值起 ramp：不这么做的话，
    // 正在进行的 FADE_IN ramp 会继续把音量往上拉，淡出变成先变响再消失
    bus.gain.cancelScheduledValues(t)
    bus.gain.setValueAtTime(bus.gain.value, t)
    bus.gain.linearRampToValueAtTime(0.0001, t + fade)

    const dying = this.voices
    this.voices = []
    this.bus = null

    window.setTimeout(
      () => {
        for (const v of dying) {
          try {
            v.src.stop()
          } catch {
            /* 已经停了 */
          }
          v.gain.disconnect()
        }
        bus.disconnect()
      },
      (fade + 0.1) * 1000,
    )
  }

  /**
   * 切走标签页就停，回来再续。
   *
   * 不做「挂起再按 ctx 时钟对齐恢复」：后台标签的 setTimeout 会被节流到秒级，
   * 长时间后台之后已排好的调度早就播完了，回来只会听到一段抢拍的音频。
   * 停掉再重新起播更简单，也更符合「我切走了就别响」的直觉。
   */
  private watch(): void {
    if (this.watching) return
    this.watching = true
    document.addEventListener('visibilitychange', () => this.sync(FADE_HIDE_SEC))
  }

  // ── 取音频 ──────────────────────────────────────────

  /**
   * 下载并解码。
   *
   * AAC 兜底的判断与 `audio.ts` 同一套理由：**不能靠 `canPlayType` 提前判断**，
   * iOS 上它会说谎，只能真解一次看它成不成；成功切到兜底后记住，不再每次白试一遍 Opus。
   */
  private async fetchDecode(ctx: AudioContext, url: string, fallbackUrl: string): Promise<AudioBuffer> {
    const urls = this.preferFallback ? [fallbackUrl] : [url, fallbackUrl]
    let lastErr: unknown
    for (const [i, u] of urls.entries()) {
      try {
        const res = await fetch(u)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const bytes = await res.arrayBuffer()
        // decodeAudioData 会 detach 传入的 ArrayBuffer，先留一份副本
        const buf = await ctx.decodeAudioData(bytes.slice(0))
        if (i > 0) this.preferFallback = true
        return buf
      } catch (err) {
        lastErr = err
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
  }
}

export const ambience = new Ambience()
