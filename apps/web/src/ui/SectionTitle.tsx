/**
 * 官网的区块标题：小号片假名压在 Jost 大写拉丁之上，**四个角**各有一枚角标把整块框起来。
 *
 * 角标的构造在 design-extract-output/screenshots/full-page.png 的 INTRODUCTION 处放大量过：
 *   · 贴着角的是一枚**实心深紫直角三角**（两条直角边贴住框的两条边，斜边 45°）
 *   · 隔一道白缝，外侧是一条**与斜边平行的浅紫窄带**（等宽平行四边形，比三角更长）
 *   · 四枚互为镜像；角标边长约等于拉丁字号的 0.85 倍，离字很远
 *
 * 不是细线条，也不是贴着字的大括号 —— 这两种都试错过。
 *
 * （通用的 craft 规则不喜欢标题上方的小标签，但这套世界是用户钉死的品牌语言，
 *   这对标题正是它最好认的特征之一 —— 以 brief 为准。
 *   官网的拉丁标题本身还带一道竖直渐变，这里没照搬：渐变下缘会把对比度拉到不达标。）
 */

interface Props {
  /** 上排小号片假名 */
  kana: string
  /** 下排 Jost 大写拉丁 */
  latin: string
  align?: 'left' | 'center'
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const LATIN_SIZE = { sm: 'sc-title-sm', md: 'sc-title', lg: 'sc-title-lg' } as const
/** 角标边长（设计 px），约为拉丁字号的 0.85 倍 */
const CORNER = { sm: 16, md: 24, lg: 30 } as const

type Corner = 'tl' | 'tr' | 'bl' | 'br'

const FLIP: Record<Corner, string | undefined> = {
  tl: undefined,
  tr: 'scaleX(-1)',
  bl: 'scaleY(-1)',
  br: 'scale(-1, -1)',
}

const POS: Record<Corner, React.CSSProperties> = {
  tl: { top: 0, left: 0 },
  tr: { top: 0, right: 0 },
  bl: { bottom: 0, left: 0 },
  br: { bottom: 0, right: 0 },
}

/** 一枚角标：实心深紫直角三角 + 一条平行的浅紫窄带 */
function CornerMark({ at, size }: { at: Corner; size: number }) {
  return (
    <svg
      aria-hidden
      focusable="false"
      viewBox="0 0 40 40"
      width={`calc(${size} * var(--u))`}
      height={`calc(${size} * var(--u))`}
      style={{ position: 'absolute', ...POS[at], transform: FLIP[at] }}
    >
      <path d="M0 0 L23 0 L0 23 Z" fill="var(--color-primary)" />
      <path d="M29 0 L36 0 L0 36 L0 29 Z" fill="var(--color-primary-lt)" />
    </svg>
  )
}

export function SectionTitle({ kana, latin, align = 'left', size = 'md', className = '' }: Props) {
  const c = CORNER[size]
  return (
    <div className={`${align === 'center' ? 'flex justify-center' : ''} ${className}`.trim()}>
      <div
        className="sc-titlebox relative inline-block text-center"
        style={{ ['--tc' as string]: `calc(${c} * var(--u))` }}
      >
        <CornerMark at="tl" size={c} />
        <CornerMark at="tr" size={c} />
        <CornerMark at="bl" size={c} />
        <CornerMark at="br" size={c} />

        <p
          className="text-2xs font-semibold text-primary"
          style={{ letterSpacing: 'var(--tracking-title)' }}
        >
          {kana}
        </p>
        <h1
          className={`mt-1 font-latin font-bold text-primary uppercase ${LATIN_SIZE[size]}`}
          style={{ letterSpacing: 'var(--tracking-wide)' }}
        >
          {latin}
        </h1>
      </div>
    </div>
  )
}
