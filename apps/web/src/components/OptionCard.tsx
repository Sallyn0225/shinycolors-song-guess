import type { Option } from '../api'

export type OptionState = 'idle' | 'correct' | 'wrong' | 'dimmed'

interface Props {
  option: Option
  index: number
  state: OptionState
  disabled: boolean
  /** 揭晓后显示各曲的封面缩略图 */
  showThumb: boolean
  onPick: () => void
}

const KEYS = ['1', '2', '3', '4', '5', '6']

export function OptionCard({ option, index, state, disabled, showThumb, onPick }: Props) {
  const stripe = option.unitColor ?? 'var(--color-line-lit)'

  const tone =
    state === 'correct'
      ? 'border-[color:var(--color-correct)] bg-[rgba(61,220,151,.1)]'
      : state === 'wrong'
        ? 'border-[color:var(--color-wrong)] bg-[rgba(255,77,94,.12)] anim-shudder'
        : state === 'dimmed'
          ? 'border-[color:var(--color-line)] opacity-45'
          : 'border-[color:var(--color-line)] hover:border-[color:var(--color-line-lit)] hover:bg-panel-lit'

  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      aria-label={`选项 ${index + 1}：${option.title}`}
      className={[
        'group anim-rise relative flex w-full items-center gap-3 overflow-hidden rounded-xl border bg-panel',
        'px-4 py-3 text-left transition-all duration-200 sm:px-4 sm:py-3.5',
        'disabled:cursor-default enabled:hover:-translate-y-0.5 enabled:active:translate-y-0',
        tone,
      ].join(' ')}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      {/* 组合色条：卡片保持深底浅字，颜色只做标识不当背景，否则毁掉文字对比度 */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px] transition-all duration-200 group-enabled:group-hover:w-[5px]"
        style={{ background: stripe, boxShadow: `0 0 12px ${stripe}55` }}
      />

      {showThumb ? (
        <img
          src={`/thumb/${option.id}.webp`}
          alt=""
          loading="eager"
          className={[
            'h-11 w-11 shrink-0 rounded-lg object-cover transition-all duration-300',
            state === 'correct' ? 'ring-2 ring-[color:var(--color-correct)]' : '',
            state === 'wrong' ? 'ring-2 ring-[color:var(--color-wrong)]' : '',
            state === 'dimmed' ? 'grayscale' : '',
          ].join(' ')}
        />
      ) : (
        <kbd className="tnum hidden shrink-0 rounded-md border border-[color:var(--color-line)] px-2 py-1 font-mono text-[11px] text-faint sm:block">
          {KEYS[index]}
        </kbd>
      )}

      <span className="min-w-0 flex-1">
        <span className="jp-wrap block text-[15px] leading-snug font-bold text-text sm:text-base">
          {option.title}
        </span>
        <span className="jp-wrap mt-0.5 block truncate text-xs text-muted">{option.artist}</span>
      </span>

      {state === 'correct' && (
        <span className="shrink-0 text-lg text-[color:var(--color-correct)]" aria-label="正确答案">
          ✓
        </span>
      )}
      {state === 'wrong' && (
        <span className="shrink-0 text-lg text-[color:var(--color-wrong)]" aria-label="你选的（错误）">
          ✕
        </span>
      )}
    </button>
  )
}
