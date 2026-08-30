import { useEffect, useRef, type ReactNode } from 'react'

interface Props {
  /** 整块遮罩本身可点（刷新后的「点击继续对局」用） */
  onClick?: () => void
  /** 无障碍名称。有它才是一个真正的对话框 */
  label: string
  z?: number
  children: ReactNode
}

/**
 * 全屏遮罩。明底 —— 这套世界是白的，暗色遮罩会把人从场景里踢出去。
 * 用 backdrop-blur 而不是压黑，底下的牌面仍若隐若现，「对局还在」这件事就还成立。
 *
 * 它是模态：`role="dialog" aria-modal`，进入时自动聚焦，并把焦点关在里面。
 * 不做这件事的话，88% 不透明的遮罩后面那 24 张牌的按钮仍在 tab 序列里，
 * 键盘用户要穿过两打看不见的按钮才能够到仅剩的两个操作。
 */
export function Overlay({ onClick, label, z = 50, children }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = ref.current
    if (!root) return
    const focusables = () =>
      [...root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter((el) => !el.hasAttribute('disabled'))

    const first = focusables()[0] ?? root
    first.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const list = focusables()
      if (list.length === 0) return
      const head = list[0] as HTMLElement
      const tail = list[list.length - 1] as HTMLElement
      if (e.shiftKey && document.activeElement === head) {
        e.preventDefault()
        tail.focus()
      } else if (!e.shiftKey && document.activeElement === tail) {
        e.preventDefault()
        head.focus()
      }
    }
    root.addEventListener('keydown', onKey)
    return () => root.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      className="fixed inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center"
      style={{
        zIndex: z,
        background: 'rgb(247 246 251 / 0.9)',
        backdropFilter: 'blur(calc(6 * var(--u)))',
      }}
      {...(onClick ? { onClick } : {})}
    >
      {children}
    </div>
  )
}

/** 遮罩顶部那一小段棱镜光 —— 全站唯一的彩虹元素在此处也出现一次，保持世界连贯 */
export function OverlayMark() {
  return (
    <span
      aria-hidden
      className="block"
      style={{
        width: 'calc(80 * var(--u))',
        height: '2px',
        background: 'var(--grad-prism)',
      }}
    />
  )
}
