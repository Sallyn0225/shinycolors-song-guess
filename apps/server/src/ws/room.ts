import { randomBytes, randomUUID } from 'node:crypto'

import {
  KARUTA_DEFAULTS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type CardId,
  type CardView,
  type MatchStats,
  type MatchView,
  type PlayerId,
  type RoomStatus,
  type RoomSummary,
  type RoomView,
  type RoomVisibility,
  type RoundResultView,
  type ServerMsg,
  type TapVerdict,
} from '@scg/shared'
import {
  adjudicate,
  applyLayout,
  applyRound,
  cardsLeft,
  dealMatch,
  pendingSends,
  pickNextReading,
  type KarutaConfig,
  type MatchState,
  type Reading,
  type RoundResult,
  type SongRef,
  type Tap,
} from '@scg/game-core'

import type { Catalog } from '../catalog.js'
import { PlayerTiming } from './timing.js'

const OPPONENT: Record<PlayerId, PlayerId> = { A: 'B', B: 'A' }

/** 下载+解码的等待上限。到点无论如何都开始，防「卡住不响应来免输」 */
const ARM_TIMEOUT_MS = 5000
/** 回合结束到下一回合的揭晓时间 */
const REVEAL_MS = 2800
/** 挑送り札的时限。到点回落到自动规则——慢或掉线的人只是失去挑选权，不会卡住整局 */
const OKURI_TIMEOUT_MS = KARUTA_DEFAULTS.okuriSeconds * 1000
/** 掉线宽限 */
const DISCONNECT_GRACE_MS = KARUTA_DEFAULTS.disconnectGraceSeconds * 1000

export interface Connection {
  send(msg: ServerMsg): void
  close(): void
}

interface Seat {
  nickname: string
  ready: boolean
  conn: Connection | null
  timing: PlayerTiming
  resumeToken: string
  taken: number
  otetsuki: number
  disconnectedAt: number | null
}

export function newRoomCode(): string {
  const bytes = randomBytes(ROOM_CODE_LENGTH)
  let out = ''
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    out += ROOM_CODE_ALPHABET[(bytes[i] as number) % ROOM_CODE_ALPHABET.length]
  }
  return out
}

type RoundPhase = 'idle' | 'arming' | 'counting' | 'open' | 'choosing' | 'revealing'

/** 等待挑送り札期间的暂存。回合已判完，只差「送哪张」 */
interface OkuriWait {
  roundNo: number
  taps: Tap[]
  needed: Map<PlayerId, number>
  choices: Record<PlayerId, CardId[]>
  submitted: Set<PlayerId>
}

/**
 * 一个 1v1 房间。
 *
 * 规则全部委托给 `@scg/game-core` 的纯函数；这一层只负责传输、计时和权威状态，
 * 所以规则本身可以脱离网络单测。
 */
export interface RoomOptions {
  /** 已经过 `sanitizeRoomName` 的房间名。Room 不再做清洗，拿到什么就显示什么 */
  name: string
  visibility: RoomVisibility
  /**
   * 建房者来源 IP，仅供 Hub 做每 IP 配额。
   *
   * **永远不下发**：不在 `roomView()` 里，也不在 `summary()` 里。
   * 列表是匿名可读的公开面，放进去的每个字段都等于公开。
   */
  creatorIp: string
  code?: string
  config?: KarutaConfig
}

export class Room {
  readonly code: string
  readonly name: string
  readonly visibility: RoomVisibility
  readonly creatorIp: string
  /** 建房时刻。用于列表排序与「等待太久自动关闭」的回收判断 */
  readonly createdAt = Date.now()
  readonly matchId = randomUUID()
  private readonly seats: Record<PlayerId, Seat | null> = { A: null, B: null }

  private state: MatchState | null = null
  private pool: SongRef[] = []
  private poolById = new Map<string, SongRef>()

