import { Cut } from './Cut'
import { Icon, type IconName } from './Icon'

/**
 * 只有图标的方形按钮。首页光带上方那一排就是它。
 *
 * 两种用法由 `pressed` 决定：
 *  - 传了 → 这是个**开关**，渲染 `aria-pressed`，关态换一档更淡的墨色
 *  - 不传 → 普通动作按钮
 *
 * 加新按钮就是在 `ToolRail` 里多放一个，不需要改这里。图标一律走 `ui/Icon`
 * 那套手绘 SVG（24 网格、1.8 描边、**方头方角**）。
 * 别从 Lucide / Font Awesome 直接引：那两套都是圆头圆角，跟这个零圆角的世界对不上，
 * 一屏里出现两种笔法比少一个图标难看得多。要新形状就照 24 网格重画一枚进 `Icon`。
 *
 * 套 `Cut` 是必须的：`clip-path` 会把被裁元素上的 `outline` 一起裁掉，
 * 焦点环得由外层的 `:has(:focus-visible)` 代画（见 index.css）。
 */

interface Props {
  icon: IconName
  /** 无障碍名称。图标按钮没有可见文字，缺了它读屏软件只会念「按钮」 */
  label: string
  onClick: () => void
  /** 开关态。传了才渲染 aria-pressed */
  pressed?: boolean
}

/** 触摸热区下限是**真 px**：--u 触到低钳位时 46u 只有 36px */
const SIZE = 'max(44px, calc(46 * var(--u)))'

export function IconButton({ icon, label, onClick, pressed }: Props) {
  const off = pressed === false

  return (
    <Cut
      shape="slant"
      elevation="sm"
      /*
        关态换的是**底**，不是整块的 opacity。压 opacity 会把图标一起拖下去：
        实测 `ink-faint` 乘 0.72 之后对白底只剩 2.84:1，而图标是非文字图形，
        这条线是 3:1（SC 1.4.11）。改成 surface(0.62) ↔ surface-lit(0.88)
        两档底色，图标各自保持满不透明，两态都稳过线。
      */
      className={`relative flex items-center justify-center ${off ? 'glass' : 'glass-lit'}`}
      style={{ width: SIZE, height: SIZE }}
    >
      {/*
        斜切元素上的 `inset box-shadow` 描的仍是**矩形**的边，会被裁成对不上形状的三段
        （index.css 坑三）。描边得用 .cut-ring 那套「外轮廓 + 反向内轮廓 evenodd 挖空」。
        颜色用 primary 不用 primary-lt：轮廓是非文字对比度，要 3:1，
        而 primary-lt 只有 2.31:1。
      */}
      <span
        aria-hidden
        className="cut-ring cut-ring-slant"
        style={{
          ['--ring' as string]: '1.5px',
          ['--ring-color' as string]: 'var(--color-primary)',
          opacity: off ? 0.55 : 1,
        }}
      />
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
        /*
          状态不能只靠颜色——图标本身也换（music / music-off），
          那道贯穿斜杠才是关态的证据。颜色只是第二重线索。
        */
        className={`relative flex h-full w-full items-center justify-center transition-[color,transform] duration-300 ease-[var(--ease-prism)] hover:-translate-y-px active:translate-y-0 ${
          off ? 'text-ink-faint' : 'text-primary'
        }`}
      >
        <Icon name={icon} size="calc(21 * var(--u))" />
      </button>
    </Cut>
  )
}

/**
 * 光带上方那一排。现在只有一个 BGM 开关，留成一行是因为**这里还会长**。
 * 加按钮直接往 children 里塞 `IconButton`，间距和居中都已经在这一层管好了。
 */
export function ToolRail({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center" style={{ gap: 'calc(10 * var(--u))' }}>
      {children}
    </div>
  )
}
