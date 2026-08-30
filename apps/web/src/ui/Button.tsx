import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'glass' | 'ghost' | 'quiet'
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
  lg: 'px-8 py-3.5 text-base',
}

const MIN_H: Record<Size, string> = { sm: '32px', md: '44px', lg: '48px' }

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
  ...rest
}: Props) {
  const tone =
    variant === 'primary'
      ? 'text-white'
      : variant === 'glass'
        ? 'glass-lit text-ink'
        : variant === 'ghost'
          ? 'text-primary'
          : 'text-ink-sub'

  const bg =
    variant === 'primary'
      ? { background: 'var(--grad-brand-ink)' }
      : variant === 'ghost'
        ? { boxShadow: 'inset 0 0 0 1px var(--color-primary-lt)', background: 'rgb(255 255 255 / .5)' }
        : undefined

  return (
    <span
      className={`${variant === 'quiet' ? '' : 'cut-shadow-sm'} ${full ? 'block' : 'inline-block'}`}
    >
      <button
        {...rest}
        className={[
          variant === 'quiet' ? '' : 'cut-slant',
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
        {children}
      </button>
    </span>
  )
}