  /** 当前回合的答案。**永不下发** */
  private reading: Reading | null = null
  private roundPhase: RoundPhase = 'idle'
  private roundStartAt = 0
  private armedBy = new Set<PlayerId>()
  private taps = new Map<PlayerId, Tap & { arrivedAt: number; clamped: boolean }>()
  /** 回合已判完、正在等人挑送り札 */
  private okuriWait: OkuriWait | null = null
  /** 每局重新生成的 token → sliceId。客户端永远看不到 sliceId */
  private clipTokens = new Map<string, string>()
  private timers = new Set<NodeJS.Timeout>()
  private memorizeEndsAt = 0
  private rematchVotes = new Set<PlayerId>()

  lastActivity = Date.now()

  private readonly config: KarutaConfig

  constructor(
    private readonly catalog: Catalog,
    opts: RoomOptions,
  ) {
    this.name = opts.name
    this.visibility = opts.visibility
    this.creatorIp = opts.creatorIp
    this.code = opts.code ?? newRoomCode()
    this.config = opts.config ?? {
      poolSize: KARUTA_DEFAULTS.poolSize,
      fieldCards: KARUTA_DEFAULTS.fieldCards,
      karafuda: KARUTA_DEFAULTS.karafuda,
      tieEpsilonMs: KARUTA_DEFAULTS.tieEpsilonMs,
      minHumanReactionMs: KARUTA_DEFAULTS.minHumanReactionMs,
      windowMs: KARUTA_DEFAULTS.roundWindowSeconds * 1000,
    }
  }

  // ── 座位 ──────────────────────────────────────────────

  get isEmpty(): boolean {
    return (['A', 'B'] as const).every((p) => this.seats[p] === null)
  }

  get allOffline(): boolean {
    return (['A', 'B'] as const).every((p) => this.seats[p] === null || this.seats[p]?.conn === null)
  }

  get playerCount(): number {
    return (['A', 'B'] as const).filter((p) => this.seats[p] !== null).length
  }

  /**
   * 列表状态。
   *
   * 判「已开局」看的是 `state !== null`，不是 `phase !== 'lobby'` ——
   * `MatchState.phase` 的取值里根本没有 `'lobby'`（那是 `RoomView` 才有的相位），
   * 对局一旦开始 `state` 就非空，结束后停在 `'over'` 也仍然算在局中。
   */
  get status(): RoomStatus {
    if (this.state) return 'playing'
    return this.playerCount >= 2 ? 'full' : 'waiting'
  }

  /** 房主昵称。A 座走了就顺延到 B 座，空房间返回空串（这种房间马上会被清扫） */
  get hostNickname(): string {
    return this.seats.A?.nickname ?? this.seats.B?.nickname ?? ''
  }

  /** 列表条目。**不含 creatorIp、不含任何对局内容** */
  summary(): RoomSummary {
    return {
      code: this.code,
      name: this.name,
      host: this.hostNickname,
      players: this.playerCount,
      status: this.status,
      createdAt: this.createdAt,
    }
  }

  join(nickname: string, conn: Connection): { playerId: PlayerId; resumeToken: string } | null {
    const slot = (['A', 'B'] as const).find((p) => this.seats[p] === null)
    if (!slot) return null
    const resumeToken = randomBytes(16).toString('hex')
    this.seats[slot] = {
      nickname,
      ready: false,
      conn,
      timing: new PlayerTiming(),
      resumeToken,
      taken: 0,
      otetsuki: 0,
      disconnectedAt: null,
    }
    this.touch()
    return { playerId: slot, resumeToken }
  }

  reattach(resumeToken: string, conn: Connection): PlayerId | null {
    for (const p of ['A', 'B'] as const) {
      const seat = this.seats[p]
      if (seat && seat.resumeToken === resumeToken) {
        seat.conn = conn
        seat.disconnectedAt = null
        this.touch()
        this.broadcast({ t: 'peer', playerId: p, online: true })
        return p
      }
    }
    return null
  }

  detach(player: PlayerId): void {
    const seat = this.seats[player]
    if (!seat) return
    seat.conn = null
    seat.disconnectedAt = Date.now()
    this.touch()
    this.broadcast({
      t: 'peer',
      playerId: player,
      online: false,
      graceEndsAtServer: Date.now() + DISCONNECT_GRACE_MS,
    })
  }

