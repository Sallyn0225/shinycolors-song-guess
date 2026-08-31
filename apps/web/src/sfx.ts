/**
 * UI 音效层：click / correct / wrong / tick / go / fanfare 六个短脉冲。
 *
 * 与 `ambience.ts` 同一条路：**共用 AudioContext、不共用信号链**。
 * 从 `audio.bypass` 取 ctx 与 destination，自建一条固定增益的总线——
 * 不进 `master`（音量滑杆的语义是「题目音频的响度」，音效是反馈不是内容），
 * 也不进 `analyser`（那条频谱的意义是「当前这道题长这样」）。
 *
 * 单例，绝不进 React state —— 音频节点进 state 会因 re-render 重建、爆音、泄漏。
 *
 * 播放是 fire-and-forget：任何一步失败都只是少一声，绝不能抛错阻断交互——
 * click 声卡在 onClick 里把按钮点死，比没有音效糟糕一万倍。
 */

import { audio } from './audio'

/** 受控的音效名。不暴露任意 URL：资源集是定死的，别让它从调用点漂移 */
export type SfxName = 'click' | 'correct' | 'wrong' | 'tick' | 'go' | 'fanfare'

/**
 * 音效总线的固定增益。
 *
 * 每类音效的响度在母带时统一（裁静音、-3dB 峰值），运行时不再逐个调——
 * 「哪个音效比哪个响」是设计决定，散进调用点就再也对不齐了。
 * 0.5 把母带压到「听得见但不抢」，与 BGM 的 0.12 同理但高得多：
 * 反馈音必须盖过氛围，又不该盖过正在播的题目。
 */
const SFX_GAIN = 0.5

class Sfx {
  /** 固定增益总线。首次出声时建，常驻不拆——音效随时都可能来 */
  private bus: GainNode | null = null
  /** 解码缓存。音效文件极短、总共六个，常驻比来回淘汰省心 */
  private buffers = new Map<SfxName, AudioBuffer>()
  /** 在途的下载解码。连点同一处时别为同一份文件发两次请求 */
  private pending = new Map<SfxName, Promise<AudioBuffer>>()

  private muted = false
  /** 独立的音效开关，与静音正交 */
  private on = true

  /**
   * 播一声。fire-and-forget，调用方不需要也不应该 await。
   *
   * 短音效连播（双击、快速过选项）必须能叠加：每次调用建一个一次性的
   * bufferSource，绝不复用——source 是一次性的，stop 过的 source 再 start 会抛。
   * `onended` 里 disconnect，节点不攒。
   */
  play(name: SfxName): void {
    // 出声前检查就够：音效是一次性的短脉冲，不像 BGM 那样需要 ramp 收尾
    if (!this.on || this.muted) return
    const bypass = audio.bypass
    // AudioContext 还没被手势解锁。倒计时 tick 这类场景首屏手势后必然已解锁，
    // 没解锁时连页面都还没进来，静默放弃即可
    if (!bypass) return

    void (async () => {
      try {
        const { ctx, out } = bypass
        if (!this.bus) {
          this.bus = ctx.createGain()
          this.bus.gain.value = SFX_GAIN
          this.bus.connect(out)
        }
        const buf = await this.ensureBuffer(ctx, name)
        const src = ctx.createBufferSource()
        src.buffer = buf
        src.connect(this.bus)
        src.onended = () => src.disconnect()
        src.start()
      } catch {
        // 404、解码失败、ctx 半路被 suspend——都只是没有这一声，不是错误
      }
    })()
  }

  /**
   * 跟随静音开关。与 BGM 同一条规矩：滑杆位置不管音效，但静音必须让整个世界
   * 安静下来。由 VolumeControl 与 main.tsx 两个已知调用点显式同步；
   * `audio.ts` 是禁区，不在那边加订阅机制。
   */
  setMuted(on: boolean): void {
    this.muted = on
  }

  /**
   * 首页那个独立开关的位置。与静音正交：只想关掉 UI 音效但仍要听题目的人需要它。
   */
  setSfxOn(on: boolean): void {
    this.on = on
  }

  /**
   * 开关当前的位置。控件初值从这里读，不从 localStorage 读——
   * 引擎是运行时的唯一真相，存储只是它的副本（main.tsx 已在挂载前灌好）
   */
  get sfxOn(): boolean {
    return this.on
  }

  /** 懒解码 + 在途去重 */
  private async ensureBuffer(ctx: AudioContext, name: SfxName): Promise<AudioBuffer> {
    const hit = this.buffers.get(name)
    if (hit) return hit

    let inflight = this.pending.get(name)
    if (!inflight) {
      inflight = (async () => {
        // AAC 而不是 WAV：同样的六段音效 298KB → 47KB。
        //
        // **单一格式，没有 opus 兜底**，和曲库切片那套双格式刻意不同。
        // 那边用 opus 是因为音乐足够长、码率优势能兑现；这里六段加起来两秒半，
        // opus 只比 AAC 再省 8KB，不值得让文件数翻倍、再引入一套
        // 「先试 opus 解不了再换」的分支。AAC 本来就是这个项目里最兼容的那个格式
        // （greet 与切片的兜底都是它），所有能跑 decodeAudioData 的浏览器都认。
        const res = await fetch(`/sfx/${name}.m4a`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        // decodeAudioData 会 detach 传入的 ArrayBuffer，副本留给失败重试
        const bytes = await res.arrayBuffer()
        return ctx.decodeAudioData(bytes.slice(0))
      })()
      this.pending.set(name, inflight)
    }
    try {
      const buf = await inflight
      this.buffers.set(name, buf)
      return buf
    } finally {
      this.pending.delete(name)
    }
  }
}

export const sfx = new Sfx()
