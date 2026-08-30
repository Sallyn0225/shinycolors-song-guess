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
        {/*
          描边用 .cut-ring 而不是 inset box-shadow：inset 阴影描的是矩形的边，
          被外层的 clip-path 一裁，斜边上就什么都没有，左下角反而露出一截直角残边。
          见 index.css「坑三」。
        */}
        <span
          aria-hidden
          className="cut-ring cut-ring-slant"
          // 输入框静止态的边框同样是非文字对比度，要 3:1
          style={{ '--ring': '1.5px', '--ring-color': 'var(--color-primary)' } as React.CSSProperties}
        />
        <span
          aria-hidden
          className="cut-ring cut-ring-slant opacity-0 transition-opacity duration-300 peer-focus:opacity-100"
          style={{ '--ring': '2px', '--ring-color': 'var(--color-accent-ink)' } as React.CSSProperties}
        />
      </span>
    </span>
  )
}