  /**
   * 主动退出（`{t:'leaveRoom'}`），与掉线的 `detach()` 是两条互斥的路。
   *
   * 掉线说「人还可能回来，座位给他留着」；这里说「人不会回来了，座位立即释放」。
   * 对局中退出时房间会被重置回等待态并通知留守方（`peerLeft`），
   * 等待阶段退出时只同步一次房间视图（`room`），不走横幅 —— 留守方本来就在房间屏里。
   */
  leave(player: PlayerId): void {
    const seat = this.seats[player]
    if (!seat) return
    // 昵称必须在清座位前取 —— 留守方的横幅要写出是谁走了
    const nickname = seat.nickname
    // 与 `status` 同一个口径：`state !== null` 即对局中，结算阶段（phase === 'over'）也算，
    // 留守方此刻在结算浮层上，同样需要横幅而不是悄无声息
    const wasInMatch = this.state !== null
    this.seats[player] = null
    // 定时器只在这一处清：无条件，所以两个分支都覆盖到了。
    // `resetToLobby()` 里不再清一遍 —— 两处都写会让人以为那是两件不同的事
    this.clearTimers()
    if (wasInMatch) this.resetToLobby()
    this.touch()
    const peer = OPPONENT[player]
    if (!this.seats[peer]) return
    if (wasInMatch) {
      this.send(peer, { t: 'peerLeft', playerId: player, nickname, room: this.roomView(peer) })
    } else {
      this.send(peer, { t: 'room', room: this.roomView(peer) })
    }
  }

  /**
   * 把房间从「对局中」恢复到「可以重新准备」。
   *
   * 字段清单按 `startMatch()` 的镜像来写：`state = null` 是 `status` 与
   * `roomView().phase` 回到等待态的唯一开关，漏掉任何一个，房间都会卡在
   * `'playing'` —— 既不出现在大厅列表里，也无法再准备。
   *
   * `timing`（`PlayerTiming`）**保留**：它攒的是这条连接的 RTT 画像，与对局无关，
   * 清掉等于让留守方的延迟显示归零重来。
   *
   * 定时器不在这里清：唯一的调用方 `leave()` 已经无条件清过一次（见那一处的注释）。
   */
  private resetToLobby(): void {
    this.state = null
    this.pool = []
    this.poolById.clear()
    this.reading = null
    this.roundPhase = 'idle'
    this.roundStartAt = 0
    this.armedBy.clear()
    this.taps.clear()
    this.okuriWait = null
    // 旧 token 必须作废，否则退出者手里的 token 还能换切片
    this.clipTokens.clear()
    this.rematchVotes.clear()
    this.memorizeEndsAt = 0
    for (const p of ['A', 'B'] as const) {
      const seat = this.seats[p]
      if (seat) {
        seat.ready = false
        seat.taken = 0
        seat.otetsuki = 0
      }
    }
  }

  seatOf(player: PlayerId): Seat | null {
    return this.seats[player]
  }

  private touch(): void {
    this.lastActivity = Date.now()
  }

  // ── 广播 ──────────────────────────────────────────────

  private send(player: PlayerId, msg: ServerMsg): void {
    this.seats[player]?.conn?.send(msg)
  }

  private broadcast(msg: ServerMsg): void {
    for (const p of ['A', 'B'] as const) this.send(p, msg)
  }

  /**
   * 告诉房里的人「这个房间没了」。
   *
   * 只发消息、不改状态：调用方（`Hub.dropRoom`）紧接着就会 `dispose()`，
   * 在这里再动一遍座位或定时器只会让两处的清理逻辑互相打架。
   */
  broadcastClosed(reason: 'idle'): void {
    this.broadcast({ t: 'roomClosed', reason })
  }

  /** 每人收到的 MatchView 里 `you` 不同，所以要逐人生成 */
  private broadcastMatch(build: (p: PlayerId) => ServerMsg): void {
    for (const p of ['A', 'B'] as const) if (this.seats[p]) this.send(p, build(p))
  }

  roomView(you: PlayerId): RoomView {
    return {
      code: this.code,
      name: this.name,
      visibility: this.visibility,
      you,
      players: {
        A: this.playerView('A'),
        B: this.playerView('B'),
      },
      phase: this.state ? (this.state.phase === 'over' ? 'over' : this.state.phase) : 'lobby',
    }
  }

