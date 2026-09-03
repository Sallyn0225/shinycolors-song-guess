import { useCallback, useEffect, useRef, useState } from 'react'
import type { Difficulty, MatchView, RoomView } from '@scg/shared'

import { ambience } from './ambience'
import { api, type SessionInfo } from './api'
import { audio } from './audio'
import { socket } from './net/ws'
import { Karuta } from './screens/Karuta'
import { Lobby } from './screens/Lobby'
import { Play } from './screens/Play'
import { Records } from './screens/Records'
import { Result } from './screens/Result'
import { Room } from './screens/Room'
import { Splash, type SeatOfferState } from './screens/Splash'
import { Start } from './screens/Start'
import { Backdrop } from './ui/Backdrop'
import { OverlayMark } from './ui/Overlay'

type Screen =
  | { name: 'start' }
  | { name: 'play'; session: SessionInfo }
  | { name: 'result'; sessionId: string; difficulty: Difficulty }
  | { name: 'lobby' }
  | { name: 'room'; room: RoomView }
  | { name: 'karuta'; match: MatchView; memorizeEndsAtServer: number; resumed: boolean }
  | { name: 'records' }

/** 找回座位的等待上限。到点还没恢复就当新会话，别让人一直卡在恢复界面 */
const RESUME_TIMEOUT_MS = 6000
/** 座位仍在被占用（busy）时探测重试的间隔 */
const PROBE_RETRY_MS = 3000

