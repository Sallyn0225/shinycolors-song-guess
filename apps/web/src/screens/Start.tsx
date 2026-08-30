import { DIFFICULTY_PRESETS, DIFFICULTIES, type Difficulty } from '@scg/shared'

import { HeroTitle } from '../ui/SectionTitle'
import { Icon } from '../ui/Icon'
import { LIBRARY } from '../features/library'
import { PrismRail } from '../ui/PrismRail'
import { Stat } from '../ui/Stat'
import { VolumeControl } from '../ui/VolumeControl'

interface Props {
  onStart: (d: Difficulty) => void
  onVersus: () => void
  busy: boolean
  error: string | null
}

const BLURB: Record<Difficulty, string> = {
  easy: '片段够长，干扰项来自不同组合。适合先摸清曲库。',
  hard: '片段更短、时限更紧，四个选项全是同组合或曲名相近的曲子。',
}

const KANA: Record<Difficulty, string> = { easy: 'イージー', hard: 'ハード' }

const SLANT = 'calc(46 * var(--u))'
const NOTCH = 'calc(40 * var(--u))'
const BAR_CLIP = `polygon(${SLANT} 0, 100% 0, 100% calc(100% - ${NOTCH}), calc(100% - ${NOTCH}) 100%, 0 100%)`
const CAP_CLIP = `polygon(${SLANT} 0, 100% 0, calc(100% - ${SLANT}) 100%, 0 100%)`

/** 与选项条同一套语汇的整宽横条。首页的三个入口都是它 */
function EntryBar({
  cap,
  onClick,
  disabled,
  delay,
  children,
  solid = false,
}: {
  cap: string
  onClick: () => void
  disabled?: boolean
  delay: number
  children: React.ReactNode
  solid?: boolean
}) {
  return (
    <div className="anim-appear flex items-stretch" style={{ animationDelay: `${delay}ms` }}>
      <span aria-hidden className="cut-shadow-sm shrink-0" style={{ width: 'calc(60 * var(--u))' }}>
        <span
          className="block h-full"
          style={{ background: cap, clipPath: CAP_CLIP, boxShadow: 'inset 0 0 0 1px rgb(0 0 0 / .1)' }}
        />
      </span>
      <span className="cut-shadow min-w-0 flex-1" style={{ marginLeft: 'calc(-36 * var(--u))' }}>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          className="flex w-full flex-col items-start gap-3 py-4 pr-6 text-left transition-transform duration-300 ease-[var(--ease-prism)] enabled:hover:-translate-y-px enabled:active:translate-y-0 disabled:opacity-45 sm:flex-row sm:items-center sm:gap-6 sm:py-2 sm:pr-8"
          style={{
            clipPath: BAR_CLIP,
            background: solid ? 'var(--grad-brand-ink)' : 'var(--color-surface-lit)',
            backdropFilter: solid ? undefined : 'blur(calc(8 * var(--u)))',
            minHeight: 'max(72px, calc(100 * var(--u)))',
            paddingLeft: 'calc(60 * var(--u))',
            color: solid ? '#fff' : undefined,
          }}
        >
          {children}
        </button>
      </span>
    </div>
  )
}