  private playerView(p: PlayerId) {
    const seat = this.seats[p]
    if (!seat) return null
    return {
      id: p,
      nickname: seat.nickname,
      online: seat.conn !== null,
      ready: seat.ready,
      rttMs: seat.timing.rttMs,
    }
  }

  matchView(you: PlayerId): MatchView {
    const state = this.state
    if (!state) throw new Error('对局尚未开始')
    const cards: CardView[] = Object.values(state.cards).map((c) => {
      const song = this.catalog.byId.get(c.songId)
      return {
        cardId: c.id,
        songId: c.songId,
        title: song?.title ?? '',
        artist: song?.artist ?? '',
        unitColor: song?.unitColor ?? null,
        owner: c.owner,
      }
    })
    return {
      matchId: this.matchId,
      you,
      players: {
        A: this.playerView('A') ?? { id: 'A', nickname: '—', online: false, ready: false, rttMs: null },
        B: this.playerView('B') ?? { id: 'B', nickname: '—', online: false, ready: false, rttMs: null },
      },
      cards,
      layout: state.layout,
      roundNo: state.roundNo,
      phase: state.phase,
      karafudaCount: state.karafuda.length,
      cardsLeft: cardsLeft(state),
    }
  }

  /**
   * 重连后要恢复的一切：牌面 + 记忆倒计时 + 当前回合的截止时刻。
   *
   * 故意**不**补发 roundArm —— 重连的人没有本回合的 clipToken，也没听过音频，
   * 让他等下一回合才是公平的。`round` 只用来告诉他「本回合还在进行，别急」。
   */
  syncMessage(you: PlayerId): ServerMsg {
    const inFlight = this.roundPhase === 'counting' || this.roundPhase === 'open'
    return {
      t: 'stateSync',
      match: this.matchView(you),
      ...(inFlight && this.reading
        ? {
            round: {
              roundNo: this.reading.roundNo,
              endsAtServerTime:
                this.roundStartAt + this.config.windowMs + KARUTA_DEFAULTS.graceSeconds * 1000,
            },
          }
        : {}),
      ...(this.state?.phase === 'memorize' ? { memorizeEndsAtServer: this.memorizeEndsAt } : {}),
    }
  }

  // ── 对局 ──────────────────────────────────────────────

  setReady(player: PlayerId, ready: boolean): void {
    const seat = this.seats[player]
    if (!seat || this.state) return
    seat.ready = ready
    this.touch()
    this.broadcastMatch((p) => ({ t: 'room', room: this.roomView(p) }))
    if ((['A', 'B'] as const).every((p) => this.seats[p]?.ready)) this.startMatch()
  }

  private startMatch(): void {
    const songs: SongRef[] = this.catalog.soloSongs.map((s) => ({
      id: s.id,
      confusableGroup: s.confusableGroup,
      sliceCount: s.sliceCount,
    }))
    const { state, pool } = dealMatch(songs, randomBytes(16).toString('hex'), this.config)
    // ready 在大厅阶段用过一次，进记忆阶段要重置 ——
    // 否则「我记好了」的等待状态一开始就显示成双方都好了
    for (const p of ['A', 'B'] as const) {
      const seat = this.seats[p]
      if (seat) seat.ready = false
    }
    this.state = state
    this.pool = pool
    this.poolById = new Map(pool.map((p) => [p.id, p]))
    this.clipTokens.clear()
    this.rematchVotes.clear()
    this.memorizeEndsAt = Date.now() + KARUTA_DEFAULTS.memorizeSeconds * 1000

    this.broadcastMatch((p) => ({
      t: 'matchStart',
      match: this.matchView(p),
      memorizeEndsAtServer: this.memorizeEndsAt,
    }))
    this.after(KARUTA_DEFAULTS.memorizeSeconds * 1000, () => this.beginPlaying())
  }

  setLayout(player: PlayerId, order: CardId[]): void {
    if (!this.state || this.state.phase !== 'memorize') return
    try {
      this.state = applyLayout(this.state, player, order)
      this.send(player, this.syncMessage(player))
    } catch {
      this.send(player, { t: 'error', code: 'bad_state', message: '布局无效' })
    }
  }

