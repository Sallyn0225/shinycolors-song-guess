import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DIFFICULTY_PRESETS,
  KARUTA_DEFAULTS,
  ROOM_LIST_MAX,
  ROOM_NAME_MAX,
  sanitizeRoomName,
  type LobbyLimits,
  type RoomSummary,
  type RoomVisibility,
} from '@scg/shared'

import { RoomCard } from '../components/RoomCard'
import { LanguageSwitch } from '../components/LanguageSwitch'
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
  allowPrivate,
  limits,
  publicCount,
  privateTotal,
}: {
  value: RoomVisibility
  onChange: (v: RoomVisibility) => void
  /** 服务端下发的开关。false 只是把私人项置灰（UX），真正的拒绝在服务端 */
  allowPrivate: boolean
  limits: LobbyLimits | null
  publicCount: number
  privateTotal: number
}) {
  const { t } = useTranslation()
  const publicFull = limits !== null && publicCount >= limits.publicMax
  const privateFull = limits !== null && allowPrivate && privateTotal >= limits.privateMax

  const publicHint =
    limits === null
      ? t('lobby.publicDesc')
      : publicFull
        ? allowPrivate
          ? `公开房间已满（${publicCount}/${limits.publicMax}），可以创建私人房间`
          : `公开房间已满（${publicCount}/${limits.publicMax}），稍后再试`
        : `出现在大厅列表里，谁都能进（${publicCount}/${limits.publicMax}）`

  const privateHint = !allowPrivate
    ? '本站已关闭私人房间'
    : limits === null
      ? t('lobby.privateDesc')
      : privateFull
        ? `私人房间已满（${privateTotal}/${limits.privateMax}），稍后再试`
        : `不进列表，只有拿到房间码的人能进（${privateTotal}/${limits.privateMax}）`

  const OPTIONS: { v: RoomVisibility; label: string; hint: string; disabled: boolean; full: boolean }[] = [
    {
      v: 'public',
      label: t('lobby.public'),
      hint: publicHint,
      disabled: false,
      full: publicFull,
    },
    {
      v: 'private',
      label: t('lobby.private'),
      hint: privateHint,
      disabled: !allowPrivate,
      full: privateFull,
    },
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
        {OPTIONS.map((o) => {
          const dimmed = o.disabled || o.full
          return (
            <label
              key={o.v}
              className={
                o.disabled
                  ? 'cut-shadow-sm block opacity-60'
                  : dimmed
                    ? 'cut-shadow-sm block opacity-60 cursor-pointer'
                    : 'cut-shadow-sm block cursor-pointer'
              }
            >
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
                  disabled={o.disabled}
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
          )
        })}
      </div>
    </fieldset>
  )
}

