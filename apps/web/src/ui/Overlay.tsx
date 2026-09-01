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

    /*
      记住是谁把这个模态打开的。关掉之后焦点必须回到它 ——
      不还原的话焦点落回 <body>，键盘用户要从页面最顶端重新 Tab 一遍才能回到
      刚才那颗按钮，而那颗按钮可能埋在工具条第三位（首页的「游戏信息」正是）。
      这一层原本把三件更难的事都做对了（clip-path 吃 outline、mask 吃 outline、
      aria-modal 不管 Tab 顺序），唯独漏了最标准的这一步。
    */
    const opener = document.activeElement as HTMLElement | null

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
    return () => {
      root.removeEventListener('keydown', onKey)
      /*
        只在触发者还挂在文档里时还原。整屏被换掉时（牌场退出、开局切页）
        它已经不在 DOM 上，focus() 是空操作，但显式判一下能说清意图：
        「回到打开它的那颗按钮」，而不是「无论如何抢一次焦点」。
      */
      if (opener && document.contains(opener)) opener.focus()
    }
  }, [])

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      className="fixed inset-0 flex flex-col items-center justify-center gap-4 text-center"
      style={{
        zIndex: z,
        background: 'var(--surface-veil)',
        backdropFilter: 'var(--blur-veil)',
        /*
          内边距写在这里而不是留 px-6：fixed 层不受 body 的安全区内边距管，
          横屏握着的 iPhone 上刘海在**侧边**，遮罩里的按钮会被圆角削掉一截。
          取 max() 所以没有安全区的设备上就是原来的 px-6。
        */
        paddingInline: 'max(calc(6 * var(--spacing)), var(--sa-l), var(--sa-r))',
        paddingBlock: 'max(var(--sa-t), var(--sa-b))',
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
