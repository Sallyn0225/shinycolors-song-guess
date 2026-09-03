import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  KARUTA_DEFAULTS,
  type CardId,
  type CardView,
  type MatchStats,
  type MatchView,
  type PlayerId,
  type RoomView,
  type RoundResultView,
  type ServerMsg,
} from '@scg/shared'

import { audio } from '../audio'
import { socket } from '../net/ws'
import { KarutaTile, type CardPick, type CardState } from '../components/KarutaTile'
import { SlotMap } from '../features/karutaBoard'
import { versusTier } from '../features/grade'
import { computeKimariji } from '../features/kimariji'
import { narrateRound } from '../features/narrate'
import { Button } from '../ui/Button'
import { Countdown } from '../ui/Countdown'
import { GradeBadge } from '../ui/GradeBadge'
import { Icon } from '../ui/Icon'
import { Overlay, OverlayMark } from '../ui/Overlay'
import { PrismRail } from '../ui/PrismRail'

/* 战报导出整条链按需加载，与 Result 同一个入口。见 ui/ShareTicket.tsx */
const ShareTicket = lazy(() => import('../ui/ShareTicket'))

interface Props {
  /** matchStart 的内容由 App 传下来 —— 本组件挂载时那条消息已经过去了 */
  initialMatch: MatchView
  memorizeEndsAtServer: number
  /** 这一局是断线/刷新后接回来的，不是从大厅正常开始的 */
  resumed: boolean
  onExit: () => void
  /** 对手主动退出后的落点：回到 Room 屏（房间还在），而不是大厅 */
  onPeerLeft: (room: RoomView) => void
}

type Stage = 'memorize' | 'waiting' | 'live' | 'choosing' | 'reveal' | 'over'

type RevealMsg = Extract<ServerMsg, { t: 'roundReveal' }>

const OTHER: Record<PlayerId, PlayerId> = { A: 'B', B: 'A' }
/**
 * 对手退出后自动返回房间的等待时长。与服务端的断线宽限是两回事：
 * 那条是「人还可能回来」，这条是「人不会回来了」，只是给留守方几秒钟读完横幅。
 */
const PEER_LEFT_RETURN_MS = 10_000
/**
 * 联机每回合的音频长度 = 抢牌窗口，与服务端判定窗口读同一个常量。
 * 不要改回 DIFFICULTY_PRESETS[...].clipSeconds —— 那是单机答题的旋钮，
 * 借用它会让「调单机片段长度」意外改掉联机节奏，且与服务端的 windowMs 脱钩
 */
const ROUND_SECONDS = KARUTA_DEFAULTS.roundWindowSeconds

