import type { InputHTMLAttributes } from 'react'

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  className?: string
  /** 房间码那种要拉开字距、居中、等宽数字的输入 */
  code?: boolean
}

/**
 * 斜切输入框。焦点态把边缘转成 accent-deep。
 *
 * 输入框自己不裁剪（clip-path 会吃掉光标与选中高亮的边缘），
 * 形状由外层的斜切底板给出，输入框透明地坐在上面。
 */
export function Field({ className = '', code = false, style, ...rest }: Props) {
  return (
    <span className="cut-shadow-sm block">
      <span className="glass-lit block cut-slant relative">
        <input
          {...rest}
          className={[
            'peer w-full bg-transparent px-5 py-3 text-ink outline-none',
            'placeholder:text-ink-faint',
            code ? 'latin text-center text-lg font-semibold tracking-[0.3em] uppercase' : 'text-sm',
            className,
          ]
            .filter(Boolean)
            .join(' ')}
          style={{ minHeight: '44px', ...style }}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 transition-[box-shadow] duration-300"
          style={{ boxShadow: 'inset 0 0 0 1px var(--color-primary-lt)' }}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 peer-focus:opacity-100"
          style={{ boxShadow: 'inset 0 0 0 2px var(--color-accent-deep)' }}
        />
      </span>
    </span>
  )
}
