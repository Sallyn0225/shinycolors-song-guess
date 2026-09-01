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
  // 没有归属组合的曲目（角色单曲、shuffle unit）也得有一枚看得见的色帽 ——
  // 用浅紫 primary-lt 在白底上几乎消失，形状语言当场断掉。
  // 换成棱镜纹理而不是任何单色：它得读作「没有归属」，不能像是第 9 个组合色。
  const unit = option.unitColor ?? 'var(--grad-unit-prism)'
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
            boxShadow: 'var(--ring-hairline)',
            /*
              落选项不能用 grayscale：藏青、深红这些会被洗成近黑的重条，
              视觉重量反而压过正确答案那一条 —— 和牌场里敵陣抢过自陣是同一个病。
              要退到后景就得真的变淡。
            */
            opacity: gray ? 0.3 : 1,
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
          /*
            这里原来挂着 aria-label={`选项 N：曲名，演唱者`}。两个问题：

            ① 按钮上的 aria-label **覆盖**全部后代内容，所以下面那两枚
               role="img" 的「正确答案」/「你选的，答错了」读屏根本听不到 ——
               揭晓时逐条的正误状态对读屏用户等于不存在。
            ② 曲名是日文，被裹在一句中文 label 里就没法单独标 lang，
               读屏会按普通话读音去念（WCAG 3.1.2）。

            改成由内容组成可访问名：序号用 sr-only 补，曲名/演唱者各自带 lang="ja"，
            正误标记也回到名字里。念出来是「选项 1 曲名 演唱者 正确答案」。
          */
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
                opacity: gray ? 0.55 : 1,
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
            {/* 视觉上序号是左边那个大数字（aria-hidden），揭晓后换成缩略图 ——
                两种情况下读屏都拿不到序号，而键盘映射 1–4 全靠它，所以补一条 sr-only */}
            <span className="sr-only">选项 {index + 1}</span>
            <span
              lang="ja"
              // line-clamp-2 靠 display:-webkit-box 生效，和 block 是同一条属性；
              // 两个都写会被 block 覆盖掉，长曲名就会顶到三行、把条撑破一屏
              className={`sc-song jp-wrap line-clamp-2 font-bold ${gray ? 'text-ink-faint' : 'text-ink'}`}
              style={{ lineHeight: 1.22 }}
            >
              {option.title}
            </span>
            <span
              lang="ja"
              className="jp-wrap mt-0.5 block truncate text-ink-faint"
              // 行高要钉死：两行曲名 + 这一行是移动端 .sc-bar 78u 保底的全部内容，
              // 继承值一变，内容高就会越过保底、条重新变高
              //
              // 12px 地板不是可选项：index.css 里 --text-sm 补地板那段注释写着
              // 「sm 承的是**演唱者**、说明、难度介绍这些正文」，而这一行正是演唱者，
              // 却因为要跟条的定高一起算而绕开了 --text-sm。实测 1366×678
              // （--u 触底 0.78）渲染成 11.31px，掉在自家 12px 正文下限之下。
              // 保留 14.5 这个倍数（换成 --text-sm 的 13u 会缩小窄屏字号并推翻
              // 78u 保底的那套算式），只在低钳位托底：
              // 内容高从 92u 升到 93.4u，桌面 96u 的定高仍然包得住。
              style={{ fontSize: 'max(12px, calc(14.5 * var(--u)))', lineHeight: 1.5 }}
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
