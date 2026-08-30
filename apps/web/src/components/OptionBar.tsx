import type { Option } from '../api'
import { Icon } from '../ui/Icon'

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

/** 斜边的水平位移。色帽与条用同一个值，两者的斜边才平行 */
const SLANT = 'calc(46 * var(--u))'
/** 右下角切角 */
const NOTCH = 'calc(40 * var(--u))'

/** 条：左端全高斜切 + 右下角切角 */
const BAR_CLIP = `polygon(${SLANT} 0, 100% 0, 100% calc(100% - ${NOTCH}), calc(100% - ${NOTCH}) 100%, 0 100%)`
/** 色帽：与条同角度的一枚独立斜片 */
const CAP_CLIP = `polygon(${SLANT} 0, 100% 0, calc(100% - ${SLANT}) 100%, 0 100%)`

export function OptionBar({ option, index, state, disabled, showThumb, onPick }: Props) {
  // 没有归属组合的曲目（角色单曲等）也得有一枚看得见的色帽 ——
  // 用浅紫 primary-lt 在白底上几乎消失，形状语言当场断掉
  const unit = option.unitColor ?? 'var(--color-primary)'
  const gray = state === 'dimmed'

  const fill =
    state === 'correct'
      ? 'rgb(10 107 80 / .12)'
      : state === 'wrong'
        ? 'rgb(179 18 58 / .12)'
        : // 白底上单靠 opacity 压不下去（白压白还是白），要把面本身变透
          gray
          ? 'rgb(255 255 255 / .34)'
          : 'var(--color-surface-lit)'

  const edge =
    state === 'correct'
      ? 'inset 0 0 0 2px var(--color-correct)'
      : state === 'wrong'
        ? 'inset 0 0 0 2px var(--color-wrong)'
        : 'none'

  return (
    <div
      className={[
        'anim-appear flex items-stretch',
        state === 'wrong' ? 'anim-shudder' : '',
        gray ? 'opacity-70' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      {/* 组合色帽 —— 形状即标识。颜色不进文字，只做这一枚斜片 */}
      <span aria-hidden className="cut-shadow-sm shrink-0" style={{ width: 'calc(60 * var(--u))' }}>
        <span
          className="block h-full"
          style={{
            background: unit,
            clipPath: CAP_CLIP,
            // 浅色组合（イルミネ的 #fff68d）在白底上会消失，补一圈极淡内描边保底
            boxShadow: 'inset 0 0 0 1px rgb(0 0 0 / .1)',
            filter: gray ? 'grayscale(1)' : undefined,
          }}
        />
      </span>

      {/* 条本体。往左压 40u，让斜边与色帽之间留一条窄缝 */}
      <span
        className="cut-shadow min-w-0 flex-1"
        style={{ marginLeft: 'calc(-40 * var(--u))' }}
      >
        <button
          type="button"
          onClick={onPick}
          disabled={disabled}
          aria-label={`选项 ${index + 1}：${option.title}，${option.artist}`}
          className="sc-bar flex w-full items-center gap-3 pr-6 text-left transition-transform duration-300 ease-[var(--ease-prism)] enabled:hover:-translate-y-px enabled:active:translate-y-0 sm:gap-4 sm:pr-7"
          style={{
            clipPath: BAR_CLIP,
            background: fill,
            boxShadow: edge,
            backdropFilter: 'blur(calc(8 * var(--u)))',
            paddingLeft: 'calc(60 * var(--u))',
          }}
        >
          {showThumb ? (
            <img
              src={`/thumb/${option.id}.webp`}
              alt=""
              loading="eager"
              className="cut-hex shrink-0"
              style={{
                width: 'calc(58 * var(--u))',
                height: 'calc(58 * var(--u))',
                objectFit: 'cover',
                filter: gray ? 'grayscale(1)' : undefined,
              }}
            />
          ) : (
            <span
              aria-hidden
              // 1–4 是键盘映射唯一的视觉锚点，不能用 primary-lt（对白底 2.31:1）
              className="latin sc-title shrink-0 font-semibold text-primary"
              style={{ lineHeight: 1 }}
            >
              {KEYS[index]}
            </span>
          )}

          <span className="min-w-0 flex-1">
            <span
              // line-clamp-2 靠 display:-webkit-box 生效，和 block 是同一条属性；
              // 两个都写会被 block 覆盖掉，长曲名就会顶到三行、把条撑破一屏
              className={`sc-song jp-wrap line-clamp-2 font-bold ${gray ? 'text-ink-faint' : 'text-ink'}`}
              style={{ lineHeight: 1.22 }}
            >
              {option.title}
            </span>
            <span
              className="jp-wrap mt-0.5 block truncate text-ink-faint"
              style={{ fontSize: 'calc(14.5 * var(--u))' }}
            >
              {option.artist}
            </span>
          </span>

          {state === 'correct' && (
            <span className="shrink-0 text-correct" role="img" aria-label="正确答案">
              <Icon name="check" size="calc(26 * var(--u))" />
            </span>
          )}
          {state === 'wrong' && (
            <span className="shrink-0 text-wrong" role="img" aria-label="你选的，答错了">
              <Icon name="cross" size="calc(26 * var(--u))" />
            </span>
          )}
        </button>
      </span>
    </div>
  )
}
