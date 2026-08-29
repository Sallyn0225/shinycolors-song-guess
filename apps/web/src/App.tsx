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
  | { name: 'karuta'; match: MatchView; memorizeEndsAtServer: number }

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'start' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  // 对局一开始就切到牌场。
  // 注意必须把 matchStart 的内容一起带下去 —— Karuta 是收到消息之后才挂载的，
  // 它自己的监听器注册时这条消息已经过去了，等不到第二次。
  useEffect(() => {
    const off = socket.on((msg) => {
      if (msg.t === 'matchStart') {
        setScreen({ name: 'karuta', match: msg.match, memorizeEndsAtServer: msg.memorizeEndsAtServer })
      }
    })
    return off
  }, [])

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