export function Karuta({ initialMatch, memorizeEndsAtServer, resumed, onExit, onPeerLeft }: Props) {
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
  // 开导出框的时刻，用来定住战报上的日期与条码种子。
  // 纯本地状态：开关它不发任何 socket 消息，所以再战投票不受影响
  const [shareAt, setShareAt] = useState<Date | null>(null)
  /** 送り札阶段：服务端先揭晓答案，再等人挑牌 */
  const [reveal, setReveal] = useState<RevealMsg | null>(null)
  const [okuriPicks, setOkuriPicks] = useState<CardId[]>([])
  const okuriSent = useRef(false)
  /** 自己的连接状态。断了就整屏挡住——这时点什么都到不了服务器 */
  const [online, setOnline] = useState(() => socket.connected)
  /** 对手掉线时服务端给的宽限终点 */
  const [peerGraceEnds, setPeerGraceEnds] = useState<number | null>(null)
  const [peerGraceLeft, setPeerGraceLeft] = useState(0)
  /**
   * 退出确认层。只保护「误触让一局正在进行的对局作废」这一种情况 ——
   * 断线遮罩里的「放弃这局」和结算页的「退出房间」不走这里。
   */
  const [confirmExit, setConfirmExit] = useState(false)
  /**
   * 对手**主动退出**了（不是掉线）。牌面立即冻结、音频停止，横幅读完即回房间。
   * 屏内局部状态，不进任何单例：这条消息只与这一局有关。
   */
  const [peerLeft, setPeerLeft] = useState<{
    nickname: string
    room: RoomView
    endsAt: number
  } | null>(null)
  const [peerLeftCount, setPeerLeftCount] = useState(0)
  const peerLeftDone = useRef(false)
  const onPeerLeftRef = useRef(onPeerLeft)
  onPeerLeftRef.current = onPeerLeft
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
    return Math.max(0, Math.min(1, left / (ROUND_SECONDS * 1000)))
  }, [])

  /*
    数字每帧问同一对 ref。光带与秒数读的是同一个截止时刻，
    所以不会出现「光带还剩一截、数字已经 0」这种两处打架的情况。
  */
  const getLiveMsLeft = useCallback(() => Math.max(0, roundEndsAt.current - performance.now()), [])
  const getOkuriMsLeft = useCallback(() => Math.max(0, okuriEndsAt.current - performance.now()), [])

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
          roundEndsAt.current = performance.now() + (startLocal - Date.now()) + ROUND_SECONDS * 1000
          const at = audio.ctxTimeFor(startLocal)
          void audio
            .play(a.token, a.url, ROUND_SECONDS, at, a.fallbackUrl)
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

        // 对手**主动退出**了 —— 与 peer{online:false} 互斥的那条路：
        // 人不会回来了，座位已经释放，没有重连倒计时，只有回房间的倒计时
        case 'peerLeft':
          peerLeftDone.current = false
          setPeerLeft({
            nickname: msg.nickname,
            room: msg.room,
            endsAt: Date.now() + PEER_LEFT_RETURN_MS,
          })
          // 这一局已经没了：牌面冻结、正在播的音频停止，与断线遮罩同一条原则
          setLocked(true)
          audio.stop()
          break

        // 横幅那 10 秒里房间仍然活着 —— 房间又回到了大厅列表上，第三个人随时可能进来。
        // 落点必须用最新的房间视图，否则回到 Room 屏时对手位会先显示成一个
        // 已经不成立的「等待对手加入…」，要等下一条房间消息才自愈。
        // peerLeft 为空时返回同一个引用，React 会跳过这次更新（正常对局中此路无副作用）
        case 'room':
          setPeerLeft((prev) => (prev ? { ...prev, room: msg.room } : prev))
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
  /*
    peerLeft 也算：牌面已经冻结，让 24 颗牌留在 tab 序列里，键盘用户要穿过两打
    禁用按钮才够得到横幅上的「立即返回」。

    退出确认层**不**列进来，尽管它也是遮罩：退出入口现在长在牌场里（自陣名牌那一行），
    整块 inert 掉之后 `Overlay` 卸载时的「把焦点还给打开它的那颗按钮」会落在 inert
    子树上，静默失败 —— 焦点掉回 body。那一层的 Tab 圈闭已经把牌挡在外面了。
  */
  const blocked = !online || needGesture || stage === 'over' || peerLeft !== null
  useEffect(() => {
    const el = boardRef.current
    if (!el) return
    if (blocked) el.setAttribute('inert', '')
    else el.removeAttribute('inert')
  }, [blocked])

  /*
    结算浮层的模态行为（进场聚焦 / Tab 圈闭 / 关闭后还原焦点 / 明底遮罩）
    原来在这里**又实现了一遍** —— 那是 ui/Overlay 的手抄副本，而且抄得不全：
    圈闭只收集 'button:not([disabled])'，漏掉了链接与输入框。
    重复的代价是实打实的：同一个「关掉后焦点掉回 body」的缺陷要修两次。
    现在整块交给 <Overlay>，这个 effect 连同 endDialogRef 一起删掉。
  */

  // 对手掉线的宽限倒计时。到点判负，所以得让人看到还要等多久
  useEffect(() => {
    if (peerGraceEnds === null) return
    const endsLocal = socket.toLocalTime(peerGraceEnds)
    const tick = () => setPeerGraceLeft(Math.max(0, Math.ceil((endsLocal - Date.now()) / 1000)))
    tick()
    const t = window.setInterval(tick, 500)
    return () => window.clearInterval(t)
  }, [peerGraceEnds])

  // 对手主动退出的返回倒计时。写法与上面的宽限倒计时同一套（interval + 清理），
  // 只是终点是本地定的 —— 服务端不发宽限，这 10 秒纯粹是给留守方读横幅的
  useEffect(() => {
    if (!peerLeft) return
    const tick = () => {
      const left = Math.max(0, Math.ceil((peerLeft.endsAt - Date.now()) / 1000))
      setPeerLeftCount(left)
      if (left <= 0 && !peerLeftDone.current) {
        peerLeftDone.current = true
        onPeerLeftRef.current(peerLeft.room)
      }
    }
    tick()
    const t = window.setInterval(tick, 500)
    return () => window.clearInterval(t)
  }, [peerLeft])

  // 确认层的 Esc 等同于「继续对局」—— 失败方向只能是留在对局里
  useEffect(() => {
    if (!confirmExit) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirmExit(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmExit])

  // 挑送り札的截止时刻。到点服务端会替我送「自陣待得最久的那张」，所以必须让人看到还剩多久。
  // 秒数由 Countdown 在 rAF 里直接写 DOM —— 这一段两片牌阵都在屏上，
  // 每 200ms setState 一次等于整局最吃紧的 10 秒里把整个牌场重渲染 50 遍
  useEffect(() => {
    if (stage !== 'choosing' || !reveal) return
    const endsLocal = socket.toLocalTime(reveal.deadlineAtServer)
    okuriEndsAt.current = performance.now() + (endsLocal - Date.now())
  }, [stage, reveal])

  // ── 交互 ─────────────────────────────────────────────

  /** 本回合轮到我挑几张送り札、能从哪些牌里挑。null = 这回合不用我挑 */
  const myOkuri = reveal?.pending.find((p) => p.player === me) ?? null
  const okuriDone = myOkuri !== null && okuriPicks.length >= myOkuri.count

  /**
   * 本回合谁 お手つき 了，各自点错的是哪张。
   *
   * 判罚在 game-core：`sendOne(OPPONENT[p], p, 'otetsuki')` —— 犯错方的**对手**
   * 从自陣挑一张送给犯错方。所以犯错的人这 10 秒里是干等着挨罚的一方，
   * 界面上却什么都没说：不标那张点错的牌，也不出现「お手つき」四个字。
   * 空札占 24 回合里的 6 回合，是这局的核心惩罚 —— 罚下来的当下必须说清楚。
   */
  const faults = (reveal?.taps ?? []).filter(
    (t) => t.verdict === 'wrong' || t.verdict === 'otetsuki_karafuda' || t.verdict === 'too_early',
  )
  const myFault = faults.find((t) => t.player === me) ?? null
  const foeFault = faults.find((t) => t.player !== me) ?? null

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
    // 对手已退出：牌面冻结，记忆交换与送札选择一律不再接受
    if (peerLeft) return
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
      // 点错的那张也要在这一刻就标出来。等到 reveal 才标的话，
      // 挨罚的这 10 秒里玩家根本不知道自己错在哪张牌上
      if (faults.some((t) => t.cardId === cardId)) return 'mistake'
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
      <main className="flex min-h-safe items-center justify-center">
        <p className="text-sm text-ink-faint">等待对局开始…</p>
      </main>
    )
  }

  const left = match.cardsLeft
  const mySlots = slotsRef.current?.view ?? []
  const foeSlots = enemySlotsRef.current?.view ?? []

  /*
    领地的拥挤度，用来给牌高换档（--tile-min，表在 index.css 的 .sc-board）。

    起因：お手つき / 送り札 会把牌送过来，领地从 12 张涨上去。牌高写死
    `max(44px, 62u)` 时，390x844 上一次お手つき之后（自 13 / 敵 11）实测
    doc 936 > vp 844 —— 自陣名牌落在 884、刚发过来的第 13 张也被切掉。
    那违反的是本文件顶上写着的 The Both-Territories Rule 和
    「送り札只有 3 秒，看不见的牌等于不能选」，而且**先出界的是自己这半边**。

    取两边的最大值而不是自己那一边：两阵是同一套牌高，一方涨了另一方也得跟着矮，
    否则两边的牌一大一小，位置记忆会错位。
    下限兜 ownCards，避免残局只剩两三张时牌反而变大 —— 阵形不许重排，
    空位是留着的，格子数从来不会少于 12。
  */
  const crowd = Math.max(mySlots.length, foeSlots.length, KARUTA_DEFAULTS.ownCards)
  const crowdTier = crowd > 16 ? '2' : crowd > 12 ? '1' : '0'
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

  /**
   * 结算用的两侧数据。段位、网页展示、导出战报都读它，
   * 免得同一组数字在三处各拼一遍。
   */
  const sides = ended && {
    mine: {
      name: names[me],
      left: left[me],
      taken: ended.stats.taken[me],
      otetsuki: ended.stats.otetsuki[me],
      avgReactionMs: ended.stats.avgReactionMs[me],
      clamped: ended.stats.clamped[me],
    },
    foe: {
      name: names[foe],
      left: left[foe],
      taken: ended.stats.taken[foe],
      otetsuki: ended.stats.otetsuki[foe],
      avgReactionMs: ended.stats.avgReactionMs[foe],
      clamped: ended.stats.clamped[foe],
    },
  }
  const outcome = ended ? (ended.winner === me ? 'win' : ended.winner ? 'loss' : 'draw') : 'draw'
  const endTier =
    sides &&
    versusTier({
      outcome,
      otetsuki: sides.mine.otetsuki,
      // 剩余自陣差：同样是赢，碾过去和险胜不该拿一个称号
      margin: Math.abs(sides.foe.left - sides.mine.left),
    })

  /** 只有「这一刻真的能点」的牌才可点：其余一律禁用，避免误触和空点 */
  const cardDisabled = (id: CardId | null, enemy: boolean): boolean => {
    if (!id || peerLeft) return true
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
   * 中央信息面板。四个阶段共用同一处摆法：浮在光带正中（见 .sc-panelrow）。
   * live 的 6 秒里它收窄到只剩一个「聴」，好让收拢中的光带仍读得出来。
   *
   * 它曾经是相对「場」这一段做 absolute 定位的，而那一段的高度随两侧牌阵行数变化
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
                    ? '双方准备完毕，即将开始…'
                    : `等待 ${match.players[foe].nickname} 记牌…`}
                </p>
                <p className="latin mt-1 text-xs text-ink-sub">{memorizeLeft}s 后将自动开始</p>
              </>
            ) : (
              <>
                <p
                  className="latin font-bold text-primary"
                  style={{ fontSize: 'calc(40 * var(--u))', lineHeight: 1 }}
                >
                  {memorizeLeft}
                </p>
                {/*
                  这两行是全游戏唯一教 決まり字 的地方，也是记忆阶段唯一的正事。

                  原来只有一句「点两张自陣的牌可以交换位置」—— 给了操作没给理由，
                  新手拿着一条没有用途的指令，按下「我记好了」就永久放弃了「位置即记忆」。
                  而牌上那个加粗词头（KarutaTile 的 head/tail）从头到尾没被命名过：
                  没学过歌牌的人看到的是「**Fa**ding Stars」，会当成渲染 bug。
                  決まり字 是唯一能把 24 张同时可选的牌压成可扫描集合的装置，
                  不教它的人是在玩一个严格更难的游戏，而且不知道为什么难。

                  放在记忆阶段而不是规则页：这里正是玩家盯着牌面的那一分钟
                  （长度读 KARUTA_DEFAULTS.memorizeSeconds，不写死）。
                */}
                {/*
                  这个 <p> 是 **flex 容器**（为了让 swap 图标与文字同一基线）。
                  直接往里写 <span lang="ja">自陣</span> 会让它成为一个独立的 flex item，
                  被挤成「自 / 陣」两行的窄列，整句排版当场散架。
                  所以句子整体包一层 span，让它是**一个** flex item，图标另 shrink-0。
                */}
                <p className="mt-1 flex items-start justify-center gap-1.5 text-xs text-ink-sub">
                  <span className="mt-0.5 shrink-0">
                    <Icon name="swap" size="calc(13 * var(--u))" />
                  </span>
                  <span className="jp-wrap">
                    点击两张<span lang="ja">自陣</span>的牌可互换位置 —— 牌阵整局固定，可按习惯排列
                  </span>
                </p>
                <p className="jp-wrap mt-1 text-xs text-ink-sub">
                  <b className="font-bold text-ink">加粗</b>文字为决胜字：听到这几个字就足以在场上锁定该曲目
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
              {/*
                「聴」与秒数并排成一个横向锁定组，不是上下两行 ——
                面板一高就把镜像的频谱挡掉，一宽就盖住光带收拢的终点。
                个位数秒的窗口读数只占一位，整组仍在原来的 132u 里；
                窗口若调到两位数秒，这里要重新量宽度。
                warnAt 给 2 而不是默认的 3：末段警示超过窗口的四分之一就一直在喊。
              */}
              <div
                className="flex items-baseline justify-center"
                style={{ gap: 'calc(10 * var(--u))' }}
              >
                <span
                  lang="ja"
                  className="font-bold text-primary"
                  style={{ fontSize: 'calc(22 * var(--u))', lineHeight: 1 }}
                >
                  聴
                </span>
                <Countdown
                  getMsLeft={getLiveMsLeft}
                  totalSeconds={ROUND_SECONDS}
                  warnAt={2}
                  size={40}
                  label="本札剩余时间"
                />
              </div>
              {locked && <p className="text-2xs text-accent-ink">已出手</p>}
            </>
          )}

          {(stage === 'choosing' || stage === 'reveal') && revealed && (
            <>
              <div className="flex items-center justify-center gap-2">
                {revealKind === 'karafuda' ? (
                  <span
                    lang="ja"
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
                    src={`/thumb/${revealed.songId}.webp`}
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

              {/*
                挑送り札的这 10 秒也是一次胜负反馈，同样要进 live region ——
                否则读屏用户在整个惩罚窗口里听不到任何东西，
                等到 reveal 时牌已经易主了。
              */}
              <div role="status" aria-live="polite">
                {/* 我这一手是 お手つき —— 罚下来的当下就要说，不能拖到 10 秒后的 reveal */}
                {stage === 'choosing' && myFault && (
                  <p lang="ja" className="mt-1 text-base font-bold text-wrong">
                    お手つき
                    <span className="ml-2 text-xs font-normal text-ink-sub">
                      {myFault.verdict === 'too_early'
                        ? '抢跑了'
                        : myFault.verdict === 'otetsuki_karafuda'
                          ? '这首是空札，场上没有对应的牌'
                          : '点错了牌'}
                    </span>
                  </p>
                )}

                {stage === 'choosing' &&
                  reveal &&
                  (myOkuri && !okuriDone ? (
                    <>
                      <p lang="ja" className="mt-1 text-base font-bold text-rose-ink">
                        送り札を選ぶ
                      </p>
                      <p className="text-xs text-ink-sub">
                        {/* 为什么轮到我挑：是「对手挨罚」还是「我取了敵陣」—— 性质不同 */}
                        {foeFault ? <>{names[foe]} <span lang="ja">お手つき</span>，</> : ''}
                        从<span lang="ja">自陣</span>挑选 {myOkuri.count} 张牌送给对手
                        {myOkuri.count > 1 && `（已选 ${okuriPicks.length}/${myOkuri.count}）`}
                      </p>
                    </>
                  ) : myOkuri ? (
                    <p className="mt-1 text-xs text-ink-sub">已送出，等待对手…</p>
                  ) : (
                    <p className="mt-1 text-xs text-ink-sub">
                      {names[reveal.pending[0]?.player ?? foe]} 正在挑
                      {myFault ? '要罚给你的那张牌' : <span lang="ja">送り札</span>}…
                    </p>
                  ))}
              </div>

              {/*
                这 10 秒是全局最紧的一个计时，到点服务端就替你送。
                秒数在光带上只读得出走势，所以这里把它写成数字 —— 并且是这一行的主语。
                它落在上面那个 aria-live 区之外：每秒播一遍会把整个惩罚窗口的播报淹掉。
              */}
              {stage === 'choosing' && (
                <p className="mt-1 text-xs text-ink-sub">
                  {/* 走正常内联流而不是 flex 一行：Countdown 本身是 inline-flex，
                      基线自然对齐，而且 320 宽下这句话还能换行 —— flex 行不换，会顶出横向滚动 */}
                  <Countdown
                    getMsLeft={getOkuriMsLeft}
                    totalSeconds={KARUTA_DEFAULTS.okuriSeconds}
                    size={26}
                    label="自动送出前剩余时间"
                    className="mr-1"
                  />
                  后将自动送出最早的一张牌
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
              <p lang="ja" className="text-lg font-bold text-primary">
                対局終了
              </p>
              <p className="mt-1 text-xs text-ink-sub">这一局已经结束了</p>
              <div className="mt-2">
                <Button variant="ghost" size="sm" onClick={onExit}>
                  返回
                </Button>
              </div>
            </>
          )}

          {stage === 'over' && ended && (
            <p lang="ja" className="text-xl font-bold text-primary">
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
      className="mx-auto flex min-h-safe w-full flex-col justify-between px-3 py-4 sm:px-6 sm:py-6"
      style={{ maxWidth: 'var(--page-board)' }}
    >
      {/*
        牌场是全站唯一一屏没有任何标题元素的界面 —— 读屏的标题导航到这里就断了。
        视觉上这一屏没有放标题的余量（The Both-Territories Rule：两阵必须一屏装下），
        所以给一个 sr-only 的 h1，与别处的层级对齐而不占一个像素。
      */}
      <h1 className="sr-only">
        1v1 <span lang="ja">空札領地戦</span> 牌场
      </h1>

      {/* 遮罩打开时整块牌场 inert，所以它必须自成一层、且遮罩在它之外 */}
      <div
        ref={boardRef}
        className="sc-board flex flex-1 flex-col justify-between"
        data-crowd={crowdTier}
        // 对手退出后牌面冻结：「不能点」这件事要在视觉上先说出来
        style={peerLeft ? { filter: 'grayscale(60%)', opacity: 0.65 } : undefined}
      >
      {/* ── 敵陣 ───────────────────────────────────────── */}
      <section
        className="shrink-0 px-3 pt-2 pb-3 transition-opacity duration-300 sm:px-4"
        style={{ background: 'rgb(97 95 144 / .05)', opacity: foeReceded ? 0.45 : 1 }}
        lang="ja"
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
        {/* 四个阶段同一个摆法：浮在光带正中。见 index.css 的 .sc-panelrow */}
        <div className="sc-panelrow">{infoPanel}</div>

        <div className="sc-railrow">
          <PrismRail
            getRemaining={getRoundRemaining}
            mode="mirror"
            label={
              stage === 'choosing'
                ? `自动送出前剩余时间，共 ${KARUTA_DEFAULTS.okuriSeconds} 秒`
                : `本札剩余时间，共 ${ROUND_SECONDS} 秒`
            }
          />
        </div>

        {/* 提示落在第三行，永远在光带正下方 —— absolute 定位会让它滑到自陣的牌底下 */}
        <div className="sc-hintrow">
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
        lang="ja"
        aria-label="自陣"
      >
        <div className="mb-2">{grid(mySlots, false, onOwnCardClick)}</div>
        {/*
          与敵陣那块对称：牌多到要滚动时，自己还剩几张也必须一直看得见。
          原来这里是裸的 nameplate —— 敵陣有 sticky top-0、自陣没有，
          于是一次お手つき之后（自 13 / 敵 11）自陣名牌落到 884，
          844 的视口里根本看不到自己剩几张，而那正是要不要送札的唯一依据。

          方向是 bottom-0 不是 top-0：它是自陣的最后一个元素，
          往上贴会盖住自己的牌。底衬与敵陣同款 92%，不然滚动时牌会从字底下透出来。
        */}
        <div
          className="sticky bottom-0 z-10 flex items-center gap-3"
          style={{ background: 'rgb(240 239 246 / .92)' }}
        >
          <div className="min-w-0 flex-1">{nameplate(me, true)}</div>
          {/*
            对局中的退出入口。只在「正在进行的对局 + 自己在线」时出现：
            结算页有自己的「退出房间」，断线时整屏被遮罩盖住，都不需要它。
            点了不直接退 —— 先弹确认层，误触的失败方向只能是留在对局里。

            为什么挤在自陣名牌这一行、而不是自成一行：390×844 实测这一屏只剩 6px 余量
            （doc 897 / vp 844，自陣越过折线的牌 = 0）。加一行 44px 的按钮量出来是
            doc 949、**自己的三张牌掉到折线以下** —— 抢牌只有几秒，要滚动才找得到自己的牌
            就等于没得玩。所以热区靠 `.tap-line` + 负的 block 外边距撑出来：
            盒子仍是 44px（过 2.5.5），行高只涨 1px，多出来的部分落在上方 8px 的
            牌阵间距与下方 8px 的 pb-2 里，不盖任何一张牌。
            颜色用 primary 不用 ink-faint：ink-faint 压在这条 92% 的浅底上只有 4.46:1。
          */}
          {stage !== 'over' && online && (
            <button
              type="button"
              onClick={() => setConfirmExit(true)}
              // 外面那层 section 是 lang="ja"（牌面全是日文曲名），
              // 不写回来读屏会用日语读音念这四个中文字
              lang="zh-CN"
              className="tap-line -my-2 shrink-0 text-xs font-semibold text-primary transition-colors hover:text-ink"
              style={{ letterSpacing: 'var(--tracking-base)' }}
            >
              退出对局
            </button>
          )}
        </div>
      </section>
      </div>

      {/* sc-fixed-bottom 取代 bottom-6：fixed 层不受 body 的安全区内边距管，
          贴底的东西要自己让开 home indicator（见 index.css） */}
      {/* 对手主动退出：中性 primary 面，不是警报红 —— 已经成定局，没有「还有救」的意思。
          色差就是与掉线横幅的「一眼可区分」。出现时掉线横幅与断线遮罩不再渲染，
          对手都走了，那两条信息没有意义 */}
      {peerLeft && (
        <div
          role="status"
          className="sc-fixed-top fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 px-4 pb-2 text-xs font-semibold text-primary"
          style={{ background: 'rgb(97 95 144 / .12)', backdropFilter: 'var(--blur-veil)' }}
        >
          <Icon name="info" size="calc(13 * var(--u))" />
          <span>
            {peerLeft.nickname} 已退出房间，<span className="latin">{peerLeftCount}s</span> 后返回房间
          </span>
          <button
            type="button"
            onClick={() => {
              if (!peerLeftDone.current) {
                peerLeftDone.current = true
                onPeerLeftRef.current(peerLeft.room)
              }
            }}
            /* accent-ink 压在这块 12% 紫面上只有 3.96:1（白底上是 4.99:1）——
               又一次「token 从白底搬到有色面就要重算」。primary 在同一块面上是 4.69:1，
               动作感由下划线给，不靠再亮一档的颜色 */
            className="tap-line text-xs font-bold text-primary underline underline-offset-4 transition-colors hover:text-ink"
          >
            立即返回
          </button>
        </div>
      )}

      {/* 退出确认：主次刻意反着放 —— 「继续对局」是 primary 且排在前面
          （Overlay 进场自动聚焦第一个可聚焦元素），因为这个弹层存在的唯一理由就是防误触 */}
      {confirmExit && (
        <Overlay label="退出对局确认" onClick={() => setConfirmExit(false)}>
          {/* 点遮罩关闭，点卡片不关闭：冒泡到根 veil 才算「点了遮罩」 */}
          <span
            className="cut-shadow-lg anim-appear w-full"
            style={{ maxWidth: 'var(--page-card)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="glass-lit cut-card px-8 pt-12 pb-8 text-center">
              <OverlayMark />
              <p className="mt-5 text-xl font-bold text-primary">退出对局？</p>
              <p className="jp-wrap mt-2 text-sm text-ink-sub">
                退出后这一局立即作废，判你负，且无法再回到这一局。
              </p>
              <div className="mt-6 flex flex-col gap-3">
                <Button variant="primary" size="lg" full onClick={() => setConfirmExit(false)}>
                  继续对局
                </Button>
                <Button
                  variant="ghost"
                  size="md"
                  full
                  onClick={() => {
                    setConfirmExit(false)
                    onExit()
                  }}
                >
                  确认退出
                </Button>
              </div>
            </div>
          </span>
        </Overlay>
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="sc-fixed-bottom fixed left-1/2 -translate-x-1/2"
        >
          <span className="cut-shadow-sm block">
            <span className="glass-lit cut-slant block px-5 py-2 text-xs text-ink">{toast}</span>
          </span>
        </div>
      )}

      {/* 对手掉线：不是弹窗而是常驻横幅——它会一直影响接下来的每一回合。
          原来的 py-2 拆成 sc-fixed-top + pb-2：贴顶的横幅要自己让开状态栏/刘海，
          而上下内边距分开写才不会两条规则抢同一个属性 */}
      {peerGraceEnds !== null && stage !== 'over' && !peerLeft && (
        <div
          role="status"
          className="sc-fixed-top fixed inset-x-0 top-0 z-30 flex items-center justify-center gap-2 px-4 pb-2 text-xs font-semibold text-wrong"
          style={{ background: 'rgb(179 18 58 / .12)', backdropFilter: 'var(--blur-veil)' }}
        >
          <Icon name="warn" size="calc(13 * var(--u))" />
          <span>{match.players[foe].nickname} 掉线了，等待重连</span>
          <span className="latin">{peerGraceLeft}s</span>
          {/* ink-faint 压在 12% 玫瑰面上只有 3.86:1，这条横幅上的字必须用 ink-sub */}
          <span className="font-normal text-ink-sub">到点判其负</span>
        </div>
      )}

      {/* 自己断线：整屏挡住。这时点任何牌都到不了服务器，让人接着点只会更困惑。
          对手已退出的那 10 秒里不渲染 —— 横幅的返回倒计时才是此刻唯一的信息 */}
      {!online && stage !== 'over' && !peerLeft && (
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
              className="tap-line text-xs text-ink-faint transition-colors hover:text-primary"
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
            浏览器需要点击以激活音频播放。
            <br />
            点击任意处即可恢复声音并继续对局。
          </span>
        </Overlay>
      )}

      {/* ── 结算 ─────────────────────────────────────── */}
      {stage === 'over' && ended && (
        <Overlay label="对局结算" z={40}>
          {/*
            maxHeight + overflowY 是跟着 Overlay 一起继承来的既有做法：
            Overlay 是 justify-center 的，内容高过视口时溢出会平分到上下两端，
            而滚动条只能往下走 —— 顶部就此够不着。InfoModal 与 ShareDialog 都记过
            这个坑并自己封了顶，这块结算卡（统计表 + 三颗按钮 + 可能的校正说明）
            原来没有，是同一个家族的隐患。
          */}
          <span
            className="cut-shadow-lg anim-appear w-full"
            style={{ maxWidth: 'var(--page-card)', maxHeight: '92dvh', overflowY: 'auto' }}
          >
            {/*
              cut-card 的 --cut-lg（≈43px）大于 p-8（≈34px），左上角切除区会吃掉
              紧贴顶端的内容 —— OverlayMark 与胜负字正好落在那里。多给一截上内边距。
              text-left 要显式写回：Overlay 自带 text-center（它默认承载的是
              居中的几行提示），而这张卡是左对齐的统计卡。
            */}
            <div className="glass-lit cut-card px-8 pt-12 pb-8 text-left">
              <OverlayMark />
              <p lang="ja" className="mt-5 text-3xl font-bold text-primary">
                {ended.winner === me ? '勝ち' : ended.winner ? '負け' : '引き分け'}
              </p>
              <p className="jp-wrap mt-1 text-sm text-ink-sub">
                {winReason(ended.winner)}
                {' · '}
                {ended.stats.rounds} 回合
              </p>

              {/* 段位与导出战报读同一份 features/grade.ts，页面和图上说的是同一句话 */}
              {endTier && <GradeBadge tier={endTier} size="sm" className="mt-4" />}

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
                    // 前两项在下面按 ja 的部分渲染，见 <th> 里的 langOf
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
                        {/* 「お手つき」整条是日文，「剩余自陣」只有末两字是 —— 逐条判 */}
                        {k === 'お手つき' ? (
                          <span lang="ja">{k}</span>
                        ) : k === '剩余自陣' ? (
                          <>
                            剩余<span lang="ja">自陣</span>
                          </>
                        ) : (
                          k
                        )}
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
                  服务端时间校准：你 {ended.stats.clamped[me]} 次 · {names[foe]}{' '}
                  {ended.stats.clamped[foe]} 次（消除网络时钟抖动偏差）。
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
                <Button variant="glass" size="md" full onClick={() => setShareAt(new Date())}>
                  导出战报
                </Button>
                <Button variant="ghost" size="md" full onClick={onExit}>
                  退出房间
                </Button>
              </div>
            </div>
          </span>
        </Overlay>
      )}

      {shareAt && ended && sides && (
        // 分块在途时也要有话说 —— 空白一拍会读作「点了没反应」
        <Suspense
          fallback={
            <Overlay label="正在准备战报" z={60}>
              <OverlayMark />
              <p className="text-sm text-ink-sub">正在准备战报…</p>
            </Overlay>
          }
        >
          <ShareTicket
            kind="versus"
            label="导出战报图片"
            // 联机场景下 localStorage 若为空，用本局房间里填过的昵称兜底
            defaultId={names[me]}
            input={{
              outcome,
              reason: winReason(ended.winner),
              rounds: ended.stats.rounds,
              mine: sides.mine,
              foe: sides.foe,
              date: shareAt,
            }}
            onClose={() => setShareAt(null)}
          />
        </Suspense>
      )}
    </main>
  )
}