  memorizeDone(player: PlayerId): void {
    const seat = this.seats[player]
    if (!seat || !this.state || this.state.phase !== 'memorize') return
    seat.ready = true
    // 必须广播，否则先点完的人不知道自己在等谁
    this.broadcastMatch((p) => this.syncMessage(p))
    if ((['A', 'B'] as const).every((p) => this.seats[p]?.ready)) {
      this.clearTimers()
      this.beginPlaying()
    }
  }

  private beginPlaying(): void {
    if (!this.state || this.state.phase !== 'memorize') return
    this.state = { ...this.state, phase: 'playing' }
    this.nextRound()
  }

  private nextRound(): void {
    const state = this.state
    if (!state || state.phase === 'over') return

    let picked
    try {
      picked = pickNextReading(state, this.poolById)
    } catch {
      return this.endMatch('cleared')
    }

    this.reading = picked.reading
    this.state = { ...state, usedSlices: { ...state.usedSlices, [picked.reading.songId]: picked.usedSlices } }
    this.taps.clear()
    this.armedBy.clear()
    this.okuriWait = null
    this.roundPhase = 'arming'

    const sliceId = this.catalog.sliceIdFor(picked.reading.songId, picked.reading.sliceIndex)
    if (!sliceId) return this.endMatch('cleared')
    const token = randomBytes(16).toString('hex')
    this.clipTokens.set(token, sliceId)

    const url = `/api/room/${this.code}/clip/${token}`
    this.broadcast({
      t: 'roundArm',
      roundNo: picked.reading.roundNo,
      clipToken: token,
      url,
      // 只在真有 AAC 副本时才报，否则老 Safari 会拿到 404 而不是声音
      ...(this.catalog.aacFallback ? { fallbackUrl: `${url}.m4a` } : {}),
    })

    // 到点无论如何都开始 —— 从不发 clipReady 的客户端照样过回合
    this.after(ARM_TIMEOUT_MS, () => this.startRound())
  }

  clipReady(player: PlayerId, roundNo: number): void {
    if (this.roundPhase !== 'arming' || this.reading?.roundNo !== roundNo) return
    this.armedBy.add(player)
    const online = (['A', 'B'] as const).filter((p) => this.seats[p]?.conn)
    if (online.every((p) => this.armedBy.has(p))) {
      this.clearTimers()
      this.startRound()
    }
  }

  private startRound(): void {
    if (this.roundPhase !== 'arming' || !this.reading) return
    this.clearTimers()
    this.roundPhase = 'counting'

    // 给较慢的一方留出调度余量
    const maxOwd = Math.max(
      ...(['A', 'B'] as const).map((p) => (this.seats[p]?.timing.rttMs ?? 0) / 2),
      0,
    )
    const lead = Math.max(600, 2 * maxOwd + 200)
    this.roundStartAt = Date.now() + lead

    const windowMs = this.config.windowMs
    this.broadcast({
      t: 'roundStart',
      roundNo: this.reading.roundNo,
      startAtServerTime: this.roundStartAt,
      windowMs,
      deadlineMs: windowMs + KARUTA_DEFAULTS.graceSeconds * 1000,
    })

    this.after(lead, () => {
      this.roundPhase = 'open'
    })
    // 回合按服务器定时器结算，永不等待客户端
    this.after(lead + windowMs + KARUTA_DEFAULTS.graceSeconds * 1000, () => this.resolveRound())
  }

  tap(player: PlayerId, roundNo: number, cardId: CardId, reactionMs: number): void {
    if (!this.reading || this.reading.roundNo !== roundNo) return
    if (this.roundPhase !== 'open' && this.roundPhase !== 'counting') return
    if (this.taps.has(player)) return // 一回合只能点一次

    const seat = this.seats[player]
    if (!seat) return

    const judged = seat.timing.adjudicate({
      claimedReactionMs: reactionMs,
      arrivedAtServer: Date.now(),
      roundStartServerTime: this.roundStartAt,
      windowMs: this.config.windowMs,
    })

    this.taps.set(player, {
      player,
      cardId,
      reactionMs: judged.verdict === 'too_early' ? -1 : judged.reactionMs,
      arrivedAt: Date.now(),
      clamped: judged.clamped,
    })

    // 双方都点了就提前结算
    const online = (['A', 'B'] as const).filter((p) => this.seats[p]?.conn)
    if (online.every((p) => this.taps.has(p))) {
      this.clearTimers()
      this.resolveRound()
    }
  }

