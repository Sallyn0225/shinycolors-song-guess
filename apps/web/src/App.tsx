import { useCallback, useEffect, useState } from 'react'
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
import { Splash } from './screens/Splash'
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

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'start' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 刷新/断线后本地还留着座位凭证 —— 先试着接回原来的对局 */
  const [resuming, setResuming] = useState(() => socket.hasResumeToken)
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

  // 页面一进来就带着座位凭证连一次。服务端认得就把牌面推回来，认不得就当新会话。
  useEffect(() => {
    if (!socket.hasResumeToken) return
    socket.connect()
    const t = window.setTimeout(() => setResuming(false), RESUME_TIMEOUT_MS)
    return () => window.clearTimeout(t)
  }, [])

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
      {!opened && <Splash resume={resuming} onOpened={() => setOpened(true)} />}
    </>
  )
}
