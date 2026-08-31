/**
 * 图标。全部手绘 SVG，统一 24 网格、1.8 描边、方头方角 —— 与这套世界的零圆角一致。
 * 不用 unicode 字形（✓ ✕ ↻）充数：它们的字重、光学重心随字体变，跟设计系统对不齐。
 */

export type IconName =
  | 'check'
  | 'cross'
  | 'replay'
  | 'next'
  | 'enter'
  | 'link'
  | 'warn'
  | 'swap'
  | 'volume'
  | 'mute'
  | 'music'
  | 'music-off'

const PATHS: Record<IconName, string> = {
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
  // 音量：方头喇叭 + 两道声波。喇叭体是闭合折线，与其余图标同为 1.8 描边、无填充
  volume: 'M3 9.5h3.5l5-4v13l-5-4H3Z M15 9.6a3.6 3.6 0 0 1 0 4.8 M18 6.9a7.4 7.4 0 0 1 0 10.2',
  // 静音：同一个喇叭体，声波换成一个叉 —— 与 cross 同一套语汇
  mute: 'M3 9.5h3.5l5-4v13l-5-4H3Z M16.2 9.7l4.8 4.6M21 9.7l-4.8 4.6',
  // 背景音乐：两个符头 + 连梁的八分音符。
  // 符头是圆的，与 replay 的弧同理——「零圆角」管的是版面上的**面**，不是图标内部的形
  music: 'M9 18V5l12-2v13 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  // 关掉：同一个音符加一道贯穿斜杠。
  // 这里不沿用 mute 的「叉」——喇叭只占左半边，右边空着才放得下叉；
  // 音符占满整格，叉会糊在符干上，贯穿斜杠才读得出来
  'music-off':
    'M9 18V5l12-2v13 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M4 4l16 16',
}

interface Props {
  name: IconName
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
