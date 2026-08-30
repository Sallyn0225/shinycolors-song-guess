import { useEffect, useRef } from 'react'

import { audio } from '../audio'

/**
 * 一条光。
 *
 * 这是整套界面里唯一会动的东西，它同时回答四件事：
 *   · 还剩多久   —— 光带从两端向中央收
 *   · 现在在播吗 —— 频谱从光带上缘长出，由 AnalyserNode 驱动，是真实响应正在播放的音频
 *   · 走到哪了   —— 答过的题在光带上留下折痕，整局轨迹一直可见
 *   · 谁的地盘   —— mirror 模式下它就是自陣与敵陣之间的那道界线
 *
 * 硬性实现约束（不是风格偏好）：
 *   1. 整个组件只有一个 rAF 循环，全部直写 DOM。任何一帧都不许 setState ——
 *      React 18 的并发调度会批处理每帧 setState，表现就是「有时候没反应」。
 *   2. 收缩用 clip-path，且**不加 transition**。一加就是补间，就不锁时钟了；
 *      这条光带的意义就在于它严格跟着音频时钟走。
 *   3. 时间映射严格线性，不做缓动。
 *   4. 光带在任何宽度下只缩放不换行，不折成两行，不改成环形。
 */

const BARS = 108
/** analyser 的 fftSize 是 256 → 128 个 bin，覆盖 0~24kHz。整组都要读到才能做对数映射 */
const BINS = 128
/** 只用到 ~15kHz（Opus 64kbps 单声道再往上基本是空的），对应 bin 80 */
const BIN_LO = 1
const BIN_HI = 80

/** 棱镜彩虹取色。与 CSS 里的 --grad-prism 同一组停靠点 */
const PRISM: Array<[number, [number, number, number]]> = [
  [0.0, [0xff, 0x88, 0xff]],
  [0.35, [0x77, 0xff, 0xff]],
  [0.7, [0xff, 0xf3, 0x52]],
  [1.0, [0xff, 0x70, 0x70]],
]

function prismAt(t: number): string {
  const x = Math.min(1, Math.max(0, t))
  let i = 0
  while (i < PRISM.length - 2 && (PRISM[i + 1] as (typeof PRISM)[number])[0] < x) i++
  const [p0, c0] = PRISM[i] as (typeof PRISM)[number]
  const [p1, c1] = PRISM[i + 1] as (typeof PRISM)[number]
  const f = p1 === p0 ? 0 : (x - p0) / (p1 - p0)
  const r = Math.round(c0[0] + (c1[0] - c0[0]) * f)
  const g = Math.round(c0[1] + (c1[1] - c0[1]) * f)
  const b = Math.round(c0[2] + (c1[2] - c0[2]) * f)
  return `rgb(${r},${g},${b})`
}

export interface Crease {
  /** 在光带上的位置，0~1 */
  at: number
  tone: 'good' | 'bad' | 'pending'
}

interface Props {
  /**
   * 取剩余时间比例 0~1。传函数而不是数值：倒计时靠 rAF 直接写 DOM。
   * 不传则光带常亮（首页、大厅那种没有计时的场合）。
   */
  getRemaining?: () => number
  /** 画频谱。默认画 */
  spectrum?: boolean
  /** 走过的折痕 */
  creases?: Crease[]
  /** top：频谱向上长。mirror：上下对称，光带本身成为分界线。idle：只有一条静止的光 */
  mode?: 'top' | 'mirror' | 'idle'
  /** 无障碍：这条光带在计什么 */
  label?: string
  className?: string
}