export function Start({ onStart, onVersus, busy, error }: Props) {
  return (
    <main
      /*
        纵向节奏交给 py 与下面的组间距，桌面各降一档（见 sm: 前缀）。
        收紧之后桌面四档视口都装得下，所以 .sc-vfit 把内容垂直居中；
        窄屏内容仍比视口高（375×667 实测 doc 1175 > vp 667），那里它退回顶端对齐。
      */
      className="sc-vfit mx-auto flex min-h-dvh w-full flex-col px-6 py-14 sm:px-10 sm:py-8"
      style={{ maxWidth: 'var(--page-main)' }}
    >
      {/*
        组一「这是什么」。标题 + 说明 + 曲库数据是同一件事，靠得紧；
        与下面的入口之间由光带分开 —— 这套系统里那条光本来就是「界线」的承担者，
        所以不加框线也不加分隔线。
      */}
      <header className="anim-appear text-center">
        <HeroTitle brand="Shiny Song Guess" title="闪彩猜歌" />
        <p
          className="jp-wrap mx-auto mt-6 text-base leading-relaxed text-ink-sub sm:mt-4"
          style={{ maxWidth: '46ch' }}
        >
          听一段没有人声的伴奏，认出它是哪首歌。
        </p>
        {/* 三个聚合量。「人声 0」是这一组里唯一的卖点 ——
            它把「难度来源从记歌词变成记编曲」压成了一个数字。
            都是总量，不含单曲时长或切片编号，建立不了对照表。 */}
        <dl className="mt-7 flex justify-center gap-10 sm:mt-5 sm:gap-16">
          <Stat label="曲数" value={LIBRARY.songs} align="center" />
          <Stat label="片段" value={LIBRARY.clips} align="center" />
          <Stat label="人声" value={0} align="center" />
        </dl>
      </header>

      <div className="anim-appear mt-14 sm:mt-7" style={{ animationDelay: '80ms' }}>
        <PrismRail mode="idle" spectrum={false} />
      </div>

      {/* 组二「怎么开始」。这一页的动作集只有这三条 */}
      <section
        className="mt-12 flex flex-col sm:mt-7"
        style={{ gap: 'calc(18 * var(--u))' }}
        aria-label="选择难度"
      >
        {DIFFICULTIES.map((d, i) => {
          const p = DIFFICULTY_PRESETS[d]
          return (
            <EntryBar
              key={d}
              cap={d === 'easy' ? 'var(--color-accent)' : 'var(--color-sub-rose)'}
              onClick={() => onStart(d)}
              disabled={busy}
              delay={140 + i * 90}
            >
              <span className="min-w-0 flex-1">
                <span
                  className="block text-2xs font-semibold text-primary"
                  style={{ letterSpacing: 'var(--tracking-title)' }}
                >
                  {KANA[d]}
                </span>
                <span
                  className="sc-title block font-bold text-ink"
                  style={{ letterSpacing: 'var(--tracking-tight)' }}
                >
                  {p.label}
                </span>
                <span className="jp-wrap mt-1 block text-sm text-ink-sub">{BLURB[d]}</span>
              </span>
              {/* 这四个数是选难度的唯一依据，窄屏也不能藏 —— 改成紧凑一行 */}
              <dl className="flex shrink-0 gap-6 sm:gap-7">
                <Stat label="題数" value={p.questionCount} align="center" size="sm" />
                <Stat label="片段" value={`${p.clipSeconds}s`} align="center" size="sm" />
                <Stat label="限时" value={`${p.answerSeconds}s`} align="center" size="sm" />
                <Stat label="重听" value={p.replays} align="center" size="sm" />
              </dl>
            </EntryBar>
          )
        })}

        <EntryBar cap="var(--color-primary)" onClick={onVersus} delay={320} solid>
          <span className="min-w-0 flex-1">
            <span
              className="block text-2xs font-semibold opacity-80"
              style={{ letterSpacing: 'var(--tracking-title)' }}
            >
              タイセン
            </span>
            <span
              className="sc-title jp-wrap block font-bold"
              style={{ letterSpacing: 'var(--tracking-tight)' }}
            >
              1v1 空札領地戦
            </span>
            <span className="jp-wrap mt-1 block text-sm opacity-95">
              歌牌规则：抢牌、送り札、お手つき，外加只会被播放、场上没有对应牌的
              <b className="font-bold text-accent-lit">空札</b>。先清空自陣者胜。
            </span>
          </span>
          <Icon name="next" size="calc(24 * var(--u))" />
        </EntryBar>
      </section>

      {error && (
        <p
          role="alert"
          className="cut-slant mt-7 px-5 py-3 text-sm text-wrong"
          style={{ background: 'rgb(179 18 58 / .1)', boxShadow: 'inset 0 0 0 1px var(--color-wrong)' }}
        >
          {error}
        </p>
      )}

      {/*
        音量和耳机提示是同一件事的两半，放一组。
        位置在三个入口之后是有意的：这一页的动作集只有那三条，
        音量是**设定**不是入口，不该长成第四条横条去跟它们抢。
      */}
      <div className="anim-appear mt-14 sm:mt-7" style={{ animationDelay: '340ms' }}>
        <VolumeControl />
        <p className="jp-wrap mt-5 text-xs text-ink-faint sm:mt-3" style={{ maxWidth: '60ch' }}>
          点击难度即开始 —— 浏览器需要一次点击才允许播放音频。建议戴耳机；蓝牙耳机会有约 0.2
          秒延迟。松开音量滑块会试听一声，设定记在这台设备上。
        </p>
      </div>
    </main>
  )
}
