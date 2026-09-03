/**
 * 音色定义表 —— **这是设计决定的数据，不是机制**。
 *
 * 每一个数字都是耳朵定的，会被反复调；渲染器（`sfx.ts`）是机制，一次写对就不再动。
 * 拆成两个文件正是为了这条分工：调音时改的永远只是这张表，
 * 不会去动一个跑着 AudioNode 生命周期管理的文件。
 *
 * 这里没有任何 AudioNode、没有 AudioContext，纯数据 ——
 * 所以 `vitest` 在 jsdom 里跑不了 Web Audio，却跑得了这张表的约束（见 sfxVoices.test.ts）。
 *
 * 放 `src/` 顶层而不是 `src/features/`：那个目录整目录是禁区（编码了生产环境修复），
 * 往里新增文件会让「这个目录不要动」这条规矩出现例外。
 */

/**
 * 一段音由若干 part 叠加而成；每个 part 是一条独立的信号链。
 * `at` / `dur` 的单位都是秒，相对这一声的起点。
 */
export type Part =
  | {
      kind: 'tone'
      wave: OscillatorType
      /** 单值 = 定频；[from, to] = 在 dur 内滑到目标频率 */
      freq: number | [number, number]
      at: number
      dur: number
      /** 峰值增益（配平后的绝对值，调用点不再乘系数） */
      gain: number
      /** 起音时间，秒。默认 0.004 —— 一律给一点，硬切会爆音 */
      attack?: number
      /** 低通截止，给方波/锯齿去毛刺 */
      lowpass?: number
    }
  | {
      kind: 'noise'
      at: number
      dur: number
      gain: number
      /** 带通中心频率；[from,to] 则在 dur 内扫频 */
      band?: number | [number, number]
      q?: number
      /** 高通，用于做「拍击」瞬态 */
      highpass?: number
    }

export interface Voice {
  parts: Part[]
  /** 音高随机化幅度（比例）。0.02 = ±2%。默认 0 */
  jitter?: number
}

export type SfxName =
  // 既有（调用点已存在，名字不能改）
  | 'click'
  | 'correct'
  | 'wrong'
  | 'tick'
  | 'go'
  | 'fanfare'
  // 联机新增
  | 'take'
  | 'otetsuki'
  | 'foeTake'
  | 'okuri'
  | 'matchStart'
  | 'win'
  | 'lose'
  | 'draw'
  | 'peerOn'
  | 'peerOff'

/** 同一声内所有 part 的峰值之和上限。母带思路：响度在定义处一次配平 */
export const PEAK_BUDGET = 0.7

const tone = (
  wave: OscillatorType,
  freq: number | [number, number],
  at: number,
  dur: number,
  gain: number,
  extra?: { attack?: number; lowpass?: number },
): Part => ({ kind: 'tone', wave, freq, at, dur, gain, ...extra })

const noise = (
  at: number,
  dur: number,
  gain: number,
  extra?: { band?: number | [number, number]; q?: number; highpass?: number },
): Part => ({ kind: 'noise', at, dur, gain, ...extra })

/**
 * 音高统一在 D 大调族上（D=587 / F#=740 / A=880 / D'=1175）：
 * 不同事件的音效互相之间是协和的，连着响不会打架。
 */
