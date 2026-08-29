import { useEffect, useRef } from 'react'

import { audio } from '../audio'

/** 棱镜光谱 —— 8 个组合的官方代表色排成的一道光 */
const PRISM: Array<[number, string]> = [
  [0.0, '#fff68d'],
  [0.14, '#fa8333'],
  [0.28, '#af011c'],
  [0.43, '#ff699e'],
  [0.57, '#853998'],
  [0.71, '#384d98'],
  [0.86, '#008e74'],
  [1.0, '#6b7280'],
]

function prismAt(t: number): string {
  const x = Math.min(1, Math.max(0, t))
  let i = 0
  while (i < PRISM.length - 2 && (PRISM[i + 1] as [number, string])[0] < x) i++
  const [p0, c0] = PRISM[i] as [number, string]
  const [p1, c1] = PRISM[i + 1] as [number, string]
  const f = p1 === p0 ? 0 : (x - p0) / (p1 - p0)
  const hex = (c: string) => [
    parseInt(c.slice(1, 3), 16),
    parseInt(c.slice(3, 5), 16),
    parseInt(c.slice(5, 7), 16),
  ]
  const a = hex(c0)
  const b = hex(c1)
  const m = a.map((v, k) => Math.round(v + ((b[k] as number) - v) * f))
  return `rgb(${m[0]},${m[1]},${m[2]})`
}

const BARS = 72
const RING_R = 46
const RING_C = 2 * Math.PI * RING_R

interface Props {
  /**
   * 取剩余时间比例 0~1。
   * 传函数而不是数值：倒计时靠 rAF 直接写 DOM，不经过 React state——
   * 每帧 setState 在 React 18 的并发调度下会被批处理，表现就是「有时候没反应」。
   */
  getRemaining: () => number
  /** 答题时限（秒），用于显示中央的秒数 */
  totalSeconds: number
  mode: 'idle' | 'countdown' | 'reveal'
  verdict?: 'correct' | 'wrong' | null
  children?: React.ReactNode
}

/**
 * 舞台：倒计时环 + 真实频谱可视化。
 *
 * 听音频时屏幕上没有别的可看，所以这一个元素必须同时回答两件事：
 * 「还剩多久」和「现在在播吗」。频谱由 AnalyserNode 驱动，是真实响应正在播放的音频，
 * 不是循环的假动画——对听觉游戏来说这点值得较真。
 */
export function Stage({ getRemaining, totalSeconds, mode, verdict = null, children }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ringRef = useRef<SVGCircleElement>(null)
  const secondsRef = useRef<HTMLSpanElement>(null)
  const rafRef = useRef(0)
  const levels = useRef(new Float32Array(BARS))
  const smooth = useRef(new Float32Array(BARS))

  const getRemainingRef = useRef(getRemaining)
  getRemainingRef.current = getRemaining
  const modeRef = useRef(mode)
  modeRef.current = mode

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const size = canvas.clientWidth
      if (size === 0) return
      canvas.width = size * dpr
      canvas.height = size * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    let lastShownSecond = -1

    const frame = () => {
      rafRef.current = requestAnimationFrame(frame)

      // ── 倒计时：直接写 DOM ──────────────────────────
      const remaining = Math.max(0, Math.min(1, getRemainingRef.current()))
      const ring = ringRef.current
      if (ring) ring.style.strokeDashoffset = String(RING_C * (1 - remaining))

      const sec = secondsRef.current
      if (sec && modeRef.current === 'countdown') {
        const shown = Math.ceil(remaining * totalSeconds)
        if (shown !== lastShownSecond) {
          sec.textContent = String(shown)
          lastShownSecond = shown
        }
      }

      // ── 频谱 ───────────────────────────────────────
      const size = canvas.clientWidth
      if (size === 0) return
      const cx = size / 2
      const cy = size / 2
      const inner = size * 0.315
      const maxLen = size * 0.135

      ctx.clearRect(0, 0, size, size)

      // 直接问引擎在不在出声，不依赖 React state
      const got = audio.isPlaying && audio.spectrum(levels.current)
      for (let i = 0; i < BARS; i++) {
        const src = got ? (levels.current[Math.floor((i / BARS) ** 1.4 * BARS)] ?? 0) : 0
        const target = reduce ? src * 0.4 : src
        const prev = smooth.current[i] ?? 0
        smooth.current[i] = prev + (target - prev) * (target > prev ? 0.45 : 0.12)
      }

      for (let i = 0; i < BARS; i++) {
        const t = i / BARS
        const angle = t * Math.PI * 2 - Math.PI / 2
        const level = smooth.current[i] ?? 0
        const len = 3 + level * maxLen
        const color = prismAt(t)

        ctx.strokeStyle = color
        ctx.globalAlpha = 0.25 + level * 0.75
        ctx.lineWidth = Math.max(1.5, size * 0.006)
        ctx.lineCap = 'round'
        ctx.shadowBlur = level > 0.35 ? 14 : 0
        ctx.shadowColor = color
        ctx.beginPath()
        ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner)
        ctx.lineTo(cx + Math.cos(angle) * (inner + len), cy + Math.sin(angle) * (inner + len))
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      ctx.shadowBlur = 0
    }

    rafRef.current = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
    }
  }, [totalSeconds])

  const ringColor =
    verdict === 'correct' ? 'var(--color-correct)' : verdict === 'wrong' ? 'var(--color-wrong)' : '#8ea2ff'

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[340px]">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />

      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={RING_R} fill="none" stroke="var(--color-line)" strokeWidth="1.5" />
        <circle
          ref={ringRef}
          cx="50"
          cy="50"
          r={RING_R}
          fill="none"
          stroke={ringColor}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={RING_C}
          strokeDashoffset={0}
          style={{ transition: 'stroke 220ms' }}
        />
      </svg>

      {verdict && (
        <span
          className="anim-halo pointer-events-none absolute inset-[18%] rounded-full"
          style={{
            boxShadow: `0 0 60px 20px ${verdict === 'correct' ? 'rgba(61,220,151,.55)' : 'rgba(255,77,94,.5)'}`,
          }}
        />
      )}

      <div className="absolute inset-[22%] flex flex-col items-center justify-center text-center">
        {mode === 'countdown' && (
          <>
            <span ref={secondsRef} className="tnum font-mono text-5xl font-medium">
              {totalSeconds}
            </span>
            <span className="mt-1 text-[10px] tracking-[0.2em] text-faint uppercase">seconds</span>
          </>
        )}
        {mode !== 'countdown' && children}
      </div>
    </div>
  )
}
