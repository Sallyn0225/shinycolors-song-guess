import { useCallback, useEffect, useId, useRef, useState } from 'react'

import { ambience } from '../ambience'
import { audio } from '../audio'
import { greetingFallbackUrl, greetingUrl, idolIconUrl, type Idol } from '../features/idols'
import { pickIdol } from '../features/opening'
import { useCalmed } from '../ui/Backdrop'
import { Cut } from '../ui/Cut'
import { PrismRail } from '../ui/PrismRail'
import { CornerMark } from '../ui/SectionTitle'

/**
 * 开场遮罩。
 *
 * 它承担的不只是「好看」，还有一件功能性的事：**这一屏就是那次用户手势**。
 * 浏览器不给手势就不让 AudioContext 出声（见 audio.ts 开头），
 * 所以问候语音只能在点击之后播 —— 原生手游能在加载完就说话，网页不能。
 * 节奏因此排成：点击 → 解锁 → 问候 → 问候播完 → BGM 渐入 + 遮罩化开。
 *
 * 三个阶段，外加一条降级支线：
 *
 *   intro ──点击/Enter──→ greeting ──语音播完/失败──→ handoff ──→ 卸载
 *     └─ resume 支线：本机还留着座位凭证时直接走 intro → handoff，
 *        **不放语音也不起 BGM** —— 对局在跑，不能拿开场动画拖时间。
 *
 * 视觉上它是**一枚浮在场景里的票券**，而不是一串居中的文字。
 *
 * 这一版之前是后者，读起来平淡到留不下印象，原因不是"效果不够"，而是它悄悄退出了
 * 这个世界最强的三个装置：斜切形状、四角角标、棱镜光带。全站每一屏都在用它们，
 * 只有开场没有。所以这里不发明新东西，只把系统自己的词汇用足：
 *
 *   · 内容装进 `--cut-lg` 双切角的玻璃面（Cut card），不再裸浮在底色上
 *   · 未被切的**右上与左下**两角落一枚角标 —— 切角与角标对角呼应，
 *     两个装置各管两角，不互相覆盖
 *   · 分隔线换成真正的 `PrismRail`，与首页同一个组件：
 *     这套系统里那条光本来就是"界线"的承担者
 *
 * 遮罩自己**不画任何幕**。开场期间 App 不渲染首页（见 App.tsx），背后只剩 Backdrop，
 * 于是票券直接浮在与首页完全相同的场景上 —— 幕布散开后景不变、只是票券化开、内容入场。
 * 文字全部落在票券的 `surface-lit` 上，比首页直接压在乳化白幕上还宽裕。
 */

/**
 * 座位探测结果（`hello{claim:false}` → `seatOffer`）交由本屏呈现的状态。
 * 定义在 Splash 而不是 App，让「怎么呈现」跟「什么时候来」分家。
 */
export type SeatOfferState =
  | { kind: 'ok'; roomCode?: string; opponent?: string; inMatch: boolean }
  | { kind: 'busy' }
  | { kind: 'gone' }

interface Props {
  /**
   * 这次打开是回到一个已经在跑的对局（正在找回，**或已经找回成功**）。走降级支线。
   *
   * 后半句是要点：恢复常常比用户点掉遮罩更快，那时 App 的加载态早就转 false 了，
   * 拿加载态当判据会让这一屏在最不该拖时间的时刻去播完整开场（见 App.tsx 的 `resumePath`）。
   */
  resume: boolean
  /** 新标签页探测的结果。非空时本屏切换成「找回 / 放弃」二选一（或 busy 等待） */
  offer: SeatOfferState | null
  /** 「找回对局」：认领座位，回到断线前的牌面 */
  onClaim: () => void
  /** 「放弃重连」：认领 → leaveRoom（对手收到退出横幅）→ 清凭证 → 落首页 */
  onForfeit: () => void
  onOpened: () => void
}

type Phase = 'intro' | 'greeting' | 'handoff'

/**
 * 各层的入场延迟（ms）。
 *
 * 提示行排在最后，隔了将近半秒才到 —— 先让人把品牌、标题、这是什么看完，
 * 再邀请他动手。反过来（提示先到）会让人在读完之前就点掉。
 */