export const VOICES: Record<SfxName, Voice> = {
  /** 极短一「嗒」。按钮到处都是，必须轻 */
  click: { parts: [tone('triangle', 2000, 0, 0.035, 0.1, { lowpass: 4000 })] },

  /** 倒计时秒针，比 click 更干 */
  tick: { parts: [tone('square', 1200, 0, 0.03, 0.09, { lowpass: 3000 })] },

  /** 上滑起跑 */
  go: { parts: [tone('sine', [660, 990], 0, 0.18, 0.22)] },

  /** 抢到牌：拍击瞬态 + 两段上行。连着好几回合都会响，所以带 jitter */
  take: {
    parts: [
      noise(0, 0.012, 0.16, { highpass: 3000 }),
      tone('sine', 880, 0.005, 0.12, 0.26),
      tone('sine', 1320, 0.045, 0.16, 0.16),
    ],
    jitter: 0.02,
  },

  /** 单人揭晓，比 take 多一段、更「完成」 */
  correct: {
    parts: [
      tone('sine', 880, 0, 0.14, 0.24),
      tone('sine', 1320, 0.05, 0.16, 0.18),
      tone('sine', 1760, 0.1, 0.22, 0.12),
    ],
  },

  /** お手つき：钝、闷、往下掉 */
  otetsuki: {
    parts: [
      noise(0, 0.02, 0.18, { band: [1200, 300], q: 1.2 }),
      tone('sawtooth', [220, 150], 0.01, 0.24, 0.2, { lowpass: 900 }),
      tone('sine', [110, 80], 0.01, 0.28, 0.14),
    ],
    jitter: 0.015,
  },

  /** 单人版的错，比 otetsuki 轻一点 */
  wrong: {
    parts: [
      tone('sawtooth', [240, 170], 0, 0.22, 0.2, { lowpass: 1100 }),
      noise(0, 0.01, 0.12, { highpass: 1500 }),
    ],
  },

  /** 极轻，只说「被抢了」，不抢注意力 */
  foeTake: { parts: [tone('sine', 740, 0, 0.09, 0.08)] },

  /** 一声「嗖」，牌在移动 */
  okuri: { parts: [noise(0, 0.14, 0.1, { band: [700, 2400], q: 2.0 })] },

  /** 开场，克制的两音上行 */
  matchStart: {
    parts: [
      noise(0, 0.02, 0.1, { highpass: 2000 }),
      tone('sine', 587, 0.01, 0.18, 0.18),
      tone('sine', 880, 0.1, 0.3, 0.16),
    ],
  },

  /** 大三度上行琶音 */
  win: {
    parts: [
      tone('sine', 740, 0, 0.16, 0.22),
      tone('sine', 880, 0.09, 0.16, 0.2),
      tone('sine', 1175, 0.18, 0.45, 0.18),
      // design.md 的表里这一 part 没写 lowpass，但同一份文档的风险表要求
      // 「所有非正弦 part 强制配 lowpass」。取 8000（基频的 5 倍以上）：
      // 三角波的高次谐波本来就衰减得快，这条只是去毛刺，不改音色
      tone('triangle', 1480, 0.18, 0.45, 0.07, { lowpass: 8000 }),
    ],
  },

  /** 小三度下行，收得干净 */
  lose: {
    parts: [
      tone('sine', 740, 0, 0.18, 0.18),
      tone('sine', 587, 0.12, 0.4, 0.18),
      tone('sawtooth', 293, 0.12, 0.4, 0.06, { lowpass: 700 }),
    ],
  },

  /** 平行两音，不上不下 */
  draw: { parts: [tone('sine', 740, 0, 0.3, 0.18), tone('sine', 880, 0, 0.3, 0.12)] },

  /** 单人结算，保留现有语气 */
  fanfare: {
    parts: [
      // lowpass 同 win：表里未给，按风险表的强制要求补，取值高到不改音色
      tone('triangle', 784, 0, 0.12, 0.2, { lowpass: 8000 }),
      tone('triangle', 988, 0.09, 0.12, 0.18, { lowpass: 8000 }),
      tone('triangle', 1175, 0.18, 0.5, 0.18, { lowpass: 8000 }),
      tone('sine', 2350, 0.18, 0.5, 0.05),
    ],
  },

  /** 上行双音 = 回来了 */
  peerOn: { parts: [tone('sine', 660, 0, 0.08, 0.12), tone('sine', 880, 0.09, 0.1, 0.12)] },

  /** 下行双音 = 走了 */
  peerOff: { parts: [tone('sine', 880, 0, 0.08, 0.12), tone('sine', 660, 0.09, 0.14, 0.12)] },
}
