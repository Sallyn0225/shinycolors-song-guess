import { useEffect, useState } from 'react'
import { DIFFICULTY_PRESETS, KARUTA_DEFAULTS, type RoomView } from '@scg/shared'

import { audio } from '../audio'
import { socket } from '../net/ws'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { PrismRail } from '../ui/PrismRail'
import { SectionTitle } from '../ui/SectionTitle'
import { Stat } from '../ui/Stat'

interface Props {
  onBack: () => void
}

/** 在线状态点。颜色之外还带形状与文字，不只靠颜色编码 */
function Presence({ online }: { online: boolean }) {
  return (
    <span
      aria-hidden
      className="block shrink-0"
      style={{
        width: 'calc(9 * var(--u))',
        height: 'calc(9 * var(--u))',
        background: online ? 'var(--color-correct)' : 'transparent',
        boxShadow: online ? undefined : 'inset 0 0 0 1.5px var(--color-primary-lt)',
        clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
      }}
    />
  )
}

export function Lobby({ onBack }: Props) {
  const [room, setRoom] = useState<RoomView | null>(null)
  const [nickname, setNickname] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [rtt, setRtt] = useState<number | null>(null)

  useEffect(() => {
    const offStatus = socket.onStatus(setConnected)
    socket.connect()
    setConnected(socket.connected)
    const off = socket.on((msg) => {
      if (msg.t === 'room') {
        setRoom(msg.room)
        setError(null)
      } else if (msg.t === 'error') {
        setError(msg.message)
      }
    })
    const t = window.setInterval(() => setRtt(socket.clock.rttMs || null), 800)
    return () => {
      off()
      offStatus()
      window.clearInterval(t)
    }
  }, [])

  /** 建房/加入都要先解锁音频 —— 这是这一步唯一的真实用户手势 */
  const withAudio = async (fn: () => void) => {
    try {
      await audio.unlock()
    } catch {
      /* 解锁失败也让流程继续，起播时会再试 */
    }
    fn()
  }

  const create = () =>
    void withAudio(() => socket.send({ t: 'createRoom', nickname: nickname.trim() || '玩家' }))
  const join = () =>
    void withAudio(() =>
      socket.send({ t: 'joinRoom', code: code.trim().toUpperCase(), nickname: nickname.trim() || '玩家' }),
    )

  const preset = DIFFICULTY_PRESETS[KARUTA_DEFAULTS.difficulty]

  const shell = (children: React.ReactNode) => (
    <main
      className="mx-auto flex min-h-dvh w-full flex-col justify-center px-6 py-14 sm:px-10"
      style={{ maxWidth: 'calc(760 * var(--u))' }}
    >
      {children}
    </main>
  )

  // ── 房间内 ────────────────────────────────────────────
  if (room) {
    const me = room.players[room.you]
    const other = room.players[room.you === 'A' ? 'B' : 'A']
    return shell(
      <>
        <SectionTitle kana="ルーム" latin="Room" size="md" className="anim-appear" />

        <p
          className="latin sc-roomcode anim-appear mt-6 font-bold text-primary"
          style={{ letterSpacing: 'var(--tracking-title)', lineHeight: 1 }}
        >
          {room.code}
        </p>
        <p className="mt-4 text-sm text-ink-sub">
          把这个房间码告诉对手，同一局域网直接输入即可加入。
        </p>

        <div className="mt-8 flex flex-col" style={{ gap: 'calc(10 * var(--u))' }}>
          {[me, other].map((p, i) => (
            <span key={i} className="cut-shadow-sm">
              <span className="glass-lit cut-bar flex items-center gap-3 px-8 py-4">
                <Presence online={!!p?.online} />
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">
                  {p ? p.nickname : '等待对手加入…'}
                  {i === 0 && <span className="ml-2 text-xs font-normal text-ink-faint">（你）</span>}
                </span>
                {p?.rttMs != null && <span className="latin text-xs text-ink-faint">{p.rttMs}ms</span>}
                {p?.ready && (
                  <span className="text-xs font-bold text-correct" style={{ letterSpacing: 'var(--tracking-base)' }}>
                    已准备
                  </span>
                )}
              </span>
            </span>
          ))}
        </div>

        <p className="mt-6 text-xs leading-relaxed text-ink-faint">
          双方 RTT 都公开显示 —— 透明比假装公平更重要。判定按「相对片段起播的反应时间」，
          不是服务器收包时间，所以网络延迟不影响胜负。
        </p>

        <div className="mt-8">
          <Button
            variant="primary"
            size="lg"
            full
            disabled={!other}
            onClick={() => socket.send({ t: 'ready', ready: !me?.ready })}
          >
            {!other ? '等待对手…' : me?.ready ? '取消准备' : '准备'}
          </Button>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="tap-line mt-4 self-start text-xs text-ink-faint transition-colors hover:text-primary"
          style={{ letterSpacing: 'var(--tracking-base)' }}
        >
          离开房间
        </button>
      </>,
    )
  }

  // ── 大厅 ──────────────────────────────────────────────
  return shell(
    <>
      <SectionTitle kana="タイセン" latin="Versus" size="lg" className="anim-appear" />
      <p className="jp-wrap mt-5 text-sm leading-relaxed text-ink-sub">
        从 234 首里抽 {KARUTA_DEFAULTS.poolSize} 首：{KARUTA_DEFAULTS.fieldCards} 首摊在场上（每人自陣{' '}
        {KARUTA_DEFAULTS.ownCards} 张），另 {KARUTA_DEFAULTS.karafuda} 首是
        <b className="font-bold text-ink">空札</b>
        —— 只会被播放、场上没有对应的牌，谁点谁お手つき。先清空自陣者胜。
      </p>

      <div className="anim-appear mt-7" style={{ animationDelay: '80ms' }}>
        <PrismRail mode="idle" spectrum={false} />
      </div>

      <dl
        className="mt-6 grid grid-cols-3 gap-6 py-6"
        style={{
          borderTop: '1px solid var(--color-divider)',
          borderBottom: '1px solid var(--color-divider)',
        }}
      >
        <Stat label="每回合" value={`${preset.clipSeconds}s`} />
        <Stat label="记忆时间" value={`${KARUTA_DEFAULTS.memorizeSeconds}s`} />
        <Stat label="难度" value={preset.label} />
      </dl>

      <div className="mt-8 flex flex-col" style={{ gap: 'calc(12 * var(--u))' }}>
        <Field
          type="text"
          value={nickname}
          onChange={(e) => setNickname(e.target.value.slice(0, 16))}
          placeholder="昵称"
          aria-label="昵称"
        />
        <Button variant="primary" size="lg" full onClick={create} disabled={!connected}>
          创建房间
        </Button>
      </div>

      <div className="mt-7 flex items-stretch gap-3">
        <div className="min-w-0 flex-1">
          <Field
            type="text"
            code
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
            placeholder="房间码"
            aria-label="房间码"
          />
        </div>
        <Button
          variant="glass"
          size="lg"
          onClick={join}
          disabled={!connected || code.length !== 6}
          className="shrink-0"
        >
          加入
        </Button>
      </div>

      {error && (
        <p
          role="alert"
          className="cut-slant mt-5 px-5 py-3 text-sm text-wrong"
          style={{ background: 'rgb(179 18 58 / .1)', boxShadow: 'inset 0 0 0 1px var(--color-wrong)' }}
        >
          {error}
        </p>
      )}

      <p role="status" aria-live="polite" className="mt-5 flex items-center gap-2 text-xs text-ink-sub">
        <Presence online={connected} />
        {connected ? `已连接${rtt != null ? ` · ${rtt}ms` : ''}` : '连接中…'}
      </p>

      <button
        type="button"
        onClick={onBack}
        className="tap-line mt-7 self-start text-xs text-ink-faint transition-colors hover:text-primary"
        style={{ letterSpacing: 'var(--tracking-base)' }}
      >
        返回
      </button>
    </>,
  )
}
