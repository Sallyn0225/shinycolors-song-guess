import type { CSSProperties, ReactNode } from 'react'

export type CutShape = 'slant' | 'slant-r' | 'card' | 'card-sm' | 'hex' | 'bar'
export type CutElevation = 'none' | 'sm' | 'md' | 'lg'

const SHAPE_CLASS: Record<CutShape, string> = {
  slant: 'cut-slant',
  'slant-r': 'cut-slant-r',
  card: 'cut-card',
  'card-sm': 'cut-card-sm',
  hex: 'cut-hex',
  bar: 'cut-bar',
}

const SHADOW_CLASS: Record<CutElevation, string> = {
  none: '',
  sm: 'cut-shadow-sm',
  md: 'cut-shadow',
  lg: 'cut-shadow-lg',
}

interface Props {
  shape: CutShape
  elevation?: CutElevation
  /** 内层（被裁的那层）的类名 */
  className?: string
  /** 外层（画阴影与焦点环的那层）的类名 */
  outerClassName?: string
  style?: CSSProperties
  outerStyle?: CSSProperties
  children?: ReactNode
}

/**
 * 斜切容器。
 *
 * 两层不是洁癖，是两个必须绕开的坑：
 *   1. `filter: drop-shadow()` 与 `clip-path` 同元素时，落在裁剪区外的阴影会被一起裁掉。
 *      官网的做法就是阴影在父、裁剪在子。
 *   2. 被裁元素上画的 `outline` 同样会被裁没 —— 等于没有焦点环。
 *      焦点环由外层的 `:has(:focus-visible)` 代画（见 index.css）。
 *
 * 所以：外层只管阴影与焦点环，内层只管裁剪与填色。
 */
export function Cut({
  shape,
  elevation = 'md',
  className = '',
  outerClassName = '',
  style,
  outerStyle,
  children,
}: Props) {
  return (
    <span className={`${SHADOW_CLASS[elevation]} ${outerClassName}`.trim()} style={outerStyle}>
      <span className={`block ${SHAPE_CLASS[shape]} ${className}`.trim()} style={style}>
        {children}
      </span>
    </span>
  )
}
