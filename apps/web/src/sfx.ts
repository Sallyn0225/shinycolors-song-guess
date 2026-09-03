/**
 * UI 音效层：十六个短脉冲，**全部由 Web Audio 在运行时合成**，不下载任何素材。
 *
 * 为什么不再用素材：原来是按逻辑名 fetch 一个 m4a 再 `decodeAudioData`，
 * 于是每个音效的第一声都要等一次网络往返加解码。联机牌场里最需要即时反馈的
 * 恰恰是抢牌那一下，而它必然是这局里的第一次 —— 第一次就晚一拍是最糟的时机。
 * 合成没有下载解码阶段，第一声与第一百声等价；顺带音色变成了可以随时调的代码
 * （见 `sfxVoices.ts`），而不是一个要重新导出的文件。
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
import { VOICES, type Part, type SfxName } from './sfxVoices'

/** 受控的音效名。不暴露任意参数：音色集是定死的，别让它从调用点漂移 */
export type { SfxName }

/**
 * 音效总线的固定增益。
 *
 * 每类音效的响度在定义表里统一配平（见 sfxVoices.ts 的 PEAK_BUDGET），
 * 运行时不再逐个调——「哪个音效比哪个响」是设计决定，散进调用点就再也对不齐了。
 * 0.5 把整条总线压到「听得见但不抢」，与 BGM 的 0.12 同理但高得多：
 * 反馈音必须盖过氛围，又不该盖过正在播的题目。
 */
const SFX_GAIN = 0.5

/** 默认起音时间。一律给一点：包络硬切会爆音 */
const DEFAULT_ATTACK = 0.004
/**
 * 指数斜坡的收尾目标值。
 * **不能是 0** —— 这是 Web Audio 的经典坑：传 0 会让整条曲线失效，
 * 部分实现直接抛 RangeError。收到这个足够小的值再 stop。
 */
const SILENCE = 0.0001
/** 节点停掉前多留一点余量，免得斜坡还没走完就被切断 */
const TAIL = 0.02
/** 共享白噪的长度。够长到每次随机取起点都听不出是同一段 */
const NOISE_SEC = 1

class Sfx {
  /** 固定增益总线。首次出声时建，常驻不拆——音效随时都可能来 */
  private bus: GainNode | null = null
  /** 共享的一秒白噪。每次播放随机取起点，不必为每一声重新生成 */
  private noise: AudioBuffer | null = null

  private muted = false
  /** 独立的音效开关，与静音正交 */
  private on = true

