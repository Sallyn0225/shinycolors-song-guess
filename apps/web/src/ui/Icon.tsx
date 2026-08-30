/**
 * 图标。全部手绘 SVG，统一 24 网格、1.8 描边、方头方角 —— 与这套世界的零圆角一致。
 * 不用 unicode 字形（✓ ✕ ↻）充数：它们的字重、光学重心随字体变，跟设计系统对不齐。
 */

type Name = 'check' | 'cross' | 'replay' | 'next' | 'enter' | 'link' | 'warn' | 'swap'

const PATHS: Record<Name, string> = {
  check: 'M4 12.5 9.5 18 20 6',
  cross: 'M6 6l12 12M18 6L6 18',
  // 重听：一圈开口箭头
  replay: 'M20 12a8 8 0 1 1-2.6-5.9M20 3v4h-4',
  next: 'M5 12h13M12.5 5.5 19 12l-6.5 6.5',
  enter: 'M4 12h13M12.5 6.5 18 12l-5.5 5.5M20 4v16',
  link: 'M10 14 20 4M20 4h-6M20 4v6M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  warn: 'M12 3 22 20H2L12 3ZM12 10v5M12 17.6v.4',
  // 交换位置：两条相向的箭头
  swap: 'M4 8h14M14.5 4.5 18 8l-3.5 3.5M20 16H6M9.5 12.5 6 16l3.5 3.5',
}

interface Props {
  name: Name
  /** 边长，默认跟随字号 */
  size?: string | number
  className?: string
}

export function Icon({ name, size = '1em', className }: Props) {
  return (
    <svg
      aria-hidden
      focusable="false"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="square"
      strokeLinejoin="miter"
      className={className}
      style={{ flexShrink: 0 }}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
