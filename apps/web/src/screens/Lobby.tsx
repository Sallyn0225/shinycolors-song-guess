import { useEffect, useState } from 'react'
import {
  DIFFICULTY_PRESETS,
  KARUTA_DEFAULTS,
  ROOM_LIST_MAX,
  ROOM_NAME_MAX,
  sanitizeRoomName,
  type RoomSummary,
  type RoomVisibility,
} from '@scg/shared'

import { LIBRARY } from '../features/library'
import { RoomCard } from '../components/RoomCard'
import { audio } from '../audio'
import { socket } from '../net/ws'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { Overlay, OverlayMark } from '../ui/Overlay'
import { Presence } from '../ui/Presence'
import { HeroTitle } from '../ui/SectionTitle'
import { PrismRail } from '../ui/PrismRail'
import { Stat } from '../ui/Stat'

interface Props {
  onBack: () => void
}

/**
 * 昵称记在 localStorage，不是 sessionStorage。
 *
 * 和座位凭证（`net/ws.ts` 用 sessionStorage）正好相反，而且必须相反：
 * 座位是「这个标签页的」，多开一个窗口不能抢座；昵称是「这个人的」，下次来还是他。
 */
const NICK_KEY = 'scg.nickname'

function readNickname(): string {
  try {
    return localStorage.getItem(NICK_KEY) ?? ''
  } catch {
    return '' // 隐私模式下会抛，记不住而已，不该崩
  }
}

function writeNickname(v: string): void {
  try {
    localStorage.setItem(NICK_KEY, v)
  } catch {
    /* 同上 */
  }
}

