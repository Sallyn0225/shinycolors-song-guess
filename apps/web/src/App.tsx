import { useCallback, useEffect, useState } from 'react'
import type { Difficulty, MatchView } from '@scg/shared'

import { api, type SessionInfo } from './api'
import { audio } from './audio'
import { Start } from './screens/Start'
import { Play } from './screens/Play'
import { Result } from './screens/Result'
import { Lobby } from './screens/Lobby'
import { Karuta } from './screens/Karuta'
import { socket } from './net/ws'

type Screen =
  | { name: 'start' }
  | { name: 'play'; session: SessionInfo }
  | { name: 'result'; sessionId: string; difficulty: Difficulty }
  | { name: 'lobby' }
  | { name: 'karuta'; match: MatchView; memorizeEndsAtServer: number; resumed: boolean }

/** 找回座位的等待上限。到点还没恢复就当新会话，别让人一直卡在恢复界面 */
const RESUME_TIMEOUT_MS = 6000

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'start' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 刷新/断线后本地还留着座位凭证 —— 先试着接回原来的对局 */
  const [resuming, setResuming] = useState(() => socket.hasResumeToken)

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
          setScreen((prev) => (prev.name === 'start' ? { name: 'lobby' } : prev))
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

  // 恢复期间不要先闪一下首页 —— 那会让人以为对局已经没了
  if (resuming && screen.name === 'start') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3">
        <div className="prism-flow h-px w-20 opacity-80" />
        <p className="text-sm text-muted">正在找回对局…</p>
        <button
          type="button"
          onClick={() => setResuming(false)}
          className="mt-2 py-2 text-xs text-faint hover:text-muted"
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
            socket.send({ t: 'leaveRoom' })
            socket.close()
            setScreen({ name: 'start' })
          }}
        />
      )
    case 'karuta':
      return (
        <Karuta
          initialMatch={screen.match}
          memorizeEndsAtServer={screen.memorizeEndsAtServer}
          resumed={screen.resumed}
          onExit={() => {
            socket.send({ t: 'leaveRoom' })
            socket.close()
            setScreen({ name: 'start' })
          }}
        />
      )
    case 'play':
      return (
        <Play
          key={screen.session.sessionId}
          session={screen.session}
          onFinish={() =>
            setScreen({ name: 'result', sessionId: screen.session.sessionId, difficulty: screen.session.difficulty })
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
    default:
      return (
        <Start
          onStart={(d) => void start(d)}
          onVersus={() => setScreen({ name: 'lobby' })}
          busy={busy}
          error={error}
        />
      )
  }
}