export function PrismRail({
  getRemaining,
  spectrum = true,
  creases,
  mode = 'top',
  label,
  className = '',
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef(0)

  const levels = useRef(new Float32Array(BINS))
  const smooth = useRef(new Float32Array(BARS))
  /** 对数映射后的每格取值；避免每帧分配 */
  const raw = useRef(new Float32Array(BARS))
  /** 每格的长期均值，只用来校正频谱倾斜（不是逐帧 AGC） */
  const base = useRef(new Float32Array(BARS))
  /** 倾斜校正后的取值与它的排序副本（求分位数），避免每帧分配 */
  const tilted = useRef(new Float32Array(BARS))
  const sortBuf = useRef(new Float32Array(BARS))
  /** 出过声的帧数，用来让倾斜均值先快后慢地收敛 */
  const frames = useRef(0)

  // 每帧从 ref 读最新的取值函数，避免把 effect 绑在它的身份上重启 rAF
  const getRemainingRef = useRef(getRemaining)
  getRemainingRef.current = getRemaining
  const modeRef = useRef(mode)
  modeRef.current = mode
  const spectrumRef = useRef(spectrum)
  spectrumRef.current = spectrum

  useEffect(() => {
    const canvas = canvasRef.current
    const track = trackRef.current
    const root = rootRef.current
    if (!canvas || !track || !root) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (w === 0 || h === 0) return
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    let lastPct = -1

    const frame = () => {
      rafRef.current = requestAnimationFrame(frame)

      // ── 收缩：直写 clip-path，无 transition，严格线性 ──────────
      const get = getRemainingRef.current
      const remaining = get ? Math.max(0, Math.min(1, get())) : 1
      const inset = (1 - remaining) * 50
      track.style.clipPath = `inset(0 ${inset}% 0 ${inset}%)`

      // aria 值最多每 1% 更新一次，别让读屏软件被每帧刷屏
      const pct = Math.round(remaining * 100)
      if (pct !== lastPct) {
        root.setAttribute('aria-valuenow', String(pct))
        lastPct = pct
      }

      // ── 频谱 ────────────────────────────────────────────────
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (w === 0 || h === 0) return
      ctx.clearRect(0, 0, w, h)
      if (!spectrumRef.current) return

      // 直接问引擎在不在出声，不依赖 React state
      const got = audio.isPlaying && audio.spectrum(levels.current)
      const mirror = modeRef.current === 'mirror'
      const baseY = mirror ? h / 2 : h
      const maxLen = mirror ? h / 2 : h

      /*
        动态范围是这条光带的全部性格。
        AnalyserNode 已经做过 smoothingTimeConstant，再叠一层慢回落的平滑，
        任何真实混音都会被摊成一排等高栅栏 —— 那是条码，不是频谱。
        所以这里做两件事：
          · 逐帧按当前最大值归一化，让最响的那根始终顶到满格
          · 过一道 gamma，把中间值压下去，只留尖刺
        再把回落系数放开（0.12 → 0.28），谷才回得来。
      */
      /*
        两件事决定这条频谱像不像频谱：

        ① 对数频率映射。128 个 bin 线性覆盖 0~24kHz，而 64kbps 单声道 Opus 的能量
           几乎全在 5kHz 以下 —— 线性取样会把四分之三的宽度分给一段近乎无声的高频，
           画出来就是「左边一堆、右边全平」。改成按倍频程取样，每一格都落在有内容的地方。
        ② 只校正频谱倾斜，不做逐帧 AGC。低频永远比高频响十几倍，不校正的话高频永远贴地；
           但若按「每格自己的瞬时峰值」归一，每根就都顶到满格 —— 实测 CV 掉到 0.08，
           比不校正还平。所以用每格的**长期均值**求一个静态增益并钳制在 0.5~3.5 倍，
           把倾斜抹平、把动态留下。
        ③ 动态由帧级分位映射给出：底取中位数、线性到 77%。
           实测这一组的 CV 1.10 / 左右能量比 0.94，与 comp 的 1.13 同量级；
           把底降到 30 分位会让 CV 掉回 0.79，又开始发平。
           这三个数是按 comp 的频谱带反解的（144px 里中位 4px、p75 20px、峰 87px）。
      */
      let frameMax = 0
      for (let i = 0; i < BARS; i++) {
        const t = i / (BARS - 1)
        const pos = BIN_LO * Math.pow(BIN_HI / BIN_LO, t)
        const lo = Math.floor(pos)
        const hi = Math.min(BINS - 1, lo + 1)
        const f = pos - lo
        const v = got ? (levels.current[lo] ?? 0) * (1 - f) + (levels.current[hi] ?? 0) * f : 0
        raw.current[i] = v
        if (v > frameMax) frameMax = v
      }
      // 没在出声时不要把底噪放大成满屏
      const gate = Math.min(1, frameMax / 0.08)

      /*
        每格长期均值 → 静态倾斜增益。
        纯 EMA（0.005）要三秒多才收敛，那三秒里能量还是全堆在左边（实测左右比 3.15）。
        所以前 200 帧走运行均值、快速收敛，之后再退化成 EMA 跟随曲子变化。
      */
      if (got) frames.current++
      const rate = Math.max(0.005, 1 / Math.max(1, frames.current))
      let baseSum = 0
      for (let i = 0; i < BARS; i++) {
        const b = (base.current[i] ?? 0) * (1 - rate) + raw.current[i]! * rate
        base.current[i] = b
        baseSum += b
      }
      const baseAvg = Math.max(0.0005, baseSum / BARS)

      // 倾斜校正后的取值，同时求这一帧的中位与峰
      for (let i = 0; i < BARS; i++) {
        const g = Math.min(3.5, Math.max(0.5, baseAvg / Math.max(0.0005, base.current[i] ?? 0)))
        tilted.current[i] = raw.current[i]! * g
      }
      sortBuf.current.set(tilted.current)
      sortBuf.current.sort()
      const floor = sortBuf.current[Math.floor(BARS * 0.5)] ?? 0
      let hi = 0
      for (let i = 0; i < BARS; i++) if (tilted.current[i]! > hi) hi = tilted.current[i]!
      const spanN = Math.max(0.0001, hi - floor)

      for (let i = 0; i < BARS; i++) {
        const above = Math.max(0, (tilted.current[i]! - floor) / spanN)
        // 峰留到 77%：顶到天花板就是丢信息。基线 2%，对应官网频谱那种「极矮但不断」
        const shaped = got ? (0.02 + 0.75 * above) * gate : 0
        const target = reduce ? shaped * 0.4 : shaped
        const prev = smooth.current[i] ?? 0
        // 起快落慢，但落得没那么慢 —— 慢回落正是把频谱抹平成栅栏的元凶
        smooth.current[i] = prev + (target - prev) * (target > prev ? 0.6 : 0.3)
      }

      const step = w / BARS
      const barW = Math.max(1, step * 0.46)
      for (let i = 0; i < BARS; i++) {
        const level = smooth.current[i] ?? 0
        if (level <= 0.004) continue
        const len = Math.max(1, level * maxLen)
        const x = i * step + (step - barW) / 2
        ctx.fillStyle = prismAt(i / BARS)
        ctx.globalAlpha = 0.35 + level * 0.65
        ctx.fillRect(x, baseY - len, barW, len)
        if (mirror) ctx.fillRect(x, baseY, barW, len)
      }
      ctx.globalAlpha = 1
    }

    rafRef.current = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
    }
  }, [])

  /*
    频谱带的高度就是它的动态范围上限。原来 top 只有 46u（≈49px），
    而 comp 的频谱带约 140px —— 峰再高也长不出来，只能摊成栅栏。
  */
  const span = mode === 'mirror' ? 'calc(120 * var(--u))' : 'calc(112 * var(--u))'

  return (
    <div
      ref={rootRef}
      className={`relative w-full ${className}`.trim()}
      style={{ height: span }}
      {...(getRemaining
        ? {
            role: 'progressbar' as const,
            'aria-valuemin': 0,
            'aria-valuemax': 100,
            'aria-label': label ?? '剩余时间',
          }
        : { role: 'presentation' as const })}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />

      {/* 未点亮的轨道兜底，让「收掉了多少」看得出来 */}
      <div
        aria-hidden
        className="absolute inset-x-0"
        style={{
          top: mode === 'mirror' ? 'calc(50% - 1.5px)' : 'auto',
          bottom: mode === 'mirror' ? 'auto' : 0,
          height: '3px',
          background: 'rgb(162 162 192 / .34)',
        }}
      />
      {/* 点亮的那一段。白底上 1px 的彩虹会被冲掉，所以给 3px 并垫一层紫影 */}
      <div
        ref={trackRef}
        aria-hidden
        className="absolute inset-x-0"
        style={{
          top: mode === 'mirror' ? 'calc(50% - 1.5px)' : 'auto',
          bottom: mode === 'mirror' ? 'auto' : 0,
          height: '3px',
          background: 'var(--grad-prism)',
          boxShadow: '0 1px 6px rgb(71 68 150 / .28)',
        }}
      />

      {/* 折痕：答过的题留在光带上，整局的轨迹一直可见 */}
      {creases && creases.length > 0 && (
        <div aria-hidden className="pointer-events-none absolute inset-x-0" style={{ bottom: 0 }}>
          {creases.map((c, i) => (
            <span
              key={i}
              className="absolute block"
              style={{
                left: `${c.at * 100}%`,
                bottom: '-1px',
                width: '3px',
                height: c.tone === 'pending' ? 'calc(6 * var(--u))' : 'calc(12 * var(--u))',
                transform: 'translateX(-1px)',
                // 判定色在 Play、Result 与这条光带上必须一致，
                // 否则「答对」在三处是三种颜色
                background:
                  c.tone === 'good'
                    ? 'var(--color-correct)'
                    : c.tone === 'bad'
                      ? 'var(--color-wrong)'
                      : 'transparent',
                boxShadow:
                  c.tone === 'pending' ? 'inset 0 0 0 1px rgb(162 162 192 / .6)' : undefined,
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