/** 可见性二选一。用真 radio —— 自制的 aria-pressed 按钮组在读屏里读不出「二选一」 */
function VisibilityChoice({
  value,
  onChange,
}: {
  value: RoomVisibility
  onChange: (v: RoomVisibility) => void
}) {
  const OPTIONS: { v: RoomVisibility; label: string; hint: string }[] = [
    { v: 'public', label: '公开', hint: '出现在大厅列表里，谁都能进' },
    { v: 'private', label: '私人', hint: '不进列表，只有拿到房间码的人能进' },
  ]
  return (
    <fieldset className="mt-5">
      <legend
        className="text-2xs font-semibold text-primary"
        style={{ letterSpacing: 'var(--tracking-title)' }}
      >
        コウカイ / VISIBILITY
      </legend>
      <div className="mt-3 flex flex-col" style={{ gap: 'calc(8 * var(--u))' }}>
        {OPTIONS.map((o) => (
          <label key={o.v} className="cut-shadow-sm block cursor-pointer">
            <span
              className="glass-lit cut-slant relative flex items-center gap-3 px-5 py-3"
              style={{ minHeight: '44px' }}
            >
              {/* 描边要跟着斜切走，不能用 inset box-shadow —— 见 index.css「坑三」 */}
              <span
                aria-hidden
                className="cut-ring cut-ring-slant"
                style={
                  {
                    '--ring': value === o.v ? '2px' : '1.5px',
                    '--ring-color':
                      value === o.v ? 'var(--color-accent-ink)' : 'var(--color-primary)',
                  } as React.CSSProperties
                }
              />
              <input
                type="radio"
                name="visibility"
                value={o.v}
                checked={value === o.v}
                onChange={() => onChange(o.v)}
                className="sr-only"
              />
              <span
                aria-hidden
                className="block shrink-0"
                style={{
                  width: 'calc(10 * var(--u))',
                  height: 'calc(10 * var(--u))',
                  // 选中深青、未选浅紫，都是实心：
                  // inset 阴影会被菱形的 clip-path 削成四个碎点，像个转圈的加载图标
                  background: value === o.v ? 'var(--color-accent-ink)' : 'var(--color-primary-lt)',
                  clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
                }}
              />
              <span className="min-w-0 flex-1 text-left">
                <span className="block text-sm font-bold text-ink">{o.label}</span>
                <span className="mt-0.5 block text-2xs text-ink-sub">{o.hint}</span>
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function Lobby({ onBack }: Props) {
  const [nickname, setNickname] = useState(readNickname)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [rtt, setRtt] = useState<number | null>(null)

  const [rooms, setRooms] = useState<RoomSummary[] | null>(null)
  const [waitingTotal, setWaitingTotal] = useState(0)
  const [busyTotal, setBusyTotal] = useState(0)

  const [creating, setCreating] = useState(false)
  const [roomName, setRoomName] = useState('')
  const [visibility, setVisibility] = useState<RoomVisibility>('public')

  useEffect(() => {
    const subscribe = () => socket.send({ t: 'rooms', subscribe: true })

    const offStatus = socket.onStatus((c) => {
      setConnected(c)
      // 重连之后要重新订阅：服务端的订阅挂在连接上，断了就没了
      if (c) subscribe()
    })
    socket.connect()
    setConnected(socket.connected)
    if (socket.connected) subscribe()

    const off = socket.on((msg) => {
      if (msg.t === 'roomList') {
        setRooms(msg.rooms)
        setWaitingTotal(msg.waitingTotal)
        setBusyTotal(msg.busyTotal)
      } else if (msg.t === 'error') {
        setError(msg.message)
      }
    })
    // 这个 interval 同时驱动 RTT 和列表里的「几分钟前」，不需要第二个定时器
    const t = window.setInterval(() => setRtt(socket.clock.rttMs || null), 800)
    return () => {
      off()
      offStatus()
      window.clearInterval(t)
      socket.send({ t: 'rooms', subscribe: false })
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

  const nick = () => {
    const v = nickname.trim() || '玩家'
    writeNickname(nickname.trim())
    return v
  }

  const create = () => {
    setError(null)
    const name = sanitizeRoomName(roomName)
    void withAudio(() =>
      socket.send({
        t: 'createRoom',
        nickname: nick(),
        ...(name ? { name } : {}),
        visibility,
      }),
    )
  }

  const joinByCode = () => {
    setError(null)
    void withAudio(() =>
      socket.send({ t: 'joinRoom', code: code.trim().toUpperCase(), nickname: nick() }),
    )
  }

  const joinRoom = (target: string) => {
    setError(null)
    void withAudio(() => socket.send({ t: 'joinRoom', code: target, nickname: nick() }))
  }

  const preset = DIFFICULTY_PRESETS[KARUTA_DEFAULTS.difficulty]
  const hidden = Math.max(0, waitingTotal + busyTotal - (rooms?.length ?? 0))

  return (
    <main
      className="mx-auto flex min-h-dvh w-full flex-col px-6 py-14 sm:px-10"
      style={{ maxWidth: 'var(--page-narrow)' }}
    >
      {/* 组一「这是什么」。与首页同构：标题居中，说明贴着它，光带作为与操作区的界线 */}
      <header className="anim-appear text-center">
        <HeroTitle brand="Versus" title="1v1 空札領地戦" />
        <p className="jp-wrap mx-auto mt-5 text-sm leading-relaxed text-ink-sub">
          两个人各自一台设备，听同一段伴奏抢同一张牌。建一间房等人，或者从下面的列表里挑一间进去。
        </p>
      </header>

      <div className="anim-appear mt-10" style={{ animationDelay: '80ms' }}>
        <PrismRail mode="idle" spectrum={false} />
      </div>

      {/*
        组二「怎么进场」。建房与用房间码进房是两条并列的配对路径，
        中间隔着的昵称是两条都要的前置，所以三者归一组、组内收紧。
        不跟着 Hero 居中：输入框与按钮是整宽的，居中只会打断左对齐的扫读线。
      */}
      <div className="mt-10 flex flex-col" style={{ gap: 'calc(12 * var(--u))' }}>
        <Field
          type="text"
          value={nickname}
          onChange={(e) => setNickname(e.target.value.slice(0, 16))}
          onBlur={() => writeNickname(nickname.trim())}
          placeholder="昵称"
          aria-label="昵称"
        />
        <Button
          variant="primary"
          size="lg"
          full
          onClick={() => {
            setError(null)
            setCreating(true)
          }}
          disabled={!connected}
        >
          创建房间
        </Button>
      </div>

      <div className="mt-5 flex items-stretch gap-3">
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
          onClick={joinByCode}
          disabled={!connected || code.length !== 6}
          className="shrink-0"
        >
          加入
        </Button>
      </div>

      {error && (
        <p
          role="alert"
          className="cut-slant relative mt-5 px-5 py-3 text-sm text-wrong"
          style={{ background: 'rgb(179 18 58 / .1)' }}
        >
          <span
            aria-hidden
            className="cut-ring cut-ring-slant"
            style={{ '--ring': '1px', '--ring-color': 'var(--color-wrong)' } as React.CSSProperties}
          />
          {error}
        </p>
      )}

      {/* ── 组三「现在有谁」：房间列表 ───────────────── */}
      <div
        className="mt-11 flex items-baseline justify-between gap-4"
        style={{ borderBottom: '1px solid var(--color-divider)', paddingBottom: 'calc(10 * var(--u))' }}
      >
        <h2
          className="text-2xs font-semibold text-primary"
          style={{ letterSpacing: 'var(--tracking-title)' }}
        >
          ルーム / ROOMS
        </h2>
        <p className="text-2xs text-ink-faint" style={{ letterSpacing: 'var(--tracking-base)' }}>
          等人 {waitingTotal} · 进行中 {busyTotal}
        </p>
      </div>

      <div
        role="status"
        aria-live="polite"
        className="mt-5 flex flex-col"
        style={{ gap: 'calc(8 * var(--u))' }}
      >
        {rooms === null ? (
          <p className="text-sm text-ink-faint">{connected ? '正在获取房间列表…' : '连接中…'}</p>
        ) : rooms.length === 0 ? (
          <p className="text-sm text-ink-faint">暂时没有公开房间。</p>
        ) : (
          <>
            {/* 断线时列表还挂在屏幕上，但它已经是旧的了 —— 要说出来，不能让人对着它乱点 */}
            {!connected && (
              <p className="text-2xs text-ink-sub">连接已断开，下面是断线前的列表，正在重连…</p>
            )}
            {rooms.map((r) => (
              <RoomCard
                key={r.code}
                room={r}
                createdAtLocal={socket.toLocalTime(r.createdAt)}
                offline={!connected}
                onJoin={joinRoom}
              />
            ))}
          </>
        )}
        {hidden > 0 && (
          <p className="mt-1 text-2xs text-ink-faint">
            另有 {hidden} 个房间未显示（一次最多列出 {ROOM_LIST_MAX} 个）。
          </p>
        )}
      </div>

      {/* ── 组四「规则」 ───────────────────────────── */}
      <h2
        className="mt-12 text-2xs font-semibold text-primary"
        style={{ letterSpacing: 'var(--tracking-title)' }}
      >
        アソビカタ / HOW TO PLAY
      </h2>
      <p className="jp-wrap mt-4 text-sm leading-relaxed text-ink-sub">
        从 {LIBRARY.songs} 首里抽 {KARUTA_DEFAULTS.poolSize} 首：{KARUTA_DEFAULTS.fieldCards}{' '}
        首摊在场上（每人自陣{' '}
        {KARUTA_DEFAULTS.ownCards} 张），另 {KARUTA_DEFAULTS.karafuda} 首是
        <b className="font-bold text-ink">空札</b>
        —— 只会被播放、场上没有对应的牌，谁点谁お手つき。先清空自陣者胜。
      </p>

      <dl
        className="mt-6 grid grid-cols-3 gap-6 py-6"
        style={{
          borderTop: '1px solid var(--color-divider)',
          borderBottom: '1px solid var(--color-divider)',
        }}
      >
        {/* 联机的每回合读 roundWindowSeconds，不是单机的 preset.clipSeconds */}
        <Stat label="每回合" value={`${KARUTA_DEFAULTS.roundWindowSeconds}s`} />
        <Stat label="记忆时间" value={`${KARUTA_DEFAULTS.memorizeSeconds}s`} />
        <Stat label="难度" value={preset.label} />
      </dl>

      <p role="status" aria-live="polite" className="mt-6 flex items-center gap-2 text-xs text-ink-sub">
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

      {creating && (
        <CreateDialog
          name={roomName}
          visibility={visibility}
          onName={setRoomName}
          onVisibility={setVisibility}
          onCancel={() => setCreating(false)}
          onConfirm={create}
        />
      )}
    </main>
  )
}

function CreateDialog({
  name,
  visibility,
  onName,
  onVisibility,
  onCancel,
  onConfirm,
}: {
  name: string
  visibility: RoomVisibility
  onName: (v: string) => void
  onVisibility: (v: RoomVisibility) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  // Overlay 自己只关住 Tab，Esc 要在这里补——模态没有 Esc 会让键盘用户走不掉
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <Overlay label="新建房间">
      <OverlayMark />
      <div className="w-full text-left" style={{ maxWidth: 'calc(420 * var(--u))' }}>
        <h2
          className="text-2xs font-semibold text-primary"
          style={{ letterSpacing: 'var(--tracking-title)' }}
        >
          シンキ / NEW ROOM
        </h2>

        <div className="mt-4">
          <Field
            type="text"
            value={name}
            onChange={(e) => onName(e.target.value.slice(0, ROOM_NAME_MAX * 2))}
            placeholder="房间名（留空则用你的昵称）"
            aria-label="房间名"
            maxLength={ROOM_NAME_MAX * 2}
          />
        </div>

        <VisibilityChoice value={visibility} onChange={onVisibility} />

        <div className="mt-7 flex flex-col" style={{ gap: 'calc(10 * var(--u))' }}>
          <Button variant="primary" size="lg" full onClick={onConfirm}>
            创建
          </Button>
          <button
            type="button"
            onClick={onCancel}
            className="tap-line self-start text-xs text-ink-faint transition-colors hover:text-primary"
            style={{ letterSpacing: 'var(--tracking-base)' }}
          >
            取消
          </button>
        </div>
      </div>
    </Overlay>
  )
}
