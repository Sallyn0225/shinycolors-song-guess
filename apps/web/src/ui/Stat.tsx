import type { ReactNode } from 'react'

interface Props {
  /** 上排：小号紫色标签 */
  label: string
  /** 下排：Jost 等宽数字 */
  value: ReactNode
  align?: 'left' | 'center'
  size?: 'sm' | 'md'
}

/** 小标 + 大数字。参数表、赛后统计、状态轨都用它。 */
export function Stat({ label, value, align = 'left', size = 'md' }: Props) {
  return (
    <div className={align === 'center' ? 'text-center' : ''}>
      <dt
        className="text-2xs font-semibold text-primary"
        style={{ letterSpacing: 'var(--tracking-wide)' }}
      >
        {label}
      </dt>
      <dd
        className={`latin mt-1 font-semibold text-ink ${size === 'md' ? 'text-lg' : 'text-sm'}`}
        style={{ letterSpacing: 'var(--tracking-tight)' }}
      >
        {value}
      </dd>
    </div>
  )
}
