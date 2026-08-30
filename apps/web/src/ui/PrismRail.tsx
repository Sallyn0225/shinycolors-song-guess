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

const BARS = 72

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

  const levels = useRef(new Float32Array(BARS))
  const smooth = useRef(new Float32Array(BARS))

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

      for (let i = 0; i < BARS; i++) {
        // 低频占的格子多一些，视觉上才不是一坨挤在左边
        const src = got ? (levels.current[Math.floor((i / BARS) ** 1.4 * BARS)] ?? 0) : 0
        const target = reduce ? src * 0.4 : src
        const prev = smooth.current[i] ?? 0
        // 起快落慢：上升 0.45、回落 0.12，看起来才像在跟着音乐
        smooth.current[i] = prev + (target - prev) * (target > prev ? 0.45 : 0.12)
      }

      const step = w / BARS
      const barW = Math.max(1, step * 0.42)
      for (let i = 0; i < BARS; i++) {
        const level = smooth.current[i] ?? 0
        if (level <= 0.001) continue
        const len = level * maxLen
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

  const span = mode === 'mirror' ? 'calc(88 * var(--u))' : 'calc(46 * var(--u))'

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
                width: '2px',
                height: c.tone === 'pending' ? 'calc(5 * var(--u))' : 'calc(9 * var(--u))',
                transform: 'translateX(-1px)',
                background:
                  c.tone === 'good'
                    ? 'var(--color-accent-deep)'
                    : c.tone === 'bad'
                      ? 'var(--color-primary-lt)'
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
