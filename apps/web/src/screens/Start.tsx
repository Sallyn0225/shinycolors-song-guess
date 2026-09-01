import { useCallback, useState } from 'react'

import { DIFFICULTY_PRESETS, DIFFICULTIES, type Difficulty } from '@scg/shared'

import { ambience } from '../ambience'
import { sfx } from '../sfx'
import { HeroTitle } from '../ui/SectionTitle'
import { Icon } from '../ui/Icon'
import { IconButton, ToolRail } from '../ui/IconButton'
import { LIBRARY } from '../features/library'
import { Footer } from '../components/Footer'
import { InfoModal } from '../components/InfoModal'
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
  easy: '伴奏片段较长，选项差别明显，适合熟悉曲库。',
  hard: '伴奏更短、限时更紧，选项多为同组合或相近曲名，极具挑战。',
}

const KANA: Record<Difficulty, string> = { easy: 'イージー', hard: 'ハード' }

/*
  斜切量按断点换档，值在 index.css 的 .sc-entrybar 上（窄屏 46u → 31u）。
  不能写死：它同时是色帽的宽度位移，帽宽收窄后写死的 46u 会大于帽子本身，
  平行四边形退化成一根斜针。见 .sc-entrybar 那段注释。
*/
const SLANT = 'var(--entry-slant)'
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
    <div className="sc-entrybar anim-appear flex items-stretch" style={{ animationDelay: `${delay}ms` }}>
      {/* 帽宽 / 按钮左内边距 / 负外边距是一组联动值，都在 .sc-entrybar-* 里，
          因为它们要按断点换档 —— 行内 style 没有断点 */}
      <span aria-hidden className="sc-entrybar-cap cut-shadow-sm shrink-0">
        <span
          className="block h-full"
          style={{ background: cap, clipPath: CAP_CLIP, boxShadow: 'var(--ring-hairline)' }}
        />
      </span>
      <span className="sc-entrybar-slot cut-shadow min-w-0 flex-1">
        <button
          type="button"
          onClick={click}
          disabled={disabled}
          className="sc-entrybar-btn flex w-full flex-col items-start gap-2 py-4 pr-6 text-left transition-transform duration-300 ease-[var(--ease-prism)] enabled:hover:-translate-y-px enabled:active:translate-y-0 disabled:opacity-45 sm:flex-row sm:items-center sm:gap-6 sm:py-2 sm:pr-8"
          style={{
            clipPath: BAR_CLIP,
            background: solid ? 'var(--grad-brand-ink)' : 'var(--color-surface-lit)',
            backdropFilter: solid ? undefined : 'blur(calc(8 * var(--u)))',
            minHeight: 'max(72px, calc(100 * var(--u)))',
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
  const [infoOpen, setInfoOpen] = useState(false)

  // 给 InfoModal 的 Esc 监听传稳定引用 —— 不然 Start 每次渲染它都重挂一次 window 监听
  const closeInfo = useCallback(() => setInfoOpen(false), [])

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

        **窄屏那一档单独有一笔账。** 桌面的 sm: 值一个没动，动的全是窄屏的基值：
        py-14→py-7、说明 mt-6→mt-4、曲库数据 mt-7→mt-5、工具排 mt-10→mt-5、
        光带 mt-6→mt-4、入口组 mt-12→mt-7、入口间距 18u→12u（改走 .sc-entrylist）。
        390x844 实测这一串把入口组的起点从 443 提到 348。

        目的不是「首页也要一屏装下」—— 那仍然是牌场的规矩，不是这里的。
        目的是第三条入口「1v1 空札領地戦」原本顶边落在 836、只露 8px：
        掏手机的人在首屏上看不到这个产品的一半。见 index.css 的 .sc-metaline。
      */
      className="sc-vfit mx-auto flex min-h-safe w-full flex-col px-6 py-7 sm:px-10 sm:py-6"
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
          className="jp-wrap mx-auto mt-4 text-base leading-relaxed text-ink-sub sm:mt-4"
          style={{ maxWidth: '46ch' }}
        >
          听纯伴奏片段，猜出对应的闪耀色彩歌曲。
        </p>
        {/* 三个聚合量。「人声 0」是这一组里唯一的卖点 ——
            它把「难度来源从记歌词变成记编曲」压成了一个数字。
            都是总量，不含单曲时长或切片编号，建立不了对照表。 */}
        <dl className="mt-5 flex justify-center gap-10 sm:mt-5 sm:gap-16">
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
      <div className="anim-appear mt-5 sm:mt-3" style={{ animationDelay: '60ms' }}>
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
          {/*
            展示信息：三页弹窗（玩法 / 免责声明 / 致谢）。开合归本页，
            页码是弹窗自己的事，随它一起卸载 —— 每次打开都从第一页开始。
          */}
          <IconButton icon="info" label="游戏信息" onClick={() => setInfoOpen(true)} />
          {/*
            GitHub 入口。走 href 让它渲染成 <a>：读屏播报「GitHub 仓库，链接」
            而不是「按钮」，新标签打开由 IconButton 内部钉死。
          */}
          <IconButton
            icon="github"
            label="GitHub 仓库"
            href="https://github.com/Sallyn0225/shinycolors-song-guess"
          />
        </ToolRail>
      </div>

      {/* 紧贴工具条：那一排按钮与这条光是同一组，间距要小于它与上方标题的距离 */}
      <div className="anim-appear mt-4 sm:mt-2" style={{ animationDelay: '80ms' }}>
        <PrismRail mode="idle" spectrum={false} />
      </div>

      {/* 组二「怎么开始」。这一页的动作集只有这三条 */}
      <section className="sc-entrylist mt-7 flex flex-col sm:mt-6" aria-label="选择难度">
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
                {/* 片假名要标 lang，否则读屏按普通话读音念（见 ui/SectionTitle 的说明） */}
                <span
                  lang="ja"
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
              {/* 这四个数是选难度的唯一依据，窄屏也不能藏 —— 压成基线一行，见 .sc-metaline。
                  gap-6 拿掉了：它在窄屏被 .sc-metaline 的 column-gap 接管，
                  桌面本来就被 sm:gap-7 覆盖，留着只会让层序看不清 */}
              <dl className="sc-metaline flex shrink-0 sm:gap-7">
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
              lang="ja"
              className="block text-2xs font-semibold opacity-80"
              style={{ letterSpacing: 'var(--tracking-title)' }}
            >
              タイセン
            </span>
            <span
              className="sc-title jp-wrap block font-bold"
              style={{ letterSpacing: 'var(--tracking-tight)' }}
            >
              1v1 <span lang="ja">空札領地戦</span>
            </span>
            {/*
              日文术语逐个标 lang —— 整句标是错的，这句的主体是中文。

              原来这里一句话里有四个日文术语（送り札 / お手つき / 空札 / 自陣），
              其中三个没有任何解释，而这是没玩过歌牌的人接触这套玩法的第一句话。
              入口条的活是「这是什么、值不值得点」，不是把规则讲完 ——
              规则在 ⓘ 弹窗和大厅页，两处都补齐了。

              空札 留下并就地释义：它是这个玩法与别处不同的地方（也在模式名里），
              送り札 / お手つき 挪走 —— 它们是玩起来才用得上的机制。
            */}
            <span className="jp-wrap mt-1 block text-sm opacity-95">
              听伴奏抢牌的 1v1 歌牌对决，场上还混有无对应牌的
              <b lang="ja" className="font-bold text-accent-lit">
                空札
              </b>
              {' '}
              陷阱 —— 误触受罚。先清空<span lang="ja">自陣</span>者获胜。
            </span>
          </span>
          {/*
            窄屏不出这枚箭头。桌面它是横条右端的收尾，与文字同一行；
            窄屏 flex-col 下它会自己换到一行、孤零零贴在左缘，与它指向的文字断开，
            而且白占 33px（图标 24u + gap）—— 那正是把 1v1 顶出折线的最后一截。
            整条横条本来就是按钮，箭头在窄屏不承载任何信息。
          */}
          <span aria-hidden className="hidden sm:block">
            <Icon name="next" size="calc(24 * var(--u))" />
          </span>
        </EntryBar>
      </section>

      {error && (
        <p
          role="alert"
          className="cut-slant mt-7 px-5 py-3 text-sm text-wrong"
          style={{ background: 'var(--surface-alert)', boxShadow: 'inset 0 0 0 1px var(--color-wrong)' }}
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
          点击任意模式即可开始。建议佩戴耳机游玩（蓝牙耳机可能存在微小延迟）。设置会自动保存在当前设备中。
        </p>
      </div>

      {/*
        页脚。这是上面那条「加独占一行的东西先量四档」的第一次应用，overflowY 实测：

          1366x678  +16 → +52   这一档本来就要滚，多滚 36px
          1440x810   0  →  0    仍装得下
          1536x774   0  →  0    仍装得下
          1920x990   0  →  0    仍装得下
          375x667  +562 → +654  窄屏本来就滚；这里声明句折成两行，页脚 52px
          390x844  +425 → +519  同上

        只有最紧的一档变差，且它本来就在滚 —— 所以没有为这一行去压 py 或动标题组。
        「必须一屏装下」是牌场那条规矩，不是这里的（见 quality-guidelines.md）。
        桌面这一行是 text-xs 的单行两端对齐，已经是能给到的最矮形态。

        另：量到的 minTap 从 44 掉到 18，是页脚那个 @SallynP 链接。**这是刻意的** ——
        它内联在一句话里，正好落在 WCAG 2.5.8 的 inline 例外（尺寸由非目标文字的
        行高决定）；给它套 .tap-line 会把页脚撑到 44px，把上面三档也一起顶出屏幕。
        InfoModal 的致谢链接同款，只是弹窗关着时量不到。
      */}
      <Footer />

      {/* 展示信息弹窗。fixed 定位，挂在文档流哪里都不影响本页布局 */}
      {infoOpen && <InfoModal onClose={closeInfo} />}
    </main>
  )
}