  /**
   * 播一声。fire-and-forget，调用方不需要也不应该 await。
   *
   * `delayMs` 用来把同一拍里的第二声错开（判定音先出、牌面移动音后出）。
   * 它走 `ctx.currentTime` 而不是 `setTimeout`：音频时钟与主线程时钟是两回事，
   * 180ms 的错峰交给 setTimeout，一次 GC 就能把它拉成 300ms。
   *
   * 短音效连播（双击、快速过选项）必须能叠加：每次调用都建全新的节点，绝不复用——
   * OscillatorNode 与 AudioBufferSourceNode 都是一次性的，stop 过再 start 会抛。
   * `onended` 里 disconnect，节点不攒。
   */
  play(name: SfxName, delayMs = 0): void {
    // 出声前检查就够：音效是一次性的短脉冲，不像 BGM 那样需要 ramp 收尾
    if (!this.on || this.muted) return
    const bypass = audio.bypass
    /*
      AudioContext 没在跑就静默放弃。判 `unlocked`（ctx 存在**且** state 是 running）
      而不是只判 bypass 非空 —— 后者只说明 ctx 被建出来过。

      这个区别在音效只由手势触发的年代无所谓：手势发生时 ctx 必然在跑。
      但现在音效挂到了网络事件上（matchStart / peer / roundResult），
      而挂起的 ctx 其 currentTime 是冻结的：切后台或被来电打断的那段时间里，
      对手每抢一张牌都往同一个时刻排一声，等 ctx 恢复时它们会一起炸出来。
      迟到的音效比没有更糟，一串迟到的音效更糟。
    */
    if (!bypass || !audio.unlocked) return

    try {
      const { ctx, out } = bypass
      if (!this.bus) {
        this.bus = ctx.createGain()
        this.bus.gain.value = SFX_GAIN
        this.bus.connect(out)
      }
      const voice = VOICES[name]
      const t0 = ctx.currentTime + Math.max(0, delayMs) / 1000
      // 音高随机化整声统一乘同一个系数，不是逐 part 各随各的——
      // 逐 part 随机会把琶音的音程也一起改掉，听感是走音而不是变化
      const k = voice.jitter ? 1 + (Math.random() * 2 - 1) * voice.jitter : 1
      for (const part of voice.parts) this.renderPart(ctx, this.bus, part, t0, k)
    } catch {
      // ctx 半路被 suspend、节点数到顶——都只是没有这一声，不是错误
    }
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

  /** 一段 part 的信号链：源 →（滤波）→ 包络 → 总线。每次都是全新的节点 */
  private renderPart(ctx: AudioContext, bus: GainNode, part: Part, base: number, k: number): void {
    const t0 = base + part.at
    const end = t0 + part.dur

    const env = ctx.createGain()
    const rise = part.kind === 'tone' ? (part.attack ?? DEFAULT_ATTACK) : DEFAULT_ATTACK
    // 起音不许长过半段：click 整声才 35ms，起音一超就成了「淡入的一声」
    const attack = Math.min(rise, part.dur / 2)
    env.gain.setValueAtTime(SILENCE, t0)
    env.gain.linearRampToValueAtTime(part.gain, t0 + attack)
    env.gain.exponentialRampToValueAtTime(SILENCE, end)
    env.connect(bus)

    // 链上的每一个节点都记下来，`onended` 里一次性拆掉：
    // 每一声都是一整套新节点，漏拆一个就是一场长局下来攒了几百个悬挂节点
    const chain: AudioNode[] = [env]
    /** 当前链头 —— 源要接的就是它 */
    const head = (): AudioNode => chain[chain.length - 1] as AudioNode
    /** 把一个滤波器插到链头之前，它成为新的链头 */
    const prepend = (f: BiquadFilterNode): void => {
      f.connect(head())
      chain.push(f)
    }

    if (part.kind === 'tone') {
      const osc = ctx.createOscillator()
      osc.type = part.wave
      if (Array.isArray(part.freq)) {
        const [from, to] = part.freq
        osc.frequency.setValueAtTime(from * k, t0)
        // 指数滑音：频率恒正，按比例走才是听感上的「滑」
        osc.frequency.exponentialRampToValueAtTime(to * k, end)
      } else {
        osc.frequency.setValueAtTime(part.freq * k, t0)
      }
      if (part.lowpass !== undefined) {
        const f = ctx.createBiquadFilter()
        f.type = 'lowpass'
        f.frequency.setValueAtTime(part.lowpass, t0)
        prepend(f)
      }
      osc.connect(head())
      osc.start(t0)
      osc.stop(end + TAIL)
      osc.onended = () => {
        osc.disconnect()
        for (const n of chain) n.disconnect()
      }
      return
    }

    if (part.band !== undefined) {
      const f = ctx.createBiquadFilter()
      f.type = 'bandpass'
      f.Q.setValueAtTime(part.q ?? 1, t0)
      if (Array.isArray(part.band)) {
        const [from, to] = part.band
        f.frequency.setValueAtTime(from, t0)
        f.frequency.exponentialRampToValueAtTime(to, end)
      } else {
        f.frequency.setValueAtTime(part.band, t0)
      }
      prepend(f)
    }
    if (part.highpass !== undefined) {
      const f = ctx.createBiquadFilter()
      f.type = 'highpass'
      f.frequency.setValueAtTime(part.highpass, t0)
      prepend(f)
    }

    const src = ctx.createBufferSource()
    const buf = this.ensureNoise(ctx)
    src.buffer = buf
    src.connect(head())
    // 每次取不同的起点，连响时不会听出是同一段噪声
    src.start(t0, Math.random() * Math.max(0, buf.duration - part.dur - TAIL), part.dur + TAIL)
    src.stop(end + TAIL)
    src.onended = () => {
      src.disconnect()
      for (const n of chain) n.disconnect()
    }
  }

  /** 懒建一次的共享白噪。所有噪声 part 复用同一份 buffer，只是各取各的起点 */
  private ensureNoise(ctx: AudioContext): AudioBuffer {
    if (this.noise && this.noise.sampleRate === ctx.sampleRate) return this.noise
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * NOISE_SEC), ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    this.noise = buf
    return buf
  }
}

export const sfx = new Sfx()
