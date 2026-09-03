/**
 * 图标体系：
 * 1. 界面描边图标：自绘 SVG，统一 24 网格、1.8 描边、方头方角 —— 与这套世界的零圆角一致。
 *    不用 unicode 字形（✓ ✕ ↻）充数：它们的字重、光学重心随字体变，跟设计系统对不齐。
 * 2. 品牌图标：使用官方/权威矢量（512 网格填充式图形），保持其品牌辨识度与官方造型。
 *    - github: 出处 Font Awesome Free 7.3.1 (brands/github)，许可证 CC BY 4.0，© Fonticons, Inc.
 */

export type StrokeIconName =
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
  | 'info'
  | 'trophy'

export type BrandIconName = 'github'

export type IconName = StrokeIconName | BrandIconName

const STROKE_PATHS: Record<StrokeIconName, string> = {
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
  // 信息：外圈整圆 + 点与竖杠的 i。圆画在图标**内部**是允许的 —— replay 的弧、
  // music 的符头都是先例，「零圆角」管的是版面上的面。点沿用 warn 的写法：
  // 极短竖线靠方头笔帽撑成方点
  info: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18 M12 7.5v.4 M12 10.5v5.7',
  // 奖杯：24 网格、1.8 描边、方头方角、fill="none"。杯身 + 双耳对称手柄 + 梯形立柱与方底座
  trophy:
    'M6 4h12v5c0 3.5-2.5 5.5-6 5.5S6 12.5 6 9V4Z M6 6H3.5a1.5 1.5 0 0 0-1.5 1.5v1a1.5 1.5 0 0 0 1.5 1.5H6 M18 6h2.5a1.5 1.5 0 0 1 1.5 1.5v1a1.5 1.5 0 0 1-1.5 1.5H18 M12 14.5V18 M8 18h8v3H8Z M6 21h12',
}

/**
 * 品牌图标路径（512 网格，填充式）
 * 出处: Font Awesome Free 7.3.1 (CC BY 4.0, © Fonticons, Inc.)
 */
const BRAND_PATHS: Record<BrandIconName, string> = {
  github:
    'M216.5 362.5c-66-8-112.5-55.5-112.5-117 0-25 9-52 24-70-6.5-16.5-5.5-51.5 2-66 20-2.5 47 8 63 22.5 19-6 39-9 63.5-9s44.5 3 62.5 8.5c15.5-14 43-24.5 63-22 7 13.5 8 48.5 1.5 65.5 16 19 24.5 44.5 24.5 70.5 0 61.5-46.5 108-113.5 116.5 17 11 28.5 35 28.5 62.5l0 52C323 491.5 335.5 500 350.5 494 441 459.5 512 369 512 257 512 115.5 397 0 255.5 0S0 115.5 0 257c0 111 70.5 203 165.5 237.5 13.5 5 26.5-4 26.5-17.5l0-40c-7 3-16 5-24 5-33 0-52.5-18-66.5-51.5-5.5-13.5-11.5-21.5-23-23-6-.5-8-3-8-6 0-6 10-10.5 20-10.5 14.5 0 27 9 40 27.5 10 14.5 20.5 21 33 21s20.5-4.5 32-16c8.5-8.5 15-16 21-21z',
}

interface Props {
  name: IconName
  /** 边长，默认跟随字号 */
  size?: string | number
  className?: string
}

export function Icon({ name, size = '1em', className }: Props) {
  if (name === 'github') {
    return (
      <svg
        aria-hidden
        focusable="false"
        viewBox="0 0 512 512"
        width={size}
        height={size}
        fill="currentColor"
        className={className}
        style={{ flexShrink: 0 }}
      >
        <path d={BRAND_PATHS[name]} />
      </svg>
    )
  }

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
      <path d={STROKE_PATHS[name]} />
    </svg>
  )
}