  /**
   * 回合判定。
   *
   * 若有人要挑送り札，就先把答案揭晓、进 `choosing` 等他挑（或超时），再由 `finishRound` 定案。
   * 判定是纯函数，所以「先跑一遍问人、带着答案重跑一遍」两次的胜负与判定完全一致，
   * 玩家看到的揭晓不会和最终结果对不上。
   */
  private resolveRound(): void {
    const state = this.state
    const reading = this.reading
    if (!state || !reading) return
    if (this.roundPhase === 'revealing' || this.roundPhase === 'choosing') return
    this.clearTimers()

    const taps: Tap[] = [...this.taps.values()].map((t) => ({
      player: t.player,
      cardId: t.cardId,
      reactionMs: t.reactionMs,
    }))

    const provisional = adjudicate(state, reading, taps, this.config)
    // 掉线的人不问——问了也没人答，只会白等满 10 秒
    const pending = pendingSends(provisional).filter((p) => this.seats[p.player]?.conn)

    if (pending.length === 0) {
      this.finishRound(taps, provisional)
      return
    }

    this.roundPhase = 'choosing'
    this.okuriWait = {
      roundNo: reading.roundNo,
      taps,
      needed: new Map(pending.map((p) => [p.player, p.count])),
      choices: { A: [], B: [] },
      submitted: new Set(),
    }

    const song = this.catalog.byId.get(reading.songId)
    this.broadcast({
      t: 'roundReveal',
      roundNo: reading.roundNo,
      kind: reading.kind,
      revealed: {
        songId: reading.songId,
        title: song?.title ?? '',
        artist: song?.artist ?? '',
      },
      taps: provisional.taps.map((t) => this.tapView(t)),
      winner: provisional.winner,
      takenCardId: provisional.transfers.find((t) => t.cause === 'take')?.cardId ?? null,
      pending,
      deadlineAtServer: Date.now() + OKURI_TIMEOUT_MS,
    })

    this.after(OKURI_TIMEOUT_MS, () => {
      if (this.roundPhase === 'choosing') this.finishRound()
    })
  }

  /** 玩家挑好了送り札。不合法的条目由规则引擎静默回落，这里只做形状校验 */
  okuri(player: PlayerId, roundNo: number, cardIds: CardId[]): void {
    const wait = this.okuriWait
    if (!wait || wait.roundNo !== roundNo || this.roundPhase !== 'choosing') return
    if (!wait.needed.has(player) || wait.submitted.has(player)) return

    wait.choices[player] = cardIds.slice(0, wait.needed.get(player) ?? 0)
    wait.submitted.add(player)
    this.touch()

    if ([...wait.needed.keys()].every((p) => wait.submitted.has(p))) {
      this.clearTimers()
      this.finishRound()
    }
  }

  private tapView(t: { player: PlayerId; cardId: CardId; reactionMs: number; verdict: string }) {
    return {
      player: t.player,
      cardId: t.cardId,
      reactionMs: Math.round(t.reactionMs),
      verdict: (this.taps.get(t.player)?.clamped ? 'clamped' : t.verdict) as TapVerdict,
    }
  }

