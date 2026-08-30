import { useEffect, useState } from 'react'
import { DIFFICULTY_PRESETS, KARUTA_DEFAULTS, type RoomView } from '@scg/shared'

import { socket } from '../net/ws'
import { audio } from '../audio'

interface Props {
  onBack: () => void
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

  if (room) {
    const me = room.players[room.you]
    const other = room.players[room.you === 'A' ? 'B' : 'A']
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-6 py-12">
        <div className="prism-flow mb-7 h-px w-20 opacity-80" />
        <p className="font-mono text-[11px] tracking-[0.28em] text-faint uppercase">Room</p>
        <p className="tnum mt-2 font-mono text-6xl font-medium tracking-[0.18em]">{room.code}</p>
        <p className="mt-3 text-sm text-muted">把这个房间码告诉对手，同一局域网直接输入即可加入。</p>

        <ul className="mt-8 space-y-2">
          {[me, other].map((p, i) => (
            <li
              key={i}
              className="flex items-center gap-3 rounded-xl border border-[color:var(--color-line)] bg-panel px-4 py-3"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: p?.online ? 'var(--color-correct)' : 'var(--color-faint)' }}
              />
              <span className="flex-1 text-sm font-bold">
                {p ? p.nickname : '等待对手加入…'}
                {i === 0 && <span className="ml-2 text-xs font-normal text-faint">（你）</span>}
              </span>
              {p?.rttMs != null && <span className="tnum font-mono text-xs text-faint">{p.rttMs}ms</span>}
              {p?.ready && <span className="text-xs text-[color:var(--color-correct)]">已准备</span>}
            </li>
          ))}
        </ul>

        <p className="mt-6 text-xs leading-relaxed text-faint">
          双方 RTT 都公开显示 —— 透明比假装公平更重要。判定按「相对片段起播的反应时间」，
          不是服务器收包时间，所以网络延迟不影响胜负。
        </p>

        <button
          type="button"
          disabled={!other}
          onClick={() => socket.send({ t: 'ready', ready: !me?.ready })}
          className="mt-7 w-full rounded-xl border border-[color:var(--color-line-lit)] bg-panel py-3.5 text-sm font-bold transition-all enabled:hover:-translate-y-0.5 enabled:hover:bg-panel-lit disabled:opacity-40"
        >
          {!other ? '等待对手…' : me?.ready ? '取消准备' : '准备'}
        </button>
        <button type="button" onClick={onBack} className="mt-3 py-2 text-xs text-faint hover:text-muted">
          离开房间
        </button>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-6 py-12">
      <div className="prism-flow mb-7 h-px w-20 opacity-80" />
      <p className="font-mono text-[11px] tracking-[0.28em] text-faint uppercase">1v1 · 空札領地戦</p>
      <h1 className="mt-3 font-display text-4xl leading-tight font-extrabold">
        <span className="prism-text">歌牌</span>式对战
      </h1>
      <p className="jp-wrap mt-4 text-sm leading-relaxed text-muted">
        从 234 首里抽 {KARUTA_DEFAULTS.poolSize} 首：{KARUTA_DEFAULTS.fieldCards} 首摊在场上（每人自陣{' '}
        {KARUTA_DEFAULTS.ownCards} 张），另 {KARUTA_DEFAULTS.karafuda} 首是<b className="text-text">空札</b>
        —— 只会被播放、场上没有对应的牌，谁点谁お手つき。先清空自陣者胜。
      </p>

      <dl className="mt-6 grid grid-cols-3 gap-3 border-y border-[color:var(--color-line)] py-4">
        {[
          ['每回合', `${preset.clipSeconds}s`],
          ['记忆时间', `${KARUTA_DEFAULTS.memorizeSeconds}s`],
          ['难度', preset.label],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-[10px] tracking-wider text-faint">{k}</dt>
            <dd className="tnum mt-1 font-mono text-base">{v}</dd>
          </div>
        ))}
      </dl>

      <input
        type="text"
        value={nickname}
        onChange={(e) => setNickname(e.target.value.slice(0, 16))}
        placeholder="昵称"
        className="mt-7 w-full rounded-xl border border-[color:var(--color-line-lit)] bg-[#10152a] px-4 py-3 text-sm outline-none focus:border-[#8ea2ff]"
      />

      <button
        type="button"
        onClick={create}
        disabled={!connected}
        className="mt-3 w-full rounded-xl border border-[#4460c4] bg-[#2f4a9e] py-3.5 text-sm font-bold transition-all enabled:hover:-translate-y-0.5 disabled:opacity-40"
      >
        创建房间
      </button>

      <div className="mt-5 flex gap-2">
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
          placeholder="房间码"
          className="tnum w-full rounded-xl border border-[color:var(--color-line-lit)] bg-[#10152a] px-4 py-3 text-center font-mono text-lg tracking-[0.3em] outline-none focus:border-[#8ea2ff]"
        />
        <button
          type="button"
          onClick={join}
          disabled={!connected || code.length !== 6}
          className="shrink-0 rounded-xl border border-[color:var(--color-line-lit)] bg-panel px-6 text-sm font-bold transition-all enabled:hover:bg-panel-lit disabled:opacity-40"
        >
          加入
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-4 text-center text-sm text-[color:var(--color-wrong)]">
          {error}
        </p>
      )}
      <p className="mt-4 text-center text-xs text-faint">
        {connected ? `已连接${rtt != null ? ` · ${rtt}ms` : ''}` : '连接中…'}
      </p>

      <button type="button" onClick={onBack} className="mt-6 py-2 text-xs text-faint hover:text-muted">
        返回
      </button>
    </main>
  )
}
