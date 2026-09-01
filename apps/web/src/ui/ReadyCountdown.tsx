import { useEffect, useRef, useState } from 'react'

import { sfx } from '../sfx'

/**
 * 开局缓冲的 3-2-1 倒计时。与 `ui/Countdown.tsx` 是两件事，不共用：
 * 那个是**跟随**服务端时钟的连续读数，必须 rAF 逐帧钳制抖动；
 * 这里是固定几步的离散节奏，递归 setTimeout 就够，rAF 反而把简单事搅复杂。
 *
 * 定时器由组件自持而不是留在 Play：每格落地要同时做换数字、tick、冲量三件事，
 * 拆到 Play 就得把「当前第几格」从这边传回去再传回来。Play 只 await onDone
 * （bridge 是它那边的一个 resolver ref），退出本局时它的 effect cleanup 会调
 * resolver 放行 async 链、本组件随卸载清掉唯一在途的定时器 —— 不会漏出一次 go。
 */

interface Props {
  /** 一共倒数几格。默认 3 */
  seconds?: number
  /** 最后一格停留满之后（go 已播）交回。正常流程只调一次 */
  onDone: () => void
  /** 无障碍：这个数字在计什么 */
  label: string
  /** 大数字字号，--u 的倍数。默认对齐 .sc-figure 的 96u */
  size?: number
}

/** 每格落地的冲量。与 Countdown 的末段脉冲同一套曲线，量级略收 —— 开局是缓冲不是告警 */
const IMPULSE = [
  { transform: 'scale(1.14)', opacity: 0.45 },
  { transform: 'scale(1)', opacity: 1 },
]
const IMPULSE_TIMING = { duration: 380, easing: 'cubic-bezier(0.075, 0.82, 0.165, 1)' }

export function ReadyCountdown({ seconds = 3, onDone, label, size = 96 }: Props) {
  const [num, setNum] = useState(seconds)
  const numRef = useRef<HTMLSpanElement>(null)
  // onDone 的身份随 Play 每次渲染而变；effect 只依赖 seconds，靠 ref 取最新
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let left = seconds
    let timer = 0

    // 一格落地 = 换数字 + 一声 tick + 一次冲量。reduced-motion 只免冲量：
    // 数字更换本身是信息（「还剩几秒」），不是装饰
    const land = (n: number) => {
      setNum(n)
      sfx.play('tick')
      if (!reduce) numRef.current?.animate(IMPULSE, IMPULSE_TIMING)
    }

    land(left)
    const step = () => {
      left -= 1
      if (left > 0) {
        land(left)
        timer = window.setTimeout(step, 1000)
      } else {
        // 走到这里说明「1」已停留满一秒：一声 go 后交回，go 与开播的重叠听感是「出发」
        sfx.play('go')
        onDoneRef.current?.()
      }
    }
    timer = window.setTimeout(step, 1000)

    // 唯一在途的定时器在这里清。StrictMode 双跑只会让第一格的 tick 响两声（仅 dev），
    // 不会留下第二份定时器、更不会双 go —— 第一跑的链在 step 里就已经死了
    return () => window.clearTimeout(timer)
  }, [seconds])

  return (
    <div
      role="timer"
      aria-label={`${label}，还剩 ${num} 秒`}
      // fixed：数字要在屏幕中央，而不是选项区的中央 —— 大号数字直接压在选项
      // 文字上读不清，垫一层半透明白底把底下的内容洗淡，数字才立得住。
      // pointer-events-none：盖住整屏但不接任何点击，「退出本局」永远可达
      className="anim-appear pointer-events-none fixed inset-0 z-10 flex items-center justify-center"
      style={{ background: 'var(--color-surface-lit)' }}
    >
      <span
        ref={numRef}
        className="latin font-bold text-ink"
        style={{
          fontSize: `calc(${size} * var(--u))`,
          letterSpacing: 'var(--tracking-tight)',
          lineHeight: 1,
        }}
      >
        {num}
      </span>
    </div>
  )
}
