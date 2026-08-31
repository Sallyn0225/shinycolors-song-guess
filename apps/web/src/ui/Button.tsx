import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react'

import { sfx } from '../sfx'

type Variant = 'primary' | 'glass' | 'ghost' | 'outline' | 'quiet'
type Size = 'sm' | 'md' | 'lg'

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: Variant
  size?: Size
  full?: boolean
  className?: string
  children?: ReactNode
}

const SIZE: Record<Size, string> = {
  sm: 'px-4 py-1.5 text-xs',
  md: 'px-6 py-3 text-sm',
  lg: 'px-10 py-3.5 text-base',
}

/* 触摸热区一律真 px，不走 --u：--u 触到低钳位时会掉到 44px 以下。
   sm 曾是 32px —— 过 WCAG 2.5.8 的 24px 下限，但过不了 2.5.5 的 44px，
   而「我记好了」这种是手机上要抢时间点的主操作，按 44 给。 */
const MIN_H: Record<Size, string> = { sm: '44px', md: '44px', lg: 'max(48px, calc(62 * var(--u)))' }

/**
 * 平行四边形按钮。左上削一角 —— 官网所有按钮/标签/导航条都是这个形状。
 *
 * 用 <span class="cut-shadow"> 包住是必须的：阴影和焦点环都画在外层，
 * 否则 clip-path 会把它们一起裁掉（见 Cut.tsx 的说明）。
 */
export function Button({
  variant = 'glass',
  size = 'md',
  full = false,
  className = '',
  children,
  onClick,
  ...rest
}: Props) {
  const tone =
    variant === 'primary'
      ? 'text-white'
      : variant === 'glass'
        ? 'glass-lit text-ink'
        : variant === 'ghost'
          ? 'text-primary'
          : variant === 'outline'
            ? 'text-primary'
            : 'text-ink-sub'

  const bg =
    variant === 'primary'
      ? { background: 'var(--grad-brand-ink)' }
      : variant === 'ghost'
        ? { background: 'rgb(255 255 255 / .5)' }
        : variant === 'outline'
          ? // comp 的主操作是描边不填充的平行四边形，不是浅玻璃小片
            { background: 'transparent' }
          : undefined

  /**
   * 描边的宽度。
   *
   * 轮廓是「非文字对比度」，要 3:1 —— primary-lt 只有 2.31:1，所以用 primary（5.50:1）。
   *
   * 画法是 `.cut-ring` 而不是 `inset box-shadow`：inset 阴影描的是**矩形**的边，
   * 按钮本身被 `.cut-slant` 裁成平行四边形之后，斜边上没有描边，
   * 左下角还会露出一截直角残边。见 index.css「坑三」。
   */
  const ring = variant === 'ghost' ? '1px' : variant === 'outline' ? '1.5px' : null

  /**
   * click 音在组件内部前置，而不是在每个调用点自己放：
   * 全站按钮要的是**一致**的反馈，散进调用点迟早漏一处、漏的那处最显眼。
   * OptionBar 的答题选项不走 Button（自绘 button），所以不会叠上正/误音。
   * 播放在外部 onClick 之前——反馈属于「按下」这一刻，不等按钮的事办完。
   */
  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    sfx.play('click')
    onClick?.(e)
  }

  return (
    <span
      className={`${variant === 'quiet' ? '' : 'cut-shadow-sm'} ${full ? 'block' : 'inline-block'}`}
    >
      <button
        {...rest}
        onClick={handleClick}
        className={[
          variant === 'quiet' ? '' : 'cut-slant relative',
          'inline-flex w-full items-center justify-center gap-2 font-latin font-semibold',
          'tracking-[0.1em] transition-[transform,background-color,color,opacity] duration-300',
          'ease-[var(--ease-prism)] disabled:opacity-40',
          'enabled:hover:-translate-y-px enabled:active:translate-y-0',
          SIZE[size],
          tone,
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ minHeight: MIN_H[size], ...bg }}
      >
        {ring && (
          <span
            aria-hidden
            className="cut-ring cut-ring-slant"
            style={{ '--ring': ring, '--ring-color': 'var(--color-primary)' } as React.CSSProperties}
          />
        )}
        {children}
      </button>
    </span>
  )
}
