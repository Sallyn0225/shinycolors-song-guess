import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DIFFICULTY_PRESETS,
  KARUTA_DEFAULTS,
  type CardId,
  type CardView,
  type MatchStats,
  type MatchView,
  type PlayerId,
  type RoundResultView,
  type ServerMsg,
} from '@scg/shared'

import { audio } from '../audio'
import { socket } from '../net/ws'
import { KarutaTile, type CardPick, type CardState } from '../components/KarutaTile'
import { SlotMap } from '../features/karutaBoard'
import { computeKimariji } from '../features/kimariji'
import { narrateRound } from '../features/narrate'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { Overlay, OverlayMark } from '../ui/Overlay'
import { PrismRail } from '../ui/PrismRail'

interface Props {
  /** matchStart 的内容由 App 传下来 —— 本组件挂载时那条消息已经过去了 */
  initialMatch: MatchView
  memorizeEndsAtServer: number
  /** 这一局是断线/刷新后接回来的，不是从大厅正常开始的 */
  resumed: boolean
  onExit: () => void
}

type Stage = 'memorize' | 'waiting' | 'live' | 'choosing' | 'reveal' | 'over'

type RevealMsg = Extract<ServerMsg, { t: 'roundReveal' }>

const OTHER: Record<PlayerId, PlayerId> = { A: 'B', B: 'A' }
const CLIP_SECONDS = DIFFICULTY_PRESETS[KARUTA_DEFAULTS.difficulty].clipSeconds