const ENTER = { logo: 0, rail: 260, title: 420, desc: 540, hint: 900 } as const

/**
 * 点击到语音起播之间的停顿。
 * 没有它，声音会和点击的视觉反馈挤在同一帧上，听起来像是被点出来的音效而不是问候。
 */
const GREET_DELAY_MS = 180

/** 退场动画时长，对齐 index.css 的 `--dur-slow`(0.6s) 再留一点余量 */
const HANDOFF_MS = 640

/** 头像三层同心六边形的边长（真 px）。源图只有 54×54，最内层不得超过 40 —— 放大就糊 */
const ICON = { ring: 44, unit: 40, face: 36 } as const

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * 头像。
 *
 * 组合代表色作缩略图描边，是 DESIGN.md 允许它出现的三种用法之一
 * （另两种是实心色帽与一段边缘），**绝不能拿它写字** —— #fff68d 在白底上会直接消失。
 *
 * 用三层同心六边形而不是 `inset box-shadow`：`clip-path` 裁过的元素上，
 * inset 描边描的仍是**矩形**的边，会被裁成对不上形状的三段（index.css 坑三）。
 * 最外那层 10% 黑正是 DESIGN.md 要求的那道轮廓，浅色组合靠它才读得出来。
 */
function IdolFace({ idol }: { idol: Idol }) {
  const hex = (size: number, style: React.CSSProperties) => ({
    position: 'absolute' as const,
    left: '50%',
    top: '50%',
    width: size,
    height: size,
    marginLeft: -size / 2,
    marginTop: -size / 2,
    ...style,
  })

  return (
    <span
      aria-hidden
      className="relative block shrink-0"
      style={{ width: ICON.ring, height: ICON.ring }}
    >
      <span className="cut-hex" style={hex(ICON.ring, { background: 'rgb(0 0 0 / .10)' })} />
      <span className="cut-hex" style={hex(ICON.unit, { background: idol.unitColor })} />
      <img
        className="cut-hex"
        src={idolIconUrl(idol.id)}
        alt=""
        width={ICON.face}
        height={ICON.face}
        style={hex(ICON.face, { objectFit: 'cover' })}
      />
    </span>
  )
}

