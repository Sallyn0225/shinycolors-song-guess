import { useEffect, useRef } from 'react'

/**
 * 片段播放的剩余条：一条 2px 素色横条，从左向右排空。
 *
 * 答题窗口的剩余由 PrismRail 计，但片段实际只播 clipSeconds（8/6 秒），比答题窗口短，
 * 重听后还会重新填满——重置语义与答题窗口不同，所以它有自己的数据源
 * （audio.playRemaining，读引擎真实调度的播放结束时刻，不是 setTimeout 估算）。
 *
 * 不复用 PrismRail：那是 canvas + ResizeObserver + 频谱 DSP 的重组件，
 * 它的 --grad-prism 与「两端向中收」是答题窗口的身份标识。这条用中性色、单侧排空，
 * 两条计时才分得开。也不配秒数读数：屏幕上「持续运动」的东西从一条变成两条
 * 已经是一次破例（见 Countdown 的注释），再加一个跳秒数字是第二次。
 *
 * 硬性实现约束（与 PrismRail / Countdown 同一套，不是风格偏好）：
 *   1. 只有一个 rAF 循环，每帧直写 style.clipPath，不许 setState。
 *   2. 不加 transition——补间就不锁音频时钟了；时间映射严格线性。
 *   3. 每帧不读 DOM，只写。
 */
interface Props {
  /** 取本次播放的剩余比例 0~1。传函数而不是数值，与 PrismRail / Countdown 同一套约定 */
  getRemaining: () => number
  /** 无障碍：这条条子在计什么 */
  label: string
  className?: string
}

export function ClipRail({ getRemaining, label, className = '' }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)

  // 每帧从 ref 读最新的取值函数，避免把 effect 绑在它的身份上重启 rAF
  const getRef = useRef(getRemaining)
  getRef.current = getRemaining

  useEffect(() => {
    const root = rootRef.current
    const track = trackRef.current
    if (!root || !track) return

    let lastPct = -1
    let lastClip = ''
    let raf = 0

    const frame = () => {
      raf = requestAnimationFrame(frame)

      const remaining = Math.max(0, Math.min(1, getRef.current()))
      // 单侧排空，与 PrismRail 的「两端向中收」在方向上就不同
      const clip = `inset(0 ${(1 - remaining) * 100}% 0 0)`
      // 这条是无条件渲染的，loading / countdown / revealed 期间 remaining 恒为 0，
      // 每帧写同一个字符串仍然会让浏览器把这个元素的样式重算一遍。值没变就不写。
      if (clip !== lastClip) {
        track.style.clipPath = clip
        lastClip = clip
      }

      // aria 值最多每 1% 更新一次，别让读屏软件被每帧刷屏（与 PrismRail 相同）
      const pct = Math.round(remaining * 100)
      if (pct !== lastPct) {
        root.setAttribute('aria-valuenow', String(pct))
        lastPct = pct
      }
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div
      ref={rootRef}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={['relative w-full', className].filter(Boolean).join(' ')}
      style={{ height: '2px' }}
    >
      {/* 轨道兜底，让「排掉了多少」看得出来 */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0"
        style={{ height: '2px', background: 'var(--color-track)' }}
      />
      {/* 点亮的那一段。中性色，视觉上从属于主光带，不与 PrismRail 的彩虹抢 */}
      <div
        ref={trackRef}
        aria-hidden
        className="absolute inset-x-0 top-0"
        style={{ height: '2px', background: 'var(--color-ink-faint)' }}
      />
    </div>
  )
}
