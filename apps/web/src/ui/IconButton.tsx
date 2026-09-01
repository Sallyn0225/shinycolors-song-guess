import { sfx } from '../sfx'

import { Cut } from './Cut'
import { Icon, type IconName } from './Icon'

/**
 * 只有图标的方形按钮。首页光带上方那一排就是它。
 *
 * 三种用法：
 *  - 传了 `pressed` → 这是个**开关**，渲染 `aria-pressed`，关态换一档更淡的墨色
 *  - 传了 `href`   → 渲染成**链接**（新标签打开），读屏播报「链接」而不是「按钮」
 *  - 都不传        → 普通动作按钮
 *
 * 加新按钮就是在 `ToolRail` 里多放一个，不需要改这里。图标一律走 `ui/Icon`
 * 那套手绘 SVG（24 网格、1.8 描边、**方头方角**）。
 * 别从 Lucide / Font Awesome 直接引：那两套都是圆头圆角，跟这个零圆角的世界对不上，
 * 一屏里出现两种笔法比少一个图标难看得多。要新形状就照 24 网格重画一枚进 `Icon`。
 *
 * 套 `Cut` 是必须的：`clip-path` 会把被裁元素上的 `outline` 一起裁掉，
 * 焦点环得由外层的 `:has(:focus-visible)` 代画（见 index.css）。
 */

interface BaseProps {
  icon: IconName
  /** 无障碍名称。图标按钮没有可见文字，缺了它读屏软件只会念「按钮」 */
  label: string
  /** 开关态。传了才渲染 aria-pressed */
  pressed?: boolean
}

/*
  判别联合：按钮用法必传 onClick，纯外链可以不传。
  不设防的话，忘传 onClick 的「按钮」编译照过 —— 点了响一声 click 却什么也不做，
  听觉反馈反而把空操作藏住了。链接分支不给 pressed 出头：链接上没有开关态。
*/
type Props =
  | (BaseProps & {
      /** 链接地址。渲染成 <a>：语义是链接，读屏不念「按钮」念「链接」 */
      href: string
      /** 纯外链不需要回调，原生跳转就够了 */
      onClick?: () => void
    })
  | (BaseProps & {
      href?: undefined
      onClick: () => void
    })

/** 触摸热区下限是**真 px**：--u 触到低钳位时 46u 只有 36px */
const SIZE = 'max(44px, calc(46 * var(--u)))'

export function IconButton({ icon, label, href, onClick, pressed }: Props) {
  // 链接没有「关态」—— pressed 与 href 同时传时按链接处理，视觉与 ARIA 都不认开关
  const off = href === undefined && pressed === false

  /*
    click 音在组件内部前置，与 Button 同一条规矩：反馈要全站一致，
    散进调用点迟早漏一处。开关切换的听觉证据是这一声 click 本身——
    「关掉音效」也照常响一声，那是手指落下的确认，不是音效开关管辖的对象。
    链接用法同样前置 —— 反馈属于「按下」这一刻，不等新标签页开出来。
  */
  const handleClick = () => {
    sfx.play('click')
    onClick?.()
  }

  // button 与 a 两种元素共用的一套内层款式：铺满热区、悬停上浮一格
  const inner =
    'relative flex h-full w-full items-center justify-center transition-[color,transform] duration-300 ease-[var(--ease-prism)] hover:-translate-y-px active:translate-y-0'

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
      {href === undefined ? (
        <button
          type="button"
          onClick={handleClick}
          aria-label={label}
          {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
          /*
            状态不能只靠颜色——图标本身也换（music / music-off），
            那道贯穿斜杠才是关态的证据。颜色只是第二重线索。
          */
          className={`${inner} ${off ? 'text-ink-faint' : 'text-primary'}`}
        >
          <Icon name={icon} size="calc(21 * var(--u))" />
        </button>
      ) : (
        /*
          链接用法目前只有外链一种（GitHub 入口），target / rel 就地钉死：
          新标签打开 + noopener。不做成 props —— 将来真有内链需求再升级。
          aria-pressed 挂在链接上是无效 ARIA，不渲染。
        */
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleClick}
          aria-label={label}
          className={`${inner} text-primary`}
        >
          <Icon name={icon} size="calc(21 * var(--u))" />
        </a>
      )}
    </Cut>
  )
}

/**
 * 光带上方那一排。BGM、音效两个开关和信息、GitHub 两个入口都在这里，
 * 留成一行是因为**这里还会长**。
 * 加按钮直接往 children 里塞 `IconButton`，间距和居中都已经在这一层管好了。
 */
export function ToolRail({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center" style={{ gap: 'calc(10 * var(--u))' }}>
      {children}
    </div>
  )
}