export function Splash({ resume, offer, onClaim, onForfeit, onOpened }: Props) {
  const [phase, setPhase] = useState<Phase>('intro')
  const [idol, setIdol] = useState<Idol | null>(null)
  const titleId = useId()
  const hintRef = useRef<HTMLButtonElement>(null)
  const forfeitRef = useRef<HTMLButtonElement>(null)
  /** 点过一次就不再受理。整屏与提示行都能点，冒泡会让同一次点击来两遍 */
  const busy = useRef(false)
  const alive = useRef(true)
  const calmed = useCalmed()

  // 探测有结论（ok / busy）时本屏进入「选择模式」：整屏点击失效，去留只由那两个按钮决定
  const offerMode = offer !== null

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  /*
    遮罩在场时锁住页面滚动。首页在窄屏本来就比视口高（375×667 实测 doc 1175），
    不锁的话开场这一屏右边挂着一条滚动条，滚起来遮罩不动、背后的内容在动。
    存原值再还原，不写死成 `''` —— 那样会顺手清掉别处设的 overflow。
  */
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  /*
    焦点必须关在遮罩里。`aria-modal` 只管读屏软件怎么念，**不影响 Tab 顺序** ——
    不接管的话，一个 Tab 就跳到遮罩背后首页的难度按钮上，键盘用户会对着
    看不见的控件按 Enter，直接开一局。

    遮罩里可聚焦的只有提示那一个按钮，所以陷阱简化成「Tab 一律回到它」。
    **不自动聚焦**：页面刚载入就 focus() 会让 Chrome 判定成键盘操作而画出焦点环，
    鼠标用户一进来就看到一个框着的按钮。让第一次 Tab 把焦点带过去，
    那时画出焦点环才是对的。
  */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return

      if (offerMode && offer) {
        if (offer.kind === 'ok') {
          const primary = hintRef.current
          const secondary = forfeitRef.current
          if (!primary || !secondary) return
          const active = document.activeElement
          e.preventDefault()
          if (e.shiftKey) {
            if (active === secondary) primary.focus()
            else secondary.focus()
          } else {
            if (active === primary) secondary.focus()
            else primary.focus()
          }
          return
        }
        if (offer.kind === 'busy') {
          const secondary = forfeitRef.current
          if (!secondary) return
          e.preventDefault()
          secondary.focus()
          return
        }
      }

      const btn = hintRef.current
      /*
        进入 greeting / handoff 之后提示按钮换成了迎接你的偶像那一行，
        遮罩里于是一个可聚焦元素都没有 —— 这时继续 preventDefault 等于把 Tab
        吞掉，成了一个持续两三秒的键盘陷阱。放行即可：那两个阶段遮罩已经
        不受理任何操作，而它背后的首页此时根本还没渲染（见 App.tsx），
        Tab 出去也碰不到任何控件。
      */
      if (!btn) return
      e.preventDefault()
      btn.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [offerMode, offer])

  const enter = useCallback(() => {
    if (busy.current) return
    // 选择模式下整屏点击不入场 —— 「找回 / 放弃」必须经那两个按钮，误触空白处不能替人做决定
    if (offerMode) return
    busy.current = true

    void (async () => {
      // **必须在这次真实点击的调用栈里**发起解锁。漏了这一步线上第一声全场静音，
      // 而本地热重载的开发页面永远不会复现（audio.ts 开头有同样的告诫）
      try {
        await audio.unlock()
      } catch {
        // 解锁失败就是这台设备今天没有声音，但绝不能因此拦住人进首页
      }

      // 找回对局：对局还在跑，开场动画不能占用它的时间
      if (!resume) {
        const picked = pickIdol(ambience.lastGreeted)
        ambience.rememberGreeted(picked.id)
        if (!alive.current) return
        setIdol(picked)
        setPhase('greeting')

        await sleep(GREET_DELAY_MS)
        // 失败会静默 resolve —— 开场不因为一段问候放不出来就卡住
        await ambience.playGreeting(greetingUrl(picked.id), greetingFallbackUrl(picked.id))
        if (!alive.current) return

        // 问候的尾音散尽才轮到 BGM。setEnabled 是幂等的，页面加载时 App 已经调过一次，
        // 那次因为 AudioContext 还锁着而空手而归，这次才真正把它带起来
        ambience.setEnabled(true)
      }

      setPhase('handoff')
      // 不挂 animationend：prefers-reduced-motion 下退场动画被整个关掉，
      // 那个事件永远不会来，遮罩会永远留在屏幕上
      await sleep(calmed ? 0 : HANDOFF_MS)
      if (alive.current) onOpened()
    })()
  }, [resume, calmed, onOpened, offerMode])

  /**
   * 「找回对局」。这次点击同样是解锁 AudioContext 的那次手势 —— 之后断线遮罩、
   * 牌场音效全靠它。随后走既有认领路径（hello{claim:true}），跳过问候与 BGM，
   * 与同标签页刷新的 resume 支线同一待遇。
   */
  const claim = useCallback(() => {
    if (busy.current) return
    busy.current = true
    void (async () => {
      try {
        await audio.unlock()
      } catch {
        /* 没声音也照样回牌场 */
      }
      onClaim()
      setPhase('handoff')
      await sleep(calmed ? 0 : HANDOFF_MS)
      if (alive.current) onOpened()
    })()
  }, [calmed, onClaim, onOpened])

  /** 「放弃重连」。落点（首页）与遮罩关闭都由 App 处理 —— 它知道该渲染什么 */
  const forfeit = useCallback(() => {
    onForfeit()
  }, [onForfeit])

  const hint = resume ? '点击继续对局' : '点击任意处进入游戏'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={enter}
      className={`fixed inset-0 flex items-center justify-center px-7 ${
        phase === 'handoff' ? 'anim-dissolve' : ''
      }`}
      /*
        一道很淡的幕。开场不渲染首页，背景大片裸露，视频会比在别处显眼得多。

        DESIGN.md 的 Ambient-Veil Rule 写着「读不出是哪一支 MV 才算调对」，
        **开场是这条规则唯一被批准的例外**（产品方明确拍板：入场动画里勉强看得出没关系）。
        所以这里只压 0.20 加一点模糊——够让票券稳稳当主角，又让背景真的活着。
        别照着那条规则把它"修"回去；要改先去问，这不是漏调的档。
      */
      style={{
        zIndex: 60,
        background: 'rgb(247 246 251 / 0.20)',
        backdropFilter: 'blur(calc(4 * var(--u)))',
      }}
    >
      <Cut
        shape="card"
        elevation="lg"
        outerClassName="anim-appear block"
        outerStyle={{
          animationDelay: `${ENTER.logo}ms`,
          width: 'min(calc(660 * var(--u)), 92vw)',
        }}
        className="glass-lit relative text-center"
        /*
          上内边距要比 `--cut-lg`(40u) 大出一截：左上那个切角会把紧贴顶端的内容
          连着吃掉，logo 起点落在 (44,52) 上，离切线 x+y=40 还有富余。
        */
        style={{
          padding: 'calc(44 * var(--u)) calc(44 * var(--u)) calc(40 * var(--u))',
        }}
      >
        {/*
          角标只落**右上与左下**：另外两角已经被 `cut-card` 削掉了，
          角标画上去会悬在被裁掉的空气里。两个装置各管两角，正好对角呼应。
        */}
        <CornerMark at="tr" size={34} />
        <CornerMark at="bl" size={34} />

        {/*
          ① 品牌标。透明底，直接落在玻璃面上 —— 不垫任何底板。
          logo 主体虽是白色填充，但自带一圈完整的深紫描边把它界定住，浅底上读得出来。
          标题那行字已经把这张图说的话讲了一遍，所以它是装饰性的，不进无障碍树。
        */}
        <img
          src="/brand.webp"
          alt=""
          aria-hidden
          width={1200}
          height={470}
          className="block"
          style={{ width: '100%', height: 'auto' }}
        />

        {/*
          ② 棱镜光带，与首页同一个组件。这套系统里那条光本来就是「界线」的承担者，
          所以这里不另画一条渐变细线 —— 换成它，开场才和别处说同一种话。
        */}
        <div className="anim-appear mt-7 sm:mt-6" style={{ animationDelay: `${ENTER.rail}ms` }}>
          <PrismRail mode="idle" spectrum={false} />
        </div>

        {/*
          ③ 标题。**不是 h1** —— 首页的 HeroTitle 才是全页唯一的那个 h1。
          对话框的无障碍名称由 aria-labelledby 指到这里，语义上够用，
          也不必为了一段开场文案去动首页的标题层级。
        */}
        <p
          id={titleId}
          className="sc-title-lg anim-appear jp-wrap mt-7 font-bold text-ink sm:mt-6"
          style={{ animationDelay: `${ENTER.title}ms`, letterSpacing: 'var(--tracking-tight)' }}
        >
          闪彩猜歌
        </p>

        <p
          className="anim-appear jp-wrap mx-auto mt-4 text-base text-ink-sub sm:mt-3"
          style={{ animationDelay: `${ENTER.desc}ms`, maxWidth: '46ch' }}
        >
          听一段伴奏，猜出是哪首闪耀色彩歌曲
        </p>

        {/*
          ④ 提示 / 署名共用同一格。
          定高是为了让两者切换时票券不跳 —— 44px 既是触摸热区的下限，
          也正好是头像那三层同心六边形的外径，两个状态天然等高。
        */}
        <div className="mt-9 flex items-center justify-center sm:mt-8" style={{ minHeight: 44 }}>
          {/*
            探测支线（新标签页持有凭证）：seatOffer 的三种呈现。
            ok —— 上一局信息 + 「找回 / 放弃」二选一；两个按钮落在既有的 Tab 圈闭里
            （hintRef 挂在主按钮上），键盘用户够得到，不重蹈「横幅在圈闭外」的遗留项。
            busy —— 座位仍被占用（半开窗口或另一个标签页开着），不摆「找回」按钮避免抢座，
            显示占用中并等 App 自动重试；同时提供「放弃重连」（退化为本地放弃，prd.md R7）。
            gone —— App 直接清掉 offer（按首次访问处理），根本不会进到这个分支。
          */}
          {offerMode && offer.kind === 'ok' ? (
            <div className="anim-appear flex w-full flex-col items-center gap-2">
              <p className="jp-wrap text-sm text-ink-sub">
                上一局{offer.inMatch ? '还在进行中' : '的房间还在'}
                {offer.opponent ? <span className="text-ink">（对手：{offer.opponent}）</span> : null}
                {offer.roomCode ? <span className="text-ink-faint"> · 房间码 {offer.roomCode}</span> : null}
              </p>
              <div className="mt-1 flex items-center justify-center gap-7">
                {/*
                  不走 ui/Button：焦点陷阱要把 Tab 一律送回主按钮（hintRef），
                  Button（React 18，无 forwardRef）递不进 ref。两个按钮都是纯文本形状，
                  沿用提示行同一套 tap-line 44px 热区；主次靠字重与颜色分，
                  二者都画在玻璃面上，不新增裁切元素，不引入焦点环问题。
                */}
                <button
                  ref={hintRef}
                  type="button"
                  onClick={claim}
                  className="tap-line text-sm font-semibold text-ink"
                  style={{ letterSpacing: 'var(--tracking-base)' }}
                >
                  找回对局
                </button>
                <button
                  ref={forfeitRef}
                  type="button"
                  onClick={forfeit}
                  className="tap-line text-sm text-ink-sub transition-colors hover:text-ink"
                  style={{ letterSpacing: 'var(--tracking-base)' }}
                >
                  放弃重连
                </button>
              </div>
            </div>
          ) : offerMode && offer.kind === 'busy' ? (
            <div className="anim-appear flex w-full flex-col items-center gap-2">
              <p
                role="status"
                aria-live="polite"
                className="jp-wrap text-sm text-ink-sub"
              >
                座位仍在使用中，正在确认能否找回…
              </p>
              <div className="mt-1 flex items-center justify-center">
                <button
                  ref={forfeitRef}
                  type="button"
                  onClick={forfeit}
                  className="tap-line text-sm text-ink-sub transition-colors hover:text-ink"
                  style={{ letterSpacing: 'var(--tracking-base)' }}
                >
                  放弃重连
                </button>
              </div>
            </div>
          ) : phase === 'intro' ? (
            <button
              ref={hintRef}
              type="button"
              onClick={enter}
              /* 用 ink 不用 primary：呼吸把 opacity 压到 0.65，而 primary #615f90
                 满不透明才 5.5:1，淡到 0.65 就掉到 3.6:1，读不出来了 */
              className="tap-line anim-appear text-sm font-semibold text-ink"
              style={{ animationDelay: `${ENTER.hint}ms`, letterSpacing: 'var(--tracking-base)' }}
            >
              {/*
                呼吸套在内层：动画一路跑在 opacity 上，而外层那个 anim-appear 用的是
                opacity + blur —— 同一个元素上两条动画抢同一个属性，后者会赢，入场就没了。
                两层各管各的，才既有入场又有呼吸。
              */}
              <span className="anim-breathe">{hint}</span>
            </button>
          ) : (
            idol && (
              /* text-base 而不是 text-sm：这一行是整段开场的焦点时刻，
                 比它上面那句描述还小一号的话，语音响起来时屏幕上没有对应的分量。
                 15u × lh 1.7 仍在 44px 之内，两个状态照旧等高 */
              <p className="anim-appear jp-wrap flex items-center gap-3 text-base text-ink-sub">
                <IdolFace idol={idol} />
                <span>
                  今天是 <b className="font-bold text-ink">{idol.name}</b> 来迎接你
                </span>
              </p>
            )
          )}
        </div>
      </Cut>
    </div>
  )
}
