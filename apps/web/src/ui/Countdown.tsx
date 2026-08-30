import { useEffect, useRef } from 'react'

/**
 * 剩余秒数。
 *
 * 光带回答的是「时间在流逝」，这个数字回答的是「还剩几秒」。
 * 收拢的光带读得出走势和快慢，读不出精确余量 —— 两者互补，不是同一件事说两遍。
 * 它按秒跳格，是离散读数：全局唯一**持续**运动的仍然只有那条光带。
 *
 * 硬性实现约束（不是风格偏好）：
 *   1. 只有一个 rAF 循环，直写 textContent。整个答题窗口都在倒数，
 *      每秒 setState 会连带把 Play 的四条选项、封面和 Karuta 的两片牌阵一起重渲染。
 *   2. 数字宽度由一个隐藏的「88…」占位撑住。tabular-nums 只保证**同位数**等宽，
 *      10 → 9 少掉一位，整块仍会横跳一次 —— 而这一跳正好发生在最该盯住它的时刻。
 *   3. 末段的脉冲是每秒一次的**冲量**，不是一段持续动画。reduced-motion 下只去掉冲量，
 *      颜色留着：变红是信息，不是装饰。
 */

interface Props {
  /** 取剩余毫秒。传函数而不是数值 —— 与 PrismRail 同一套约定 */
  getMsLeft: () => number
  /** 这个窗口一共多少秒。决定数字占几位，也钳住服务端时钟抖动带来的越界读数 */
  totalSeconds: number
  /** 剩到这个秒数（含）进告警。默认 3 */
  warnAt?: number
  /** 字号，--u 的倍数 */
  size?: number
  /** 无障碍：这个数字在计什么 */
  label: string
  className?: string
}

export function Countdown({
  getMsLeft,
  totalSeconds,
  warnAt = 3,
  size = 56,
  label,
  className = '',
}: Props) {
  const rootRef = useRef<HTMLSpanElement>(null)
  const numRef = useRef<HTMLSpanElement>(null)
  const unitRef = useRef<HTMLSpanElement>(null)

  // 每帧从 ref 读最新的取值函数，避免把 effect 绑在它的身份上重启 rAF
  const getRef = useRef(getMsLeft)
  getRef.current = getMsLeft

  const cap = Math.max(1, Math.ceil(totalSeconds))
  const digits = String(cap).length

  useEffect(() => {
    const root = rootRef.current
    const num = numRef.current
    const unit = unitRef.current
    if (!root || !num || !unit) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let last = -1
    let raf = 0

    const frame = () => {
      raf = requestAnimationFrame(frame)

      const s = Math.min(cap, Math.max(0, Math.ceil(getRef.current() / 1000)))
      if (s === last) return
      const first = last < 0
      last = s

      num.textContent = String(s)
      root.setAttribute('aria-label', `${label}，还剩 ${s} 秒`)

      const urgent = s <= warnAt
      num.style.color = urgent ? 'var(--color-wrong)' : 'var(--color-ink)'
      unit.style.color = urgent ? 'var(--color-wrong)' : 'var(--color-ink-faint)'

      // 末段每一秒落地时给一下冲量。挂载时的第一次不算 —— 那不是「又少了一秒」
      if (urgent && s > 0 && !first && !reduce) {
        num.animate(
          [
            { transform: 'scale(1.16)', opacity: 0.5 },
            { transform: 'scale(1)', opacity: 1 },
          ],
          { duration: 380, easing: 'cubic-bezier(0.075, 0.82, 0.165, 1)' },
        )
      }
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [cap, warnAt, label])

  return (
    <span
      ref={rootRef}
      role="timer"
      aria-label={label}
      className={`latin inline-flex items-baseline font-bold ${className}`.trim()}
      style={{ letterSpacing: 'var(--tracking-tight)', lineHeight: 1 }}
    >
      {/*
        隐藏的占位撑住最宽的读数，实数右对齐叠在它上面。
        绝对定位的那一层不参与基线计算，所以整块的基线由占位给出 ——
        这样 26u 的数字与 12px 的说明文字才能真正对齐到同一条基线上。
      */}
      <span
        style={{
          position: 'relative',
          display: 'inline-block',
          fontSize: `calc(${size} * var(--u))`,
        }}
      >
        <span aria-hidden style={{ visibility: 'hidden' }}>
          {'8'.repeat(digits)}
        </span>
        <span
          ref={numRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            textAlign: 'right',
            color: 'var(--color-ink)',
          }}
        />
      </span>
      <span
        ref={unitRef}
        aria-hidden
        style={{
          marginLeft: `calc(${size * 0.06} * var(--u))`,
          fontSize: `calc(${size * 0.34} * var(--u))`,
          fontWeight: 600,
          color: 'var(--color-ink-faint)',
        }}
      >
        s
      </span>
    </span>
  )
}
