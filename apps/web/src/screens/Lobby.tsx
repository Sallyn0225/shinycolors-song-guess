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
        lang="ja"
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
      className="mx-auto flex min-h-safe w-full flex-col px-6 py-14 sm:px-10"
      style={{ maxWidth: 'var(--page-narrow)' }}
    >
      {/* 组一「这是什么」。与首页同构：标题居中，说明贴着它，光带作为与操作区的界线 */}
      <header className="anim-appear text-center">
        <HeroTitle brand="Versus" title={<>1v1 <span lang="ja">空札領地戦</span></>} />
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
      {/*
        标签是常驻的，不拿 placeholder 顶替 —— placeholder 是**例子**不是标签，
        一开始打字它就没了，而这两个框恰好都要边填边核对（昵称对手会看到、
        房间码是别人念给你的）。占位文字腾出来说真正没写在别处的事：
        昵称留空会显示什么、房间码是几位从哪来。
      */}
      <div className="mt-10 flex flex-col" style={{ gap: 'calc(12 * var(--u))' }}>
        <label className="block">
          <span
            className="text-2xs font-semibold text-primary"
            style={{ letterSpacing: 'var(--tracking-title)' }}
          >
            昵称
          </span>
          <span className="mt-2 block">
            <Field
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value.slice(0, 16))}
              onBlur={() => writeNickname(nickname.trim())}
              // 这是真实行为（nick() 里 `nickname.trim() || '玩家'`），
              // 原来只写在代码里，玩家要留空提交一次才知道
              placeholder="留空则显示「玩家」"
            />
          </span>
        </label>
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

      <div className="mt-5">
        {/*
          标签不用 <label> 包整行：里面还有「加入」按钮，
          而 label 的激活行为会把点击转给它标注的那个控件。
          改用 aria-labelledby / aria-describedby 显式关联。
        */}
        <span
          id="code-label"
          className="text-2xs font-semibold text-primary"
          style={{ letterSpacing: 'var(--tracking-title)' }}
        >
          房间码
        </span>
        <div className="mt-2 flex items-stretch gap-3">
          <div className="min-w-0 flex-1">
            <Field
              type="text"
              code
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
              placeholder="ABC123"
              aria-labelledby="code-label"
              aria-describedby="code-hint"
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
        {/* 「加入」在填满 6 位之前是灰的，不说一句就只能靠试。
            格式要求要在提交之前给出，不是提交之后 */}
        <p id="code-hint" className="mt-2 text-2xs text-ink-faint">
          朋友发给你的 6 位房间码，填满 6 位后「加入」才可点。
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="cut-slant relative mt-5 px-5 py-3 text-sm text-wrong"
          style={{ background: 'var(--surface-alert)' }}
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
          <span lang="ja">ルーム</span> / ROOMS
        </h2>
        <p className="text-2xs text-ink-faint" style={{ letterSpacing: 'var(--tracking-base)' }}>
          等人 {waitingTotal} · 进行中 {busyTotal}
        </p>
      </div>

      {/*
        播报交给下面那行 sr-only 摘要，列表容器本身不再是 live region。
        原来整份列表挂着 role="status"：房间一有变动就会把最多 8 条双行条目
        整个念一遍，而且 live region 里还嵌着可聚焦的按钮 —— 两件事都是反模式。
        真正需要被播报的是「现在有几间可进」，不是每间房的全文。
      */}
      <p className="sr-only" role="status" aria-live="polite">
        {!connected
          ? '连接已断开，列表可能不是最新的'
          : rooms === null
            ? '正在获取房间列表'
            : rooms.length === 0
              ? '暂时没有公开房间'
              : `公开房间 ${rooms.length} 间，等人 ${waitingTotal} 间，进行中 ${busyTotal} 间`}
      </p>

      <div className="mt-5 flex flex-col" style={{ gap: 'calc(8 * var(--u))' }}>
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
        <span lang="ja">アソビカタ</span> / HOW TO PLAY
      </h2>
      {/*
        这一段是 InfoModal 指过来的那份「完整规则」，所以它得真的完整。
        原来只讲了 空札 与 自陣：送り札 一次都没出现、お手つき 只被点名没说后果、
        決まり字 更是全站没有任何地方解释过 —— 而那三样正是这套玩法与别处不同的地方。
        照着 app 自己的指示走过来的人，不该在这里发现规则不在。
      */}
      <p className="jp-wrap mt-4 text-sm leading-relaxed text-ink-sub">
        从 {LIBRARY.songs} 首里抽 {KARUTA_DEFAULTS.poolSize} 首：{KARUTA_DEFAULTS.fieldCards}{' '}
        首摊在场上（每人<span lang="ja">自陣</span>{' '}
        {KARUTA_DEFAULTS.ownCards} 张），另 {KARUTA_DEFAULTS.karafuda} 首是
        <b lang="ja" className="font-bold text-ink">
          空札
        </b>
        {/* 这个 {' '} 不能省：JSX 会把元素后换行缩进的前导空白吃掉，
            渲染出来是「空札—— 只会」，破折号贴着术语 */}
        {' '}
        —— 只会被播放、场上没有对应的牌。先清空<span lang="ja">自陣</span>者胜。
      </p>
      <dl className="jp-wrap mt-4 flex flex-col gap-2 text-sm leading-relaxed text-ink-sub">
        <div>
          <dt className="inline font-bold text-ink" lang="ja">
            決まり字
          </dt>
          {/* 作用域是「当前牌场」不是整个曲库，见 features/kimariji.ts。
              写成「这首歌的开头」就是错的：同样的曲名换一副牌场，长度会变 */}
          <dd className="inline">
            {' '}
            —— 牌上加粗的那个词头，是在<b className="font-semibold">场上这些牌里</b>
            认出它所需的最短开头。听到这几个字就能下手，不必等整句。
          </dd>
        </div>
        <div>
          <dt className="inline font-bold text-ink" lang="ja">
            送り札
          </dt>
          {/* 账面照 packages/game-core/src/karuta.ts 的注释写：
              敵陣 -1（被取走）+1（收到送札）= 0，自陣 -1。
              「取敵陣值两枚」说的是节奏和挑牌权，不是牌数 —— 别在这里许一个假的收益 */}
          <dd className="inline">
            {' '}
            —— 抢到<span lang="ja">敵陣</span>的牌时，要从自己这边挑一张送过去。
            你少一张，对手一走一来张数不变；赚的是挑牌权：把最难记的那张丢给他。
          </dd>
        </div>
        <div>
          <dt className="inline font-bold text-ink" lang="ja">
            お手つき
          </dt>
          <dd className="inline">
            {' '}
            —— 点错牌、点了<span lang="ja">空札</span>，或者抢在能听清之前就点。
            罚则反过来：由对手挑一张送给你。
          </dd>
        </div>
      </dl>

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
          <span lang="ja">シンキ</span> / NEW ROOM
        </h2>

        {/* 与大厅那两个框同一条规矩：标签常驻，占位文字说真实行为 */}
        <label className="mt-4 block">
          <span
            className="text-2xs font-semibold text-primary"
            style={{ letterSpacing: 'var(--tracking-title)' }}
          >
            房间名
          </span>
          <span className="mt-2 block">
            <Field
              type="text"
              value={name}
              onChange={(e) => onName(e.target.value.slice(0, ROOM_NAME_MAX * 2))}
              placeholder="留空则用你的昵称"
              maxLength={ROOM_NAME_MAX * 2}
            />
          </span>
        </label>

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