/** 探测结果要交给 Splash 呈现的状态（类型定义在 Splash.tsx） */
export type { SeatOfferState }

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'start' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /**
   * 三岔启动（design.md）：读本地凭证 ——
   * - 无 / 已过期 → 首次访问，什么都不做（与以前一致）；
   * - 有，且本标签页持有过（`tabHeldSeat`）→ 今天的路：connect + 自动认领，静默恢复；
   * - 有，但是新标签页 → connect + `hello{claim:false}` 探测，按 seatOffer 分支。
   */
  const [resuming, setResuming] = useState(() => socket.hasResumeToken && socket.tabHeldSeat)
  /** 探测到的座位状态，非空时 Splash 在 resume 支线上摆出「找回 / 放弃」二选一 */
  const [offer, setOffer] = useState<SeatOfferState | null>(null)
  /** busy 自动重试的定时器句柄 */
  const probeTimer = useRef(0)
  /** 开场遮罩还没被点掉。它同时是音频解锁所需的那次用户手势，见 screens/Splash.tsx */
  const [opened, setOpened] = useState(false)

  const start = useCallback(async (difficulty: Difficulty) => {
    setBusy(true)
    setError(null)
    try {
      // 必须在这次真实点击的调用栈里解锁 AudioContext。
      // 漏了这一步，线上第一题会全场静音——而本地热重载的开发页面永远不会复现。
      await audio.unlock()
      const session = await api.createSession(difficulty)
      setScreen({ name: 'play', session })
    } catch (e) {
      setError(e instanceof Error ? e.message : '开局失败，确认服务端已启动')
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    if (socket.tabHeldSeat) {
      // 无凭证 → 首次访问，与以前完全一致
      if (!socket.hasResumeToken) return
      // 同标签页刷新：既有的静默自动认领路径，一个字没改
      socket.connect()
      const t = window.setTimeout(() => setResuming(false), RESUME_TIMEOUT_MS)
      return () => window.clearTimeout(t)
    }
    /*
      新标签页：connect() 的 onopen 会自动带凭证认领 —— 那是抢座，
      所以先把凭证从自动认领路径上摘下来暂存，再连一条干净的连接。
      之后探测（claim:false，零副作用）问服务端「这个座位能不能找回」，
      座位仍在线（busy）就绝不认领，防抢座在认领之前拦住。

      判据用 `parkSeat()` 的返回值，**不能用 `hasResumeToken`** ——
      `parkSeat()` 正是把凭证从 `resumeToken` 上摘走的那个动作，
      摘完 `hasResumeToken` 就是 false 了。StrictMode 下 effect 跑两遍
      （mount → cleanup → mount），第二遍要是拿它当早退条件，会在
      「凭证已被第一遍摘走」的状态下直接返回：监听和重试定时器都随
      cleanup 没了，而 onopen 是 cleanup 之后才到的 —— 探测一次都发不出去，
      表现就是修好的服务端配着一个永远不弹的界面。
      `parkSeat()` 幂等，重复调用返回同一份暂存，第二遍照常装配。
    */
    const parked = socket.parkSeat()
    // 没有凭证（也没有暂存）= 首次访问，什么都不做
    if (!parked) return
    socket.connect()
    setResuming(false)
    const probe = () => socket.send({ t: 'hello', resumeToken: parked, claim: false })
    // 连接建立后探一次（status 回调对已建立的连接不会补发，所以要双保险）
    const off = socket.onStatus((connected) => {
      if (connected) probe()
    })
    if (socket.connected) probe()
    // busy（半开窗口 / 另一个标签页正开着）期间按固定间隔自动重试，
    // 直到守卫放行（→ ok）或座位消失（→ gone）。ok / gone 会清掉这条定时器
    probeTimer.current = window.setInterval(() => {
      if (socket.connected) probe()
    }, PROBE_RETRY_MS)
    return () => {
      off()
      window.clearInterval(probeTimer.current)
    }
  }, [])

  // 探测应答：ok → 摆出「找回 / 放弃」；busy → 保持等待由上面的定时器重试；
  // gone → 凭证已死，清掉并按首次访问处理（不弹提示）
  useEffect(() => {
    const off = socket.on((msg) => {
      if (msg.t !== 'seatOffer') return
      if (msg.reason === 'ok') {
        window.clearInterval(probeTimer.current)
        setOffer({ kind: 'ok', roomCode: msg.roomCode, opponent: msg.opponent, inMatch: msg.inMatch })
      } else if (msg.reason === 'busy') {
        setOffer({ kind: 'busy' }) // 定时器继续跑，到点重发探测
      } else {
        window.clearInterval(probeTimer.current)
        socket.forgetSeat()
        setOffer(null)
      }
    })
    return off
  }, [])

  /** 「找回对局」：从探测切到认领 —— 走既有的 hello{claim:true} 路径 */
  const claimSeat = useCallback(() => {
    window.clearInterval(probeTimer.current)
    setOffer(null)
    setResuming(true)
    socket.claimSeat()
    // 到点还没恢复就放人回首页，别让人卡在「正在找回」
    window.setTimeout(() => setResuming(false), RESUME_TIMEOUT_MS)
  }, [])

  /**
   * 「放弃重连」：认领 → leaveRoom → 清凭证 → 落首页。
   *
   * 认领的判据是「凭证存在**任何地方**」而不是 `hasResumeToken`。
   * `claimSeat()` 返回认领是否真的发出去了：发出去了才发 leaveRoom（R5）；
   * 没发出去（座位真没了 / 连接不通）或处于 busy 窗口退化为纯本地放弃（R7），两者都不加协议。
   */
  const forfeitSeat = useCallback(() => {
    window.clearInterval(probeTimer.current)
    const isBusy = offer?.kind === 'busy'
    setOffer(null)
    if (!isBusy) {
      const claimed = socket.claimSeat()
      if (claimed) socket.send({ t: 'leaveRoom' })
    }
    socket.forgetSeat()
    setOpened(true) // Splash 要让位给首页
    setScreen({ name: 'start' })
  }, [offer])

  // 对局一开始就切到牌场。
  // 注意必须把 matchStart 的内容一起带下去 —— Karuta 是收到消息之后才挂载的，
  // 它自己的监听器注册时这条消息已经过去了，等不到第二次。
  // 重连走的是 stateSync，同样要在这里接住：Karuta 还没挂载，它自己收不到。
  useEffect(() => {
    const off = socket.on((msg) => {
      switch (msg.t) {
        case 'matchStart':
          setResuming(false)
          setScreen({
            name: 'karuta',
            match: msg.match,
            memorizeEndsAtServer: msg.memorizeEndsAtServer,
            resumed: false,
          })
          break
        case 'welcome':
          // 这条连接带着新凭证入座了（建房/进房，或放弃后重新进房）→
          // 本标签页从此持有座位，刷新时走静默自动恢复而不是探测
          if (msg.resumeToken) socket.markTabHeldSeat()
          if (msg.resumed) break
          // 没认出座位就别再等了
          setResuming(false)
          // 已经在牌场上却收到「这是一次新连接」，说明座位没了
          //（宽限到期，或服务端重启过）。连接是通的，所以断线遮罩不会出现，
          // 再留在旧牌面上只会让人对着一个点什么都没反应的棋盘发呆
          setScreen((prev) => {
            if (prev.name !== 'karuta') return prev
            setError('对局已结束 —— 座位在断线宽限内没能恢复')
            return { name: 'start' }
          })
          break
        case 'room':
          setResuming(false)
          // 守卫仍然是为了「重连时别把牌场顶掉」。条件放宽到也接受 lobby ——
          // 现在建房/进房成功正是从大厅切到房间屏的那一步
          setScreen((prev) =>
            prev.name === 'start' || prev.name === 'lobby' || prev.name === 'room'
              ? { name: 'room', room: msg.room }
              : prev,
          )
          break
        case 'stateSync':
          setResuming(false)
          setScreen((prev) =>
            prev.name === 'karuta'
              ? prev
              : {
                  name: 'karuta',
                  match: msg.match,
                  // 不在记忆阶段时给个已过期的时刻，倒计时直接显示 0
                  memorizeEndsAtServer: msg.memorizeEndsAtServer ?? Date.now(),
                  resumed: true,
                },
          )
          break
        default:
          break
      }
    })
    return off
  }, [])

  const body = () => {
    // 恢复期间不要先闪一下首页 —— 那会让人以为对局已经没了
    if (resuming && screen.name === 'start') {
      return (
        <main className="flex min-h-safe flex-col items-center justify-center gap-4">
          <OverlayMark />
          <p className="text-sm text-ink-sub">正在找回对局…</p>
          <button
            type="button"
            onClick={() => setResuming(false)}
            className="tap-line mt-1 text-xs text-ink-faint transition-colors hover:text-primary"
            style={{ letterSpacing: 'var(--tracking-base)' }}
          >
            跳过，回到首页
          </button>
        </main>
      )
    }

    switch (screen.name) {
      case 'lobby':
        return (
          <Lobby
            onBack={() => {
              socket.close()
              setScreen({ name: 'start' })
            }}
          />
        )
      case 'room':
        return (
          <Room
            key={screen.room.code}
            initialRoom={screen.room}
            // 离开房间回大厅，**不断开 socket** —— 断了要重连、列表要重订阅，
            // 而这一步用户想做的只是「换一间房」
            onLeave={() => {
              socket.send({ t: 'leaveRoom' })
              // 主动退出后座位已经交还，凭证不能留着指向一个已消失的座位（prd.md F8）
              socket.forgetSeat()
              setScreen({ name: 'lobby' })
            }}
          />
        )
      case 'karuta':
        return (
          <Karuta
            initialMatch={screen.match}
            memorizeEndsAtServer={screen.memorizeEndsAtServer}
            resumed={screen.resumed}
            // 主动退出不断 socket，落到联机大厅 —— 关掉就要重连、列表要重订阅，
            // 而用户此刻想做的只是「换一局」（与 Room 屏的 onLeave 同一条理由）。
            // 断线时 socket.send 会静默失败，落到大厅后 Lobby 屏自己会重连并重订阅列表。
            onExit={() => {
              socket.send({ t: 'leaveRoom' })
              socket.forgetSeat()
              setScreen({ name: 'lobby' })
            }}
            // 对手主动退出：落回 Room 屏（房间还在、房间码不变），而不是大厅。
            // 不走 `case 'room'` 那条守卫 —— 它刻意不接受从 karuta 屏切走
            // （「重连时别把牌场顶掉」），落点数据由 peerLeft 消息直接带下来。
            onPeerLeft={(room) => setScreen({ name: 'room', room })}
          />
        )
      case 'play':
        return (
          <Play
            key={screen.session.sessionId}
            session={screen.session}
            onFinish={() =>
              setScreen({
                name: 'result',
                sessionId: screen.session.sessionId,
                difficulty: screen.session.difficulty,
              })
            }
            onQuit={() => setScreen({ name: 'start' })}
          />
        )
      case 'result':
        return (
          <Result
            sessionId={screen.sessionId}
            onReplay={() => void start(screen.difficulty)}
            onHome={() => setScreen({ name: 'start' })}
          />
        )
      case 'records':
        return <Records onBack={() => setScreen({ name: 'start' })} />
      default:
        return (
          <Start
            onStart={(d) => void start(d)}
            onVersus={() => setScreen({ name: 'lobby' })}
            onRecords={() => setScreen({ name: 'records' })}
            busy={busy}
            error={error}
          />
        )
    }
  }

  // 背景视频只铺在「还没开局」的那几屏（start / lobby / room）。
  // Play / Karuta 上一切会动的东西都在跟听力和抢牌抢注意力，而且那两屏本来就在解码音频、
  // 跑 rAF 计时，再挂一路 24fps 视频解码是白白给判定让路；结算页（result）同样不铺视频，
  // 避免干扰战报排版与文字对比度（Backdrop 的 data-ambient 属性）。
  const video = screen.name === 'start' || screen.name === 'lobby' || screen.name === 'room'

  /*
    环境 BGM 的范围比背景视频多一屏：铺视频的那三屏 + 结算页（result）。
    对局中（Play / Karuta）注意力被听力和抢牌占满，不垫背景音乐；而单机结算页
    既不抢判定也不跑高频音频，可以淡入环境 BGM，并且在返回首页或再来一局时
    与首页平滑衔接（续播不重起）。

    `!resuming` 是第二个条件：正在找回对局时不起 BGM，对局可能下一秒就恢复，
    不该让开场的音乐压在牌场的第一声上。找回失败退回首页时 resuming 转 false，
    这里会再跑一次，那时候起 BGM 才是对的。
  */
  const bgm = video || screen.name === 'result' || screen.name === 'records'

  useEffect(() => {
    ambience.setEnabled(bgm && !resuming)
  }, [bgm, resuming])

  /*
    交给 Splash 的「这次打开是回到一个已经在跑的对局」。

    **不能直接用 `resuming`** —— 那是个加载态，恢复一成功就必须转 false，
    否则「正在找回对局…」会一直挂着。可对 Splash 来说，恢复成功恰恰是
    resume 支线最成立的时候：遮罩要等用户那次点击（解锁 AudioContext）才散，
    而恢复往往比人点得快，于是 `resuming` 在点击前就没了，Splash 掉回首次访问那条路，
    完整播一遍问候语音再起 BGM —— 对局正在跑，那是最不该拿开场动画拖时间的时刻
    （`screens/Splash.tsx` 开头的 resume 支线就是为此存在的）。

    「恢复已经成功」这件事 `screen` 已经记着了：遮罩还在场时能走到 karuta / room
    只有恢复这一条路（首次访问要先点掉遮罩才谈得上入座）。所以由它推导，
    既不新增 state，也不必去跟 RESUME_TIMEOUT_MS 那个定时器抢先后。
    恢复失败的两条路（超时、服务端不认这个座位）都会让 resuming 转 false 且
    screen 留在 start，这里随之回落到普通开场，正是想要的。
  */
  const resumePath = resuming || screen.name === 'karuta' || screen.name === 'room'

  return (
    <>
      <Backdrop video={video} />
      {/*
        开场遮罩在场时**不渲染首页**。不是为了省渲染，是为了让开场那枚票券
        直接浮在与首页完全相同的场景上：遮罩因此不必自己糊一道白幕去挡住底下的文字，
        幕布散开时景不变、只是票券化开、内容入场。
        副作用正是想要的——首页的 anim-appear 留到那一刻才跑。
      */}
      {opened && body()}
      {!opened && (
        <Splash
          resume={resumePath}
          offer={offer}
          onClaim={claimSeat}
          onForfeit={forfeitSeat}
          onOpened={() => setOpened(true)}
        />
      )}
    </>
  )
}