export function Lobby({ onBack }: Props) {
  const { t } = useTranslation()
  const [nickname, setNickname] = useState(readNickname)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [connected, setConnected] = useState(() => socket.connected)
  const [rtt, setRtt] = useState<number | null>(null)

  const [rooms, setRooms] = useState<RoomSummary[] | null>(null)
  const [waitingTotal, setWaitingTotal] = useState(0)
  const [busyTotal, setBusyTotal] = useState(0)
  /** 私人房间只以数量出现在协议里 —— 看不到条目，但占用要数得出来 */
  const [privateTotal, setPrivateTotal] = useState(0)
  /** null = 还没收到过 roomList。按 null 走保守分支：未知不等于禁止 */
  const [limits, setLimits] = useState<LobbyLimits | null>(null)

  const [creating, setCreating] = useState(false)
  const [roomName, setRoomName] = useState('')
  const [visibility, setVisibility] = useState<RoomVisibility>('public')

  const creatingRef = useRef(false)
  creatingRef.current = creating

  const submittingRef = useRef(false)
  submittingRef.current = submitting

  useEffect(() => {
    const subscribe = () => socket.send({ t: 'rooms', subscribe: true })

    const offStatus = socket.onStatus((c) => {
      setConnected(c)
      if (!c) {
        submittingRef.current = false
        setSubmitting(false)
      }
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
        setPrivateTotal(msg.privateTotal)
        setLimits(msg.limits)
      } else if (msg.t === 'error') {
        submittingRef.current = false
        setSubmitting(false)
        if (creatingRef.current) {
          setCreateError(msg.message)
        } else {
          setError(msg.message)
        }
      } else if (msg.t === 'room') {
        submittingRef.current = false
        setSubmitting(false)
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
    const v = nickname.trim() || t('common.defaultPlayer')
    writeNickname(nickname.trim())
    return v
  }

  const create = () => {
    if (submittingRef.current || !connected) return
    submittingRef.current = true
    setSubmitting(true)
    setError(null)
    setCreateError(null)
    const name = sanitizeRoomName(roomName)
    void withAudio(() =>
      socket.send({
        t: 'createRoom',
        nickname: nick(),
        ...(name ? { name } : {}),
        // 私人房关闭时不许留着一个选中却提交不出去的选项；
        // 发出去的永远是服务端会接受的那一个
        visibility: effectiveVisibility,
      }),
    )
  }

  const cancelCreate = useCallback(() => {
    setCreating(false)
    setCreateError(null)
    submittingRef.current = false
    setSubmitting(false)
  }, [])

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
  /** 上限未知（首帧）时不禁止私人 —— 置灰一个其实开着的选项更糟 */
  const effectiveVisibility: RoomVisibility = limits !== null && !limits.allowPrivate ? 'public' : visibility

  return (
    <main
      className="mx-auto flex min-h-safe w-full flex-col px-6 py-14 sm:px-10"
      style={{ maxWidth: 'var(--page-narrow)' }}
    >
      <div className="flex items-center justify-between pb-6">
        <button
          type="button"
          onClick={onBack}
          className="tap-line text-xs text-ink-faint transition-colors hover:text-primary"
          style={{ letterSpacing: 'var(--tracking-base)' }}
        >
          {t('common.back')}
        </button>
        <LanguageSwitch />
      </div>

      {/* 组一「这是什么」。与首页同构：标题居中，说明贴着它，光带作为与操作区的界线 */}
      <header className="anim-appear text-center">
        <HeroTitle brand="Versus" title={t('start.versusTitle')} />
        <p className="jp-wrap mx-auto mt-5 text-sm leading-relaxed text-ink-sub">
          {t('lobby.desc')}
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
            {t('common.nickname')}
          </span>
          <span className="mt-2 block">
            <Field
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value.slice(0, 16))}
              onBlur={() => writeNickname(nickname.trim())}
              // 这是真实行为（nick() 里 `nickname.trim() || '玩家'`），
              // 原来只写在代码里，玩家要留空提交一次才知道
              placeholder={t('lobby.nicknamePlaceholder')}
            />
          </span>
        </label>
        <Button
          variant="primary"
          size="lg"
          full
          onClick={() => {
            setError(null)
            setCreateError(null)
            setCreating(true)
          }}
          disabled={!connected}
        >
          {t('lobby.createRoom')}
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
          {t('room.roomCode')}
        </span>
        <div className="mt-2 flex items-stretch gap-3">
          <div className="min-w-0 flex-1">
            <Field
              type="text"
              code
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
              placeholder={t('lobby.roomCodeExample')}
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
            {t('lobby.enter')}
          </Button>
        </div>
        {/* 「加入」在填满 6 位之前是灰的，不说一句就只能靠试。
            格式要求要在提交之前给出，不是提交之后 */}
        <p id="code-hint" className="mt-2 text-2xs text-ink-faint">
          {t('lobby.roomCodePlaceholder')}
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
          {t('lobby.roomsHeading')}
        </h2>
        <p className="text-2xs text-ink-faint" style={{ letterSpacing: 'var(--tracking-base)' }}>
          {limits !== null && (
            <>
              {/* 占用与上限是一行，等人/进行中是另一行：可见性和能不能加入是两个维度 */}
              {t('lobby.publicCount', { count: waitingTotal + busyTotal, max: limits.publicMax })} ·{' '}
              {limits.allowPrivate
                ? t('lobby.privateCount', { count: privateTotal, max: limits.privateMax })
                : t('lobby.privateClosedLabel')}
              <br />
            </>
          )}
          {t('lobby.waitingBusy', { waiting: waitingTotal, busy: busyTotal })}
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
          ? t('lobby.listDisconnected')
          : rooms === null
            ? t('lobby.loadingRooms')
            : limits === null
              ? t('lobby.publicRoomsSummary', { rooms: rooms.length, waiting: waitingTotal, busy: busyTotal })
              : limits.allowPrivate
                ? t('lobby.roomLimitsSummary', { publicRooms: waitingTotal + busyTotal, publicMax: limits.publicMax, privateRooms: privateTotal, privateMax: limits.privateMax, waiting: waitingTotal, busy: busyTotal })
                : t('lobby.roomLimitsPrivateClosedSummary', { publicRooms: waitingTotal + busyTotal, publicMax: limits.publicMax, waiting: waitingTotal, busy: busyTotal })}
      </p>

      <div className="mt-5 flex flex-col" style={{ gap: 'calc(8 * var(--u))' }}>
        {rooms === null ? (
          <p className="text-sm text-ink-faint">{connected ? t('lobby.loadingRoomsShort') : t('lobby.connectingShort')}</p>
        ) : rooms.length === 0 ? (
          <p className="text-sm text-ink-faint">{t('lobby.noRooms')}</p>
        ) : (
          <>
            {/* 断线时列表还挂在屏幕上，但它已经是旧的了 —— 要说出来，不能让人对着它乱点 */}
            {!connected && (
              <p className="text-2xs text-ink-sub">{t('lobby.disconnectedList')}</p>
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
            {t('lobby.hiddenRooms', { hidden, max: ROOM_LIST_MAX })}
          </p>
        )}
      </div>

      {/* ── 组四「规则」 ───────────────────────────── */}
      <h2
        className="mt-12 text-2xs font-semibold text-primary"
        style={{ letterSpacing: 'var(--tracking-title)' }}
      >
        {t('lobby.howToPlayHeading')}
      </h2>
      {/*
        这一段是 InfoModal 指过来的那份「完整规则」，所以它得真的完整。
        原来只讲了 空札 与 自陣：送り札 一次都没出现、お手つき 只被点名没说后果、
        決まり字 更是全站没有任何地方解释过 —— 而那三样正是这套玩法与别处不同的地方。
        照着 app 自己的指示走过来的人，不该在这里发现规则不在。
      */}
      <p className="jp-wrap mt-4 text-sm leading-relaxed text-ink-sub">
        {t('lobby.ruleIntro', { poolSize: KARUTA_DEFAULTS.poolSize, fieldCards: KARUTA_DEFAULTS.fieldCards, ownCards: KARUTA_DEFAULTS.ownCards, karafuda: KARUTA_DEFAULTS.karafuda })}
      </p>
      <dl className="jp-wrap mt-4 flex flex-col gap-2 text-sm leading-relaxed text-ink-sub">
        <div>
          <dt className="inline font-bold text-ink" lang="ja">
            決まり字
          </dt>
          {/* 作用域是「当前牌场」不是整个曲库，见 features/kimariji.ts。
              写成「这首歌的开头」就是错的：同样的曲名换一副牌场，长度会变 */}
          <dd className="inline">{' '}—— {t('lobby.ruleKimariji')}</dd>
        </div>
        <div>
          <dt className="inline font-bold text-ink" lang="ja">
            送り札
          </dt>
          {/* 账面照 packages/game-core/src/karuta.ts 的注释写：
              敵陣 -1（被取走）+1（收到送札）= 0，自陣 -1。
              「取敵陣值两枚」说的是节奏和挑牌权，不是牌数 —— 别在这里许一个假的收益 */}
          <dd className="inline">{' '}—— {t('lobby.ruleOkuri')}</dd>
        </div>
        <div>
          <dt className="inline font-bold text-ink" lang="ja">
            お手つき
          </dt>
          <dd className="inline">{' '}—— {t('lobby.ruleOtetsuki')}</dd>
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
        <Stat label={t('lobby.perRound')} value={`${KARUTA_DEFAULTS.roundWindowSeconds}s`} />
        <Stat label={t('lobby.memorize')} value={`${KARUTA_DEFAULTS.memorizeSeconds}s`} />
        <Stat label={t('lobby.difficulty')} value={t(`start.${KARUTA_DEFAULTS.difficulty}Label`)} />
      </dl>

      <p role="status" aria-live="polite" className="mt-6 flex items-center gap-2 text-xs text-ink-sub">
        <Presence online={connected} />
        {connected ? (rtt != null ? t('lobby.connectedRtt', { rtt }) : t('lobby.connected')) : t('lobby.connectingShort')}
      </p>

      <button
        type="button"
        onClick={onBack}
        className="tap-line mt-7 self-start text-xs text-ink-faint transition-colors hover:text-primary"
        style={{ letterSpacing: 'var(--tracking-base)' }}
      >
        {t('common.back')}
      </button>

      {creating && (
        <CreateDialog
          name={roomName}
          visibility={visibility}
          limits={limits}
          publicCount={waitingTotal + busyTotal}
          privateTotal={privateTotal}
          submitting={submitting}
          error={createError}
          connected={connected}
          onName={setRoomName}
          onVisibility={setVisibility}
          onCancel={cancelCreate}
          onConfirm={create}
        />
      )}
    </main>
  )
}

function CreateDialog({
  name,
  visibility,
  limits,
  publicCount,
  privateTotal,
  submitting,
  error,
  connected,
  onName,
  onVisibility,
  onCancel,
  onConfirm,
}: {
  name: string
  visibility: RoomVisibility
  limits: LobbyLimits | null
  publicCount: number
  privateTotal: number
  submitting: boolean
  error: string | null
  connected: boolean
  onName: (v: string) => void
  onVisibility: (v: RoomVisibility) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  const allowPrivate = limits === null || limits.allowPrivate

  // Overlay 自己只关住 Tab，Esc 要在这里补——模态没有 Esc 会让键盘用户走不掉
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <Overlay label={t('lobby.createRoom')}>
      <OverlayMark />
      <div className="w-full text-left" style={{ maxWidth: 'calc(420 * var(--u))' }}>
        <h2
          className="text-2xs font-semibold text-primary"
          style={{ letterSpacing: 'var(--tracking-title)' }}
        >
          {t('lobby.newRoomHeading')}
        </h2>

        {/* 与大厅那两个框同一条规矩：标签常驻，占位文字说真实行为 */}
        <label className="mt-4 block">
          <span
            className="text-2xs font-semibold text-primary"
            style={{ letterSpacing: 'var(--tracking-title)' }}
          >
            {t('lobby.roomName')}
          </span>
          <span className="mt-2 block">
            <Field
              type="text"
              value={name}
              onChange={(e) => onName(e.target.value.slice(0, ROOM_NAME_MAX * 2))}
              placeholder={t('lobby.roomNamePlaceholder')}
              maxLength={ROOM_NAME_MAX * 2}
            />
          </span>
        </label>

        <VisibilityChoice
          value={allowPrivate ? visibility : 'public'}
          onChange={onVisibility}
          allowPrivate={allowPrivate}
          limits={limits}
          publicCount={publicCount}
          privateTotal={privateTotal}
        />

        <div className="mt-7 flex flex-col" style={{ gap: 'calc(10 * var(--u))' }}>
          <Button
            variant="primary"
            size="lg"
            full
            onClick={onConfirm}
            disabled={!connected || submitting}
            aria-busy={submitting}
          >
            {submitting ? t('lobby.creating') : t('lobby.create')}
          </Button>

          {error && (
            <p
              role="alert"
              className="cut-slant relative px-5 py-3 text-sm text-wrong"
              style={{ background: 'var(--surface-alert)' }}
            >
              <span
                aria-hidden
                className="cut-ring cut-ring-slant"
                style={
                  { '--ring': '1px', '--ring-color': 'var(--color-wrong)' } as React.CSSProperties
                }
              />
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={onCancel}
            className="tap-line self-start text-xs text-ink-faint transition-colors hover:text-primary"
            style={{ letterSpacing: 'var(--tracking-base)' }}
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </Overlay>
  )
}