export function Karuta({ initialMatch, memorizeEndsAtServer, resumed, onExit }: Props) {
  const [match, setMatch] = useState<MatchView | null>(initialMatch)
  // 接回来的对局多半已经在打了，别一进来就摆出记忆阶段的界面
  const [stage, setStage] = useState<Stage>(() =>
    initialMatch.phase === 'memorize' ? 'memorize' : initialMatch.phase === 'over' ? 'over' : 'waiting',
  )
  const [result, setResult] = useState<RoundResultView | null>(null)
  const [ended, setEnded] = useState<{ winner: PlayerId | null; stats: MatchStats } | null>(null)
  const [memorizeLeft, setMemorizeLeft] = useState<number>(KARUTA_DEFAULTS.memorizeSeconds)
  const [selected, setSelected] = useState<number | null>(null)
  const [locked, setLocked] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  /** 我这一回合点的牌。本地立刻标出来，不等服务端回包 */
  const [myPick, setMyPick] = useState<CardId | null>(null)
  const [rematchVotes, setRematchVotes] = useState<PlayerId[]>([])
  /** 送り札阶段：服务端先揭晓答案，再等人挑牌 */
  const [reveal, setReveal] = useState<RevealMsg | null>(null)
  const [okuriPicks, setOkuriPicks] = useState<CardId[]>([])
  const [okuriLeft, setOkuriLeft] = useState(0)
  const okuriSent = useRef(false)
  /** 自己的连接状态。断了就整屏挡住——这时点什么都到不了服务器 */
  const [online, setOnline] = useState(() => socket.connected)
  /** 对手掉线时服务端给的宽限终点 */
  const [peerGraceEnds, setPeerGraceEnds] = useState<number | null>(null)
  const [peerGraceLeft, setPeerGraceLeft] = useState(0)
  /**
   * 刷新后 AudioContext 是锁着的，而解锁只能发生在真实用户手势的调用栈里。
   * 不补这一下，接回来的人整局都是静音的——而且本地热重载永远复现不了。
   */
  const [needGesture, setNeedGesture] = useState(() => resumed && !audio.unlocked)

  const startedAtCtx = useRef(0)
  const roundNoRef = useRef(0)
  const tappedRef = useRef(false)
  /** roundArm 给的 token/url，roundStart 时要复用同一个已解码的 buffer */
  const armed = useRef<{ roundNo: number; token: string; url: string; fallbackUrl?: string } | null>(null)
  const slotsRef = useRef<SlotMap | null>(null)
  const enemySlotsRef = useRef<SlotMap | null>(null)
  const [, forceRender] = useState(0)

  const boardRef = useRef<HTMLDivElement>(null)
  const endDialogRef = useRef<HTMLDivElement>(null)
  /** 本回合的起播时刻与窗口，供光带的 rAF 每帧取剩余比例 */
  const roundEndsAt = useRef(0)
  /** 挑送り札的截止时刻，同样喂给光带 */
  const okuriEndsAt = useRef(0)
  const stageRef = useRef<Stage>(stage)
  stageRef.current = stage

  const me = match?.you ?? 'A'
  const foe = OTHER[me]

  const cardById = useMemo(() => {
    const m = new Map<CardId, CardView>()
    for (const c of match?.cards ?? []) m.set(c.cardId, c)
    return m
  }, [match])

  // 決まり字只在当前牌场范围内计算 —— 场上只有 24 张，通常 1~3 个字就够
  const kimariji = useMemo(() => {
    const titles = (match?.cards ?? []).filter((c) => c.owner !== null).map((c) => c.title)
    return computeKimariji(titles)
  }, [match])

  const syncSlots = useCallback((m: MatchView) => {
    const you = m.you
    const other = OTHER[you]
    if (!slotsRef.current) slotsRef.current = new SlotMap(KARUTA_DEFAULTS.ownCards, m.layout[you])
    if (!enemySlotsRef.current) enemySlotsRef.current = new SlotMap(KARUTA_DEFAULTS.ownCards, m.layout[other])
    slotsRef.current.sync(m.layout[you])
    enemySlotsRef.current.sync(m.layout[other])
  }, [])

  /**
   * 光带每帧问它：本回合还剩多少。
   * 只有 live 在收；memorize / waiting 保持满 —— 这条光带同时是两阵之间的界线，
   * 不在计时的时候把它熄掉，「场」就没了。判定结束（reveal/choosing/over）才归零。
   */
  const getRoundRemaining = useCallback(() => {
    const st = stageRef.current
    if (st === 'memorize' || st === 'waiting') return 1
    // 挑送り札的 10 秒是全局最紧的一个计时，到点服务端就替你送。
    // 光带在这套设计里就是计时器官（THESIS：「它同时是倒计时」），
    // 这一段不交给它、只写一行静态文案，等于把器官关掉。
    if (st === 'choosing') {
      const total = KARUTA_DEFAULTS.okuriSeconds * 1000
      const left = okuriEndsAt.current - performance.now()
      return total > 0 ? Math.max(0, Math.min(1, left / total)) : 0
    }
    if (st !== 'live') return 0
    const left = roundEndsAt.current - performance.now()
    return Math.max(0, Math.min(1, left / (CLIP_SECONDS * 1000)))
  }, [])

  // ── 消息处理 ─────────────────────────────────────────
  useEffect(() => {
    const off = socket.on((msg) => {
      switch (msg.t) {
        case 'matchStart':
          setMatch(msg.match)
          syncSlots(msg.match)
          setStage('memorize')
          setEnded(null)
          setResult(null)
          break

        case 'stateSync':
          setMatch(msg.match)
          syncSlots(msg.match)
          // 带 round 的 stateSync 只在重连时出现：本回合的音频我没听到，
          // 服务端也不会补发，直接回到「等下一札」，别停在半截的界面上
          if (msg.round) {
            setStage('waiting')
            setResult(null)
            setReveal(null)
            setMyPick(null)
            setLocked(false)
          }
          break

        case 'roundArm': {
          roundNoRef.current = msg.roundNo
          tappedRef.current = false
          armed.current = {
            roundNo: msg.roundNo,
            token: msg.clipToken,
            url: msg.url,
            fallbackUrl: msg.fallbackUrl,
          }
          setResult(null)
          setMyPick(null)
          setStage('waiting')
          // 先把音频完全解码好再回 ready，把下载解码耗时挪出比赛计时之外
          void audio
            .prefetch(msg.clipToken, msg.url, msg.fallbackUrl)
            .catch(() => {})
            .finally(() => socket.send({ t: 'clipReady', roundNo: msg.roundNo }))
          break
        }

        case 'roundStart': {
          const a = armed.current
          if (!a || a.roundNo !== msg.roundNo) break
          setStage('live')
          setLocked(false)
          // 双方按同步过的时钟换算出同一个起播时刻，
          // 这样比较「相对起播的反应时间」才有意义
          const startLocal = socket.toLocalTime(msg.startAtServerTime)
          roundEndsAt.current = performance.now() + (startLocal - Date.now()) + CLIP_SECONDS * 1000
          const at = audio.ctxTimeFor(startLocal)
          void audio
            .play(a.token, a.url, CLIP_SECONDS, at, a.fallbackUrl)
            .then(({ startedAtCtxTime }) => {
              startedAtCtx.current = startedAtCtxTime
            })
            .catch(() => {})
          break
        }

        // 只在有人要挑送り札时才会先来这条：答案先揭晓，牌面变化等挑完再说
        case 'roundReveal':
          setReveal(msg)
          setOkuriPicks([])
          okuriSent.current = false
          setStage('choosing')
          audio.stop()
          break

        case 'roundResult':
          setResult(msg.result)
          setReveal(null)
          setMatch(msg.match)
          syncSlots(msg.match)
          setStage('reveal')
          audio.stop()
          break

        case 'matchEnd':
          setEnded({ winner: msg.winner, stats: msg.stats })
          setMatch(msg.match)
          setStage('over')
          setRematchVotes([])
          audio.stop()
          break

        case 'rematchState':
          setRematchVotes(msg.votes)
          break

        case 'peer':
          setPeerGraceEnds(msg.online ? null : (msg.graceEndsAtServer ?? null))
          if (msg.online) {
            setToast('对手已重连')
            window.setTimeout(() => setToast(null), 3000)
          }
          break

        default:
          break
      }
    })
    return off
  }, [syncSlots])

  // 初始牌面的槽位要立刻建立，否则第一帧是空的
  useEffect(() => {
    syncSlots(initialMatch)
    forceRender((n) => n + 1)
  }, [initialMatch, syncSlots])

  // 记忆阶段倒计时。按服务器给的结束时刻算，双方看到的秒数一致
  useEffect(() => {
    if (stage !== 'memorize') return
    const endsLocal = socket.toLocalTime(memorizeEndsAtServer)
    const tick = () => setMemorizeLeft(Math.max(0, Math.ceil((endsLocal - Date.now()) / 1000)))
    tick()
    const t = window.setInterval(tick, 250)
    return () => window.clearInterval(t)
  }, [stage, memorizeEndsAtServer])

  // 自己的连接状态
  useEffect(() => {
    setOnline(socket.connected)
    return socket.onStatus(setOnline)
  }, [])

  /**
   * 有遮罩时把牌场整个 inert 掉。
   * 不这么做的话，88% 不透明的遮罩背后那 24 张牌的按钮仍留在 tab 序列里，
   * 键盘用户要先穿过两打看不见的按钮才能够到遮罩里仅剩的那两个操作。
   */
  const blocked = !online || needGesture || stage === 'over'
  useEffect(() => {
    const el = boardRef.current
    if (!el) return
    if (blocked) el.setAttribute('inert', '')
    else el.removeAttribute('inert')
  }, [blocked])

  // 结算浮层：进入时把焦点带进去，并关在里面
  useEffect(() => {
    const root = endDialogRef.current
    if (!root || !(stage === 'over' && ended)) return
    const list = () =>
      [...root.querySelectorAll<HTMLElement>('button:not([disabled])')]
    list()[0]?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const items = list()
      if (!items.length) return
      const head = items[0] as HTMLElement
      const tail = items[items.length - 1] as HTMLElement
      if (e.shiftKey && document.activeElement === head) {
        e.preventDefault()
        tail.focus()
      } else if (!e.shiftKey && document.activeElement === tail) {
        e.preventDefault()
        head.focus()
      }
    }
    root.addEventListener('keydown', onKey)
    return () => root.removeEventListener('keydown', onKey)
  }, [stage, ended])

  // 对手掉线的宽限倒计时。到点判负，所以得让人看到还要等多久
  useEffect(() => {
    if (peerGraceEnds === null) return
    const endsLocal = socket.toLocalTime(peerGraceEnds)
    const tick = () => setPeerGraceLeft(Math.max(0, Math.ceil((endsLocal - Date.now()) / 1000)))
    tick()
    const t = window.setInterval(tick, 500)
    return () => window.clearInterval(t)
  }, [peerGraceEnds])

  // 挑送り札的倒计时。到点服务端会替我送「自陣待得最久的那张」，所以必须让人看到还剩多久
  useEffect(() => {
    if (stage !== 'choosing' || !reveal) return
    const endsLocal = socket.toLocalTime(reveal.deadlineAtServer)
    okuriEndsAt.current = performance.now() + (endsLocal - Date.now())
    const tick = () => setOkuriLeft(Math.max(0, Math.ceil((endsLocal - Date.now()) / 1000)))
    tick()
    const t = window.setInterval(tick, 200)
    return () => window.clearInterval(t)
  }, [stage, reveal])

  // ── 交互 ─────────────────────────────────────────────

  /** 本回合轮到我挑几张送り札、能从哪些牌里挑。null = 这回合不用我挑 */
  const myOkuri = reveal?.pending.find((p) => p.player === me) ?? null
  const okuriDone = myOkuri !== null && okuriPicks.length >= myOkuri.count

  const chooseOkuri = (cardId: CardId) => {
    if (!reveal || !myOkuri || okuriSent.current) return
    if (!myOkuri.candidates.includes(cardId) || okuriPicks.includes(cardId)) return
    const next = [...okuriPicks, cardId]
    setOkuriPicks(next)
    if (next.length >= myOkuri.count) {
      okuriSent.current = true
      socket.send({ t: 'okuri', roundNo: reveal.roundNo, cardIds: next })
    }
  }

  /** 记忆阶段：点 A 再点 B 交换位置。比拖拽简单得多，也天然支持键盘 */
  const onOwnCardClick = (slot: number, e: React.MouseEvent) => {
    if (stage === 'choosing') {
      const id = slotsRef.current?.view[slot]
      if (id) chooseOkuri(id)
      return
    }
    if (stage === 'memorize') {
      const slots = slotsRef.current
      if (!slots) return
      if (selected === null) setSelected(slot)
      else {
        slots.swap(selected, slot)
        setSelected(null)
        socket.send({ t: 'layout', order: slots.order })
        forceRender((n) => n + 1)
      }
      return
    }
    tap(slot, false, e)
  }

  const tap = (slot: number, enemy: boolean, e: React.MouseEvent) => {
    if (stage !== 'live' || tappedRef.current || locked) return
    const map = enemy ? enemySlotsRef.current : slotsRef.current
    const cardId = map?.view[slot]
    if (!cardId) return

    // 用「听到的时刻」而不是 currentTime —— 蓝牙耳机有 150~300ms 输出延迟，
    // 用调度时钟会让戴蓝牙的人输掉所有接近的回合
    const reactionMs = audio.reactionMsSince(startedAtCtx.current, e.nativeEvent.timeStamp)
    tappedRef.current = true
    setLocked(true)
    setMyPick(cardId) // 立刻标出来，不等服务端回包
    socket.send({
      t: 'tap',
      roundNo: roundNoRef.current,
      cardId,
      reactionMs: Math.max(0, Math.round(reactionMs ?? 0)),
    })
  }

  /** 这张牌上落了谁的点击。两个人可能点同一张，所以是列表 */
  const picksFor = (cardId: CardId | null): CardPick[] => {
    if (!cardId || !result) return []
    return result.taps
      .filter((t) => t.cardId === cardId)
      .map((t) => ({
        player: t.player,
        isMe: t.player === me,
        label: t.player === me ? '你' : (match?.players[t.player].nickname ?? '对手'),
        reactionMs: t.reactionMs,
        verdict: t.verdict,
      }))
  }

  const cardStateFor = (cardId: CardId | null, slot: number, enemy: boolean): CardState => {
    if (!cardId) return 'idle'
    if (!enemy && stage === 'memorize' && selected === slot) return 'selected'
    // 出手后立刻标出自己选的那张，不等判定回来
    if (stage === 'live' && cardId === myPick) return 'pending'

    if (stage === 'choosing' && reveal) {
      if (cardId === reveal.takenCardId) return 'answer'
      if (!enemy && okuriPicks.includes(cardId)) return 'sending'
      // 还没挑够就把可选的牌都点亮，否则玩家不知道该点哪里
      if (!enemy && myOkuri && !okuriDone && myOkuri.candidates.includes(cardId)) return 'sendable'
      return 'idle'
    }

    if (!result) return 'idle'

    const wasTaken = result.transfers.some((t) => t.cause === 'take' && t.cardId === cardId)
    if (wasTaken) return 'answer'
    // 这张就是答案却没人取到 —— 用虚线绿框告诉玩家「本该点这张」
    if (result.kind === 'field' && !result.winner) {
      const card = cardById.get(cardId)
      if (card && card.songId === result.revealed.songId) return 'answer-missed'
    }
    if (picksFor(cardId).length > 0) return 'mistake'
    return 'idle'
  }

  if (!match) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <p className="text-sm text-ink-faint">等待对局开始…</p>
      </main>
    )
  }

  const left = match.cardsLeft
  const mySlots = slotsRef.current?.view ?? []
  const foeSlots = enemySlotsRef.current?.view ?? []
  const names: Record<PlayerId, string> = {
    A: match.players.A.nickname,
    B: match.players.B.nickname,
  }

  /**
   * 胜因。掉线判负时赢家的自陣根本没清空，
   * 照写「先清空自陣」就是在结算页上说一句假话（实测：赢家剩 16 张）。
   */
  const winReason = (winner: PlayerId | null): string => {
    if (!winner) return '对局结束'
    if (left[winner] === 0) return `${names[winner]} 先清空自陣`
    return `${names[OTHER[winner]]} 未能在断线宽限内重连，判其负`
  }
  const narration = result ? narrateRound(result, names, me) : null

  /** 只有「这一刻真的能点」的牌才可点：其余一律禁用，避免误触和空点 */
  const cardDisabled = (id: CardId | null, enemy: boolean): boolean => {
    if (!id) return true
    if (stage === 'choosing') {
      return enemy || !myOkuri || okuriDone || !myOkuri.candidates.includes(id)
    }
    if (stage === 'memorize') return enemy
    return stage !== 'live' || locked
  }

  const grid = (
    slots: ReadonlyArray<CardId | null>,
    enemy: boolean,
    onClick: (slot: number, e: React.MouseEvent) => void,
  ) => (
    // 领地可能超过 12 张（お手つき / 送り札 会把牌送过来），
    // 固定渲染 12 格会让多出来的牌看不见也点不到
    // 窄屏 3 列：4 列时牌宽只有 ~81px，12 首曲名里 6~7 首会被截断，
    // 而牌上的曲名正是玩法本身（決まり字靠词头粗体 + 词尾浅色的对比来读）
    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 sm:gap-2">
      {Array.from({ length: Math.max(KARUTA_DEFAULTS.ownCards, slots.length) }, (_, i) => {
        const id = slots[i] ?? null
        const card = id ? (cardById.get(id) ?? null) : null
        return (
          <KarutaTile
            key={i}
            card={card}
            kimariji={card ? (kimariji.get(card.title) ?? 1) : 1}
            state={cardStateFor(id, i, enemy)}
            picks={picksFor(id)}
            enemy={enemy}
            disabled={cardDisabled(id, enemy)}
            onClick={(e) => onClick(i, e)}
          />
        )
      })}
    </div>
  )

  /** 一方的名牌：名字、在线、剩余牌数 */
  const nameplate = (who: PlayerId, mine: boolean) => (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className="block shrink-0"
        style={{
          width: 'calc(9 * var(--u))',
          height: 'calc(9 * var(--u))',
          background: match.players[who].online ? 'var(--color-correct)' : 'transparent',
          boxShadow: match.players[who].online ? undefined : 'inset 0 0 0 1.5px var(--color-wrong)',
          clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
        }}
      />
      <span className="truncate text-sm font-semibold text-ink">
        {match.players[who].nickname}
        {mine && <span className="ml-1 text-xs font-normal text-ink-faint">（你）</span>}
      </span>
      {match.players[who].rttMs != null && (
        <span className="latin text-2xs text-ink-faint">{match.players[who].rttMs}ms</span>
      )}
      <span
        className="latin ml-auto font-bold"
        style={{
          fontSize: 'calc(26 * var(--u))',
          lineHeight: 1,
          color: mine ? 'var(--color-accent-ink)' : 'var(--color-primary)',
        }}
      >
        {left[who]}
      </span>
    </div>
  )

  const revealed = reveal?.revealed ?? result?.revealed
  const revealKind = reveal?.kind ?? result?.kind

  /**
   * 轮到我挑送り札时，敵陣退到后景。
   * 这一刻要读、要从中选的是自陣，而敵陣满是饱和组合色 ——
   * 不压下去的话，决策最吃紧的半屏反而是视觉上更弱的那一半。
   */
  const foeReceded = stage === 'choosing' && !!myOkuri && !okuriDone

  /**
   * 中央信息面板。抽成变量是为了两种摆法共用同一段内容：
   *   live  —— 压在光带上（面板只有一个「聴」那么宽，光带仍读得出来）
   *   其余  —— 走正常流排在光带上方
   * 之前它是相对「場」这一段做 absolute 定位的，而那一段的高度随两侧牌阵行数变化
   *（お手つき / 送り札 会让一方涨到 22 格），牌数一悬殊面板就漂出去压进敵陣。
   */
  const infoPanel = (
    <div className="pointer-events-none flex w-full justify-center">
      <span className="cut-shadow-sm pointer-events-auto max-w-full">
        <div
          className={`glass-lit cut-card-sm text-center ${stage === 'live' ? 'px-5 py-2' : 'px-6 py-3'}`}
          style={{
            // live 的 6 秒里把面板收窄到只剩一个「聴」——光带是从两端向中央收的，
            // 面板一宽就把收拢的终点盖住了，而这一刻玩家该看的是牌，不是说明文字。
            minWidth: stage === 'live' ? 'calc(132 * var(--u))' : 'calc(300 * var(--u))',
          }}
        >
          {stage === 'memorize' &&
            (match.players[me].ready ? (
              <>
                <p className="latin text-lg font-bold text-accent-ink">已就绪</p>
                <p className="mt-1 text-xs text-ink-sub">
                  {match.players[foe].ready
                    ? '双方都好了，即将开始…'
                    : `等待 ${match.players[foe].nickname} 记牌…`}
                </p>
                <p className="latin mt-1 text-xs text-ink-sub">{memorizeLeft}s 后无论如何都会开始</p>
              </>
            ) : (
              <>
                <p
                  className="latin font-bold text-primary"
                  style={{ fontSize: 'calc(40 * var(--u))', lineHeight: 1 }}
                >
                  {memorizeLeft}
                </p>
                <p className="mt-1 flex items-center justify-center gap-1.5 text-xs text-ink-sub">
                  <Icon name="swap" size="calc(13 * var(--u))" />
                  记忆阶段 —— 点两张自陣的牌可以交换位置
                </p>
                {selected !== null && (
                  <p className="text-xs text-accent-ink">已选中一张，再点一张交换</p>
                )}
                <div className="mt-2">
                  <Button variant="ghost" size="sm" onClick={() => socket.send({ t: 'memorizeDone' })}>
                    我记好了
                  </Button>
                </div>
              </>
            ))}

          {stage === 'waiting' && <p className="text-xs text-ink-sub">准备下一札…</p>}

          {stage === 'live' && (
            <>
              <p
                className="font-bold text-primary"
                style={{
                  fontSize: 'calc(28 * var(--u))',
                  lineHeight: 1.1,
                  letterSpacing: 'var(--tracking-wide)',
                }}
              >
                聴
              </p>
              {locked && <p className="text-2xs text-accent-ink">已出手</p>}
            </>
          )}

          {(stage === 'choosing' || stage === 'reveal') && revealed && (
            <>
              <div className="flex items-center justify-center gap-2">
                {revealKind === 'karafuda' ? (
                  <span
                    className="cut-slant px-2 py-0.5 text-xs font-bold text-rose-ink"
                    style={{
                      boxShadow: 'inset 0 0 0 1.5px var(--color-rose-ink)',
                      ['--cut-sm' as string]: 'calc(5 * var(--u))',
                    }}
                  >
                    空札
                  </span>
                ) : (
                  <img
                    src={revealed.coverUrl}
                    alt=""
                    className="cut-hex"
                    style={{
                      width: 'calc(30 * var(--u))',
                      height: 'calc(30 * var(--u))',
                      objectFit: 'cover',
                    }}
                  />
                )}
                <span className="jp-wrap text-sm font-bold text-ink">{revealed.title}</span>
              </div>

              {stage === 'choosing' &&
                reveal &&
                (myOkuri && !okuriDone ? (
                  <>
                    <p className="mt-1 text-base font-bold text-rose-ink">送り札を選ぶ</p>
                    <p className="text-xs text-ink-sub">
                      从自陣挑 {myOkuri.count} 张送给对手
                      {myOkuri.count > 1 && `（已选 ${okuriPicks.length}/${myOkuri.count}）`}
                      {' —— '}把最难记的那张丢过去
                    </p>
                  </>
                ) : myOkuri ? (
                  <p className="mt-1 text-xs text-ink-sub">已送出，等待对手…</p>
                ) : (
                  <p className="mt-1 text-xs text-ink-sub">
                    {names[reveal.pending[0]?.player ?? foe]} 正在挑送り札…
                  </p>
                ))}

              {/* 剩余秒数也画在光带上，这里给一个可读的数字兜底 */}
              {stage === 'choosing' && (
                <p className="latin mt-1 text-xs text-ink-sub">
                  {okuriLeft}s 后自动送出自陣待得最久的那张
                </p>
              )}

              {stage === 'reveal' && result && narration && (
                // 一局里所有胜负反馈都从这里出（空札 / お手つき / 谁取到了牌），
                // 没有 live region 的话，1v1 的整个回合闭环对读屏用户根本不存在
                <div role="status" aria-live="polite">
                  <p
                    className="mt-1 text-base font-bold"
                    style={{
                      color:
                        narration.tone === 'good'
                          ? 'var(--color-correct)'
                          : narration.tone === 'bad'
                            ? 'var(--color-wrong)'
                            : 'var(--color-ink)',
                    }}
                  >
                    {narration.headline}
                  </p>
                  <p className="text-xs text-ink-sub">{narration.detail}</p>
                  {result.taps.length === 0 && result.kind === 'field' && (
                    <p className="text-2xs text-ink-sub">正确的那张已用虚线绿框标出</p>
                  )}
                </div>
              )}
            </>
          )}

          {/* 接回一局已经打完的对局：matchEnd 早就发过了，拿不到赛后统计 */}
          {stage === 'over' && !ended && (
            <>
              <p className="text-lg font-bold text-primary">対局終了</p>
              <p className="mt-1 text-xs text-ink-sub">这一局已经结束了</p>
              <div className="mt-2">
                <Button variant="ghost" size="sm" onClick={onExit}>
                  返回
                </Button>
              </div>
            </>
          )}

          {stage === 'over' && ended && (
            <p className="text-xl font-bold text-primary">
              {ended.winner === me ? '勝ち' : ended.winner ? '負け' : '引き分け'}
            </p>
          )}
        </div>
      </span>
    </div>
  )

  return (
    // 两个领地尽量拉开 —— 中间那段距离就是歌牌的「场」
    <main
      className="mx-auto flex min-h-dvh w-full flex-col justify-between px-3 py-4 sm:px-6 sm:py-6"
      style={{ maxWidth: 'calc(1000 * var(--u))' }}
    >
      {/* 遮罩打开时整块牌场 inert，所以它必须自成一层、且遮罩在它之外 */}
      <div ref={boardRef} className="flex flex-1 flex-col justify-between">
      {/* ── 敵陣 ───────────────────────────────────────── */}
      <section
        className="shrink-0 px-3 pt-2 pb-3 transition-opacity duration-300 sm:px-4"
        style={{ background: 'rgb(97 95 144 / .05)', opacity: foeReceded ? 0.45 : 1 }}
        aria-label="敵陣"
      >
        {/* 牌多到要滚动时（お手つき 会把一方堆到 22 张），对手还剩几张必须一直看得见 */}
        <div className="sticky top-0 z-10" style={{ background: 'rgb(240 239 246 / .92)' }}>
          {nameplate(foe, false)}
        </div>
        <div className="mt-2">{grid(foeSlots, true, (slot, e) => tap(slot, true, e))}</div>
      </section>

      {/* ── 場：一条光就是两阵之间的界线 ─────────────────── */}
      {/*
        三行网格：1fr / auto / 1fr。
        上下两行恒等高，所以中间那行（光带）**永远落在场区的几何中线上**，与面板多高无关。
        面板仍是常规流子项，不可能溢出到牌阵里；面板变高时两条 1fr 会对称地一起长。
        —— 之前用 flex + justify-center，面板一进流就把光带整体压下去 60px，
        而 mirror 模式下这条线的全部意义就是「自陣与敵陣之间的那道界线」，
        不在中线上就是保住了形、丢掉了义。
      */}
      <section
        className="sc-field relative my-3 grid flex-1 sm:my-4"
        style={{ gridTemplateRows: '1fr auto 1fr' }}
      >
        <div className="flex min-h-0 items-end justify-center pb-2">
          {stage !== 'live' && infoPanel}
        </div>

        <div className="relative w-full">
          <PrismRail
            getRemaining={getRoundRemaining}
            mode="mirror"
            label={
              stage === 'choosing'
                ? `自动送出前剩余时间，共 ${KARUTA_DEFAULTS.okuriSeconds} 秒`
                : `本札剩余时间，共 ${CLIP_SECONDS} 秒`
            }
          />
          {stage === 'live' && (
            <div className="absolute inset-0 flex items-center justify-center">{infoPanel}</div>
          )}
        </div>

        {/* 提示落在第三行，永远在光带正下方 —— absolute 定位会让它滑到自陣的牌底下 */}
        <div className="flex min-h-0 items-start justify-center pt-2">
          {stage === 'live' && (
            <p role="status" className="text-center text-xs text-ink-sub">
              {locked ? '已出手 —— 你选的那张已高亮，等待判定' : '认出来就点对应的牌'}
            </p>
          )}
        </div>
      </section>

      {/* ── 自陣 ───────────────────────────────────────── */}
      <section
        className="shrink-0 px-3 pt-3 pb-2 sm:px-4"
        style={{ background: 'rgb(94 226 255 / .07)' }}
        aria-label="自陣"
      >
        <div className="mb-2">{grid(mySlots, false, onOwnCardClick)}</div>
        {nameplate(me, true)}
      </section>
      </div>

      {toast && (
        <div role="status" aria-live="polite" className="fixed bottom-6 left-1/2 -translate-x-1/2">
          <span className="cut-shadow-sm block">
            <span className="glass-lit cut-slant block px-5 py-2 text-xs text-ink">{toast}</span>
          </span>
        </div>
      )}

      {/* 对手掉线：不是弹窗而是常驻横幅——它会一直影响接下来的每一回合 */}
      {peerGraceEnds !== null && stage !== 'over' && (
        <div
          role="status"
          className="fixed inset-x-0 top-0 z-30 flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-wrong"
          style={{ background: 'rgb(179 18 58 / .12)', backdropFilter: 'blur(calc(6 * var(--u)))' }}
        >
          <Icon name="warn" size="calc(13 * var(--u))" />
          <span>{match.players[foe].nickname} 掉线了，等待重连</span>
          <span className="latin">{peerGraceLeft}s</span>
          {/* ink-faint 压在 12% 玫瑰面上只有 3.86:1，这条横幅上的字必须用 ink-sub */}
          <span className="font-normal text-ink-sub">到点判其负</span>
        </div>
      )}

      {/* 自己断线：整屏挡住。这时点任何牌都到不了服务器，让人接着点只会更困惑 */}
      {!online && stage !== 'over' && (
        <Overlay label="连接断开">
          <OverlayMark />
          <p className="text-xl font-bold text-primary">连接断开</p>
          <p className="text-xs leading-relaxed text-ink-sub">
            正在自动重连，座位会保留 {KARUTA_DEFAULTS.disconnectGraceSeconds} 秒。
            <br />
            重连成功后牌面会自动恢复，本回合会跳过。
          </p>
          <div className="mt-2 flex flex-col items-center gap-3">
            <Button variant="glass" size="md" onClick={() => socket.connect()}>
              立即重试
            </Button>
            <button
              type="button"
              onClick={onExit}
              className="py-1 text-xs text-ink-faint transition-colors hover:text-primary"
            >
              放弃这局
            </button>
          </div>
        </Overlay>
      )}

      {/* 刷新后必须再要一次真实用户手势，否则 AudioContext 起不来，整局静音 */}
      {needGesture && online && stage !== 'over' && (
        <Overlay
          label="需要一次点击才能出声"
          onClick={() => {
            void audio.unlock().catch(() => {})
            setNeedGesture(false)
          }}
        >
          <OverlayMark />
          {/* 整屏都可点（鼠标随便点哪都行），但键盘要有一个真正的按钮可以聚焦回车 */}
          <Button
            variant="primary"
            size="lg"
            onClick={() => {
              void audio.unlock().catch(() => {})
              setNeedGesture(false)
            }}
          >
            点击继续对局
          </Button>
          <span className="text-xs leading-relaxed text-ink-sub">
            浏览器要求一次点击才允许出声。
            <br />
            不点这一下，接下来的每一回合都会是静音的。
          </span>
        </Overlay>
      )}

      {/* ── 结算 ─────────────────────────────────────── */}
      {stage === 'over' && ended && (
        <div
          ref={endDialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="对局结算"
          tabIndex={-1}
          className="fixed inset-0 z-40 flex items-center justify-center px-5"
          style={{ background: 'rgb(247 246 251 / .9)', backdropFilter: 'blur(calc(6 * var(--u)))' }}
        >
          <span className="cut-shadow-lg anim-appear w-full" style={{ maxWidth: 'calc(520 * var(--u))' }}>
            {/*
              cut-card 的 --cut-lg（≈43px）大于 p-8（≈34px），左上角切除区会吃掉
              紧贴顶端的内容 —— OverlayMark 与胜负字正好落在那里。多给一截上内边距。
            */}
            <div className="glass-lit cut-card px-8 pt-12 pb-8">
              <OverlayMark />
              <p className="mt-5 text-3xl font-bold text-primary">
                {ended.winner === me ? '勝ち' : ended.winner ? '負け' : '引き分け'}
              </p>
              <p className="jp-wrap mt-1 text-sm text-ink-sub">
                {winReason(ended.winner)}
                {' · '}
                {ended.stats.rounds} 回合
              </p>

              <table className="mt-7 w-full text-sm">
                <caption className="sr-only">赛后统计，逐项对比你与对手</caption>
                <thead>
                  <tr className="text-2xs text-primary" style={{ letterSpacing: 'var(--tracking-wide)' }}>
                    {/* 空的表头会被读屏念成一个空白列，得给它一个名字 */}
                    <th scope="col" className="pb-2 text-left font-semibold">
                      <span className="sr-only">项目</span>
                    </th>
                    <th scope="col" className="pb-2 text-right font-semibold">
                      你
                    </th>
                    <th scope="col" className="pb-2 text-right font-semibold">
                      {names[foe]}
                    </th>
                  </tr>
                </thead>
                <tbody className="latin">
                  {[
                    ['剩余自陣', `${left[me]}`, `${left[foe]}`],
                    ['取牌', `${ended.stats.taken[me]}`, `${ended.stats.taken[foe]}`],
                    ['お手つき', `${ended.stats.otetsuki[me]}`, `${ended.stats.otetsuki[foe]}`],
                    [
                      '平均反应',
                      ended.stats.avgReactionMs[me] != null ? `${ended.stats.avgReactionMs[me]}ms` : '—',
                      ended.stats.avgReactionMs[foe] != null ? `${ended.stats.avgReactionMs[foe]}ms` : '—',
                    ],
                  ].map(([k, a, b]) => (
                    <tr key={k} style={{ borderTop: '1px solid var(--color-divider)' }}>
                      <th
                        scope="row"
                        className="py-2.5 text-left text-xs font-normal text-ink-sub"
                        style={{ fontFamily: 'var(--font-jp)' }}
                      >
                        {k}
                      </th>
                      <td className="py-2.5 text-right font-semibold text-ink">{a}</td>
                      <td className="py-2.5 text-right text-ink-sub">{b}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* 判定被校正的次数公示出来，靠社交压力而不是封禁 */}
              {(ended.stats.clamped[me] > 0 || ended.stats.clamped[foe] > 0) && (
                <p
                  className="mt-4 px-4 py-2.5 text-xs leading-relaxed text-ink-sub"
                  style={{ background: 'rgb(97 95 144 / .06)' }}
                >
                  反应时间被服务端校正：你 {ended.stats.clamped[me]} 次 · {names[foe]}{' '}
                  {ended.stats.clamped[foe]} 次。客户端上报的时间若早得不合物理，会被换成服务端自己算的值。
                </p>
              )}

              <div className="mt-7 flex flex-col gap-3">
                <Button
                  variant="primary"
                  size="lg"
                  full
                  onClick={() => socket.send({ t: 'rematch', agree: !rematchVotes.includes(me) })}
                >
                  {rematchVotes.includes(me) ? '已同意再战 —— 点此取消' : '再战一局'}
                </Button>
                <p role="status" aria-live="polite" className="text-center text-xs text-ink-sub">
                  {rematchVotes.includes(me)
                    ? rematchVotes.includes(foe)
                      ? '双方都同意，正在重开…'
                      : `等待 ${names[foe]} 同意…`
                    : rematchVotes.includes(foe)
                      ? `${names[foe]} 已同意，等你点头`
                      : '需要双方都同意才会重开'}
                </p>
                <Button variant="ghost" size="md" full onClick={onExit}>
                  退出房间
                </Button>
              </div>
            </div>
          </span>
        </div>
      )}
    </main>
  )
}
