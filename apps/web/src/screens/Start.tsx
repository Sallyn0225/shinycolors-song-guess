import { useState } from 'react'

import { DIFFICULTY_PRESETS, DIFFICULTIES, type Difficulty } from '@scg/shared'

import { ambience } from '../ambience'
import { sfx } from '../sfx'
import { HeroTitle } from '../ui/SectionTitle'
import { Icon } from '../ui/Icon'
import { IconButton, ToolRail } from '../ui/IconButton'
import { LIBRARY } from '../features/library'
import { PrismRail } from '../ui/PrismRail'
import { saveAudioPrefs } from '../prefs'
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
  // 自绘 button 不经过 ui/Button，click 音得在这里补一声 —— 与 Button 内部那条同款
  const click = () => {
    sfx.play('click')
    onClick()
  }
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
          onClick={click}
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
  // 初值取自引擎而不是 localStorage：main.tsx 在任何界面挂载之前就把偏好灌进去了，
  // 这里只负责往回写。与音量滑杆同一条规矩
  const [bgmOn, setBgmOn] = useState(() => ambience.bgmEnabled)
  const [sfxOn, setSfxOn] = useState(() => sfx.sfxOn)

  const toggleBgm = () => {
    const next = !bgmOn
    setBgmOn(next)
    ambience.setBgmOn(next)
    // 只写 bgmOn 这一个字段 —— 整份覆盖会把音量滑杆刚存的值抹掉
    saveAudioPrefs({ bgmOn: next })
  }

  const toggleSfx = () => {
    const next = !sfxOn
    setSfxOn(next)
    sfx.setSfxOn(next)
    // 同上，只写自己那一个字段
    saveAudioPrefs({ sfxOn: next })
  }

  return (
    <main
      /*
        纵向节奏交给 py 与下面的组间距，桌面各降一档（见 sm: 前缀）。
        收紧之后桌面四档视口都装得下，所以 .sc-vfit 把内容垂直居中；
        窄屏内容仍比视口高（375×667 实测 doc 1175 > vp 667），那里它退回顶端对齐。

        **桌面这一档的余量已经用完了。** 加光带上方那排工具按钮之前实测
        1366×678 上 doc 674.6 / vp 678，只剩 3.4px。那 44px 一行是靠
        py 降一档 + section 与音量组的 mt 各降一档换来的，加完之后四档实测：

          1366×678  doc 694 / vp 678  —— 溢出 16px，这一档需要滚一点
          1440×810  装下
          1536×774  装下
          1920×990  装下

        没有为最后这 16px 继续压：再压就得把 py 收到贴边或者动标题组的间距，
        代价是整页处处紧绷，而首页滚动不影响任何功能 ——
        「必须一屏装下」是牌场那条规矩（The Both-Territories Rule），不是这里的。
        `.sc-vfit` 的 safe center 本来就管着内容比视口高的情况。

        再往这一页加独占一行的东西，先把这四档量一遍，别指望还有富余。
      */
      className="sc-vfit mx-auto flex min-h-dvh w-full flex-col px-6 py-14 sm:px-10 sm:py-6"
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

      {/*
        光带上方那一排。**这里还会长** —— 以后要加的图标按钮都往 ToolRail 里塞，
        居中和间距已经在那一层管好了，这里不用再动。

        位置在光带正上方而不是跟音量控件挤在页尾：那一组是「开局前的设定」，
        而 BGM 此刻**正在响**，关它是一个当下就有反馈的动作，得放在够得着的地方。
      */}
      <div className="anim-appear mt-10 sm:mt-3" style={{ animationDelay: '60ms' }}>
        <ToolRail>
          <IconButton
            icon={bgmOn ? 'music' : 'music-off'}
            label={bgmOn ? '关闭背景音乐' : '打开背景音乐'}
            pressed={bgmOn}
            onClick={toggleBgm}
          />
          {/*
            图标用 volume/mute 而不是新画一枚：music 那对已被 BGM 占用，
            喇叭是「UI 音效」的天然字形，且 volume→mute 正好符合
            「关态换字形不只换颜色」的既有约定。
            与页尾音量组的静音钮撞字形是接受的代价 —— 那边是 tap-line 小按钮、
            这边是带 aria-pressed 的开关，位置与读屏名称都分得开。
          */}
          <IconButton
            icon={sfxOn ? 'volume' : 'mute'}
            label={sfxOn ? '关闭音效' : '打开音效'}
            pressed={sfxOn}
            onClick={toggleSfx}
          />
        </ToolRail>
      </div>

      {/* 紧贴工具条：那一排按钮与这条光是同一组，间距要小于它与上方标题的距离 */}
      <div className="anim-appear mt-6 sm:mt-2" style={{ animationDelay: '80ms' }}>
        <PrismRail mode="idle" spectrum={false} />
      </div>

      {/* 组二「怎么开始」。这一页的动作集只有这三条 */}
      <section
        className="mt-12 flex flex-col sm:mt-6"
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
      <div className="anim-appear mt-14 sm:mt-6" style={{ animationDelay: '340ms' }}>
        <VolumeControl />
        <p className="jp-wrap mt-5 text-xs text-ink-faint sm:mt-3" style={{ maxWidth: '60ch' }}>
          点击难度即开始 —— 浏览器需要一次点击才允许播放音频。建议戴耳机；蓝牙耳机会有约 0.2
          秒延迟。松开音量滑块会试听一声，设定记在这台设备上。
        </p>
      </div>
    </main>
  )
}