  /** 带上（可能存在的）送り札选择重跑判定并落库 */
  private finishRound(taps?: Tap[], precomputed?: RoundResult): void {
    const state = this.state
    const reading = this.reading
    if (!state || !reading || this.roundPhase === 'revealing') return
    this.clearTimers()

    const wait = this.okuriWait
    const finalTaps =
      taps ??
      wait?.taps ??
      [...this.taps.values()].map((t) => ({ player: t.player, cardId: t.cardId, reactionMs: t.reactionMs }))
    const result =
      precomputed ?? adjudicate(state, reading, finalTaps, this.config, wait?.choices ?? undefined)

    this.okuriWait = null
    this.roundPhase = 'revealing'
    this.state = applyRound(state, result)

    for (const t of result.taps) {
      const seat = this.seats[t.player]
      if (!seat) continue
      if (t.verdict === 'wrong' || t.verdict === 'otetsuki_karafuda' || t.verdict === 'too_early') {
        seat.otetsuki++
      }
    }
    if (result.winner) {
      const seat = this.seats[result.winner]
      if (seat && result.transfers.some((x) => x.cause === 'take')) seat.taken++
    }

    const song = this.catalog.byId.get(reading.songId)
    const view: RoundResultView = {
      roundNo: result.roundNo,
      kind: reading.kind,
      revealed: {
        songId: reading.songId,
        title: song?.title ?? '',
        artist: song?.artist ?? '',
      },
      taps: result.taps.map((t) => this.tapView(t)),
      winner: result.winner,
      transfers: result.transfers,
      cardsLeft: result.cardsLeft,
    }

    this.broadcastMatch((p) => ({ t: 'roundResult', result: view, match: this.matchView(p) }))
    this.touch()

    if (this.state.phase === 'over') {
      this.after(REVEAL_MS, () => this.endMatch('cleared'))
    } else {
      this.after(REVEAL_MS, () => this.nextRound())
    }
  }

  private endMatch(reason: 'cleared' | 'forfeit' | 'disconnect'): void {
    this.clearTimers()
    this.roundPhase = 'idle'
    this.okuriWait = null
    const state = this.state
    if (!state) return
    this.state = { ...state, phase: 'over' }

    const stat = (p: PlayerId) => this.seats[p]
    const stats: MatchStats = {
      rounds: state.history.length,
      taken: { A: stat('A')?.taken ?? 0, B: stat('B')?.taken ?? 0 },
      otetsuki: { A: stat('A')?.otetsuki ?? 0, B: stat('B')?.otetsuki ?? 0 },
      clamped: {
        A: stat('A')?.timing.clampedCount ?? 0,
        B: stat('B')?.timing.clampedCount ?? 0,
      },
      avgReactionMs: {
        A: stat('A')?.timing.avgReactionMs ?? null,
        B: stat('B')?.timing.avgReactionMs ?? null,
      },
    }

    this.broadcastMatch((p) => ({
      t: 'matchEnd',
      winner: this.state?.winner ?? null,
      reason,
      stats,
      match: this.matchView(p),
    }))
  }

  /** 掉线宽限到期 */
  forfeitIfAbandoned(): boolean {
    if (!this.state || this.state.phase === 'over') return false
    for (const p of ['A', 'B'] as const) {
      const seat = this.seats[p]
      if (seat?.disconnectedAt && Date.now() - seat.disconnectedAt > DISCONNECT_GRACE_MS) {
        this.state = { ...this.state, winner: OPPONENT[p] }
        this.endMatch('disconnect')
        return true
      }
    }
    return false
  }

  voteRematch(player: PlayerId, agree: boolean): void {
    if (!this.state || this.state.phase !== 'over') return
    if (agree) this.rematchVotes.add(player)
    else this.rematchVotes.delete(player)
    // 要双方同意才重开，所以先同意的人必须看到自己在等对方
    this.broadcast({ t: 'rematchState', votes: [...this.rematchVotes] })
    if ((['A', 'B'] as const).every((p) => this.rematchVotes.has(p))) {
      for (const p of ['A', 'B'] as const) {
        const seat = this.seats[p]
        if (seat) {
          seat.ready = false
          seat.taken = 0
          seat.otetsuki = 0
        }
      }
      this.state = null
      this.startMatch()
    }
  }

  sliceIdForToken(token: string): string | null {
    return this.clipTokens.get(token) ?? null
  }

  notePing(player: PlayerId, rttMs?: number): void {
    if (rttMs !== undefined) this.seats[player]?.timing.noteRtt(rttMs)
    this.touch()
  }

  // ── 定时器 ────────────────────────────────────────────

  private after(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t)
      fn()
    }, ms)
    this.timers.add(t)
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t)
    this.timers.clear()
  }

  dispose(): void {
    this.clearTimers()
  }
}
