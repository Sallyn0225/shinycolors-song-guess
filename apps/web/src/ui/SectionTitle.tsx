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

export type Corner = 'tl' | 'tr' | 'bl' | 'br'

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

/**
 * 一枚角标：实心深紫直角三角 + 一条平行的浅紫窄带。
 *
 * 导出是给 `screens/Splash.tsx` 用的 —— 开场把这个装置从「框住一个标题」放大到
 * 「框住整块开场内容」。构造只此一份，两处共用，形状语言才不会分家。
 * 用它的容器要自己是 `position: relative`。
 */
export function CornerMark({ at, size }: { at: Corner; size: number }) {
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

/** 四枚角标 + 那个带内边距的框。SectionTitle 与 HeroTitle 共用，角标构造只此一份 */
function TitleBox({ size, children }: { size: number; children: React.ReactNode }) {
  return (
    <div
      className="sc-titlebox relative inline-block text-center"
      style={{ ['--tc' as string]: `calc(${size} * var(--u))` }}
    >
      <CornerMark at="tl" size={size} />
      <CornerMark at="tr" size={size} />
      <CornerMark at="bl" size={size} />
      <CornerMark at="br" size={size} />
      {children}
    </div>
  )
}

export function SectionTitle({ kana, latin, align = 'left', size = 'md', className = '' }: Props) {
  const c = CORNER[size]
  return (
    <div className={`${align === 'center' ? 'flex justify-center' : ''} ${className}`.trim()}>
      <TitleBox size={c}>
        {/*
          lang="ja"：<html lang="zh-CN"> 之下，读屏软件会拿普通话读音去念这些片假名
          （リスニング / アンサー / リザルト / ルーム），出来的是噪声。
          WCAG 3.1.2 Language of Parts 要的就是这一句 —— 而这套设计的品牌约束
          正是「中文正文 + 日文术语」，日文的量不小，不标就等于把最有辨识度的
          那一半对读屏用户毁掉。这个 prop 按定义就是片假名，所以标在组件里。
        */}
        <p
          lang="ja"
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
      </TitleBox>
    </div>
  )
}

/*
  Hero 变体。层级与 SectionTitle 正好相反，这是有意的：

  SectionTitle 是**区块**标题，按官网的 Kana-Over-Latin 规则，拉丁大写是主角、
  片假名是它的小标。Hero 是**页面**标题，它要回答的是「这个站是干什么的」——
  拉丁串答不了这件事（SONG GUESS 既不说闪耀色彩也不说无人声），
  所以拉丁降为品牌标压在上排，中文主标题成为下排的主角，也是全页唯一的 h1。

  两者共用同一套角标，形状语言不分家。
*/
interface HeroProps {
  /** 上排小号 Jost 大写拉丁：品牌标，不是标题层级 */
  brand: string
  /**
   * 下排大号中文：页面唯一的 h1。
   *
   * 收 ReactNode 而不是 string，是为了让含日文术语的标题能把那一段包成
   * `<span lang="ja">`（大厅的「1v1 空札領地戦」）—— 整串标 lang 是错的，
   * 前半截是数字与中文。传纯字符串照旧可用。
   */
  title: React.ReactNode
  className?: string
}

export function HeroTitle({ brand, title, className = '' }: HeroProps) {
  const c = CORNER.lg
  return (
    <div className={`flex justify-center ${className}`.trim()}>
      <TitleBox size={c}>
        <p
          className="font-latin text-2xs font-semibold text-primary uppercase"
          style={{ letterSpacing: 'var(--tracking-title)' }}
        >
          {brand}
        </p>
        {/* text-ink 而不是 text-primary：#615f90 是结构色，DESIGN.md 明写不作正文，
            而页面主标题要按正文的对比度对待 */}
        <h1
          className="sc-title-lg jp-wrap mt-2 font-bold text-ink"
          style={{ letterSpacing: 'var(--tracking-tight)' }}
        >
          {title}
        </h1>
      </TitleBox>
    </div>
  )
}
