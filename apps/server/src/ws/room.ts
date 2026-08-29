import { randomBytes, randomUUID } from 'node:crypto'

import {
  DIFFICULTY_PRESETS,
  KARUTA_DEFAULTS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type CardId,
  type CardView,
  type MatchStats,
  type MatchView,
  type PlayerId,
  type RoomView,
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
  pickNextReading,
  type KarutaConfig,
  type MatchState,
  type Reading,
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
/** 掉线宽限 */
const DISCONNECT_GRACE_MS = 60_000

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

type RoundPhase = 'idle' | 'arming' | 'counting' | 'open' | 'revealing'

/**
 * 一个 1v1 房间。
 *
 * 规则全部委托给 `@scg/game-core` 的纯函数；这一层只负责传输、计时和权威状态，
 * 所以规则本身可以脱离网络单测。
 */
export class Room {
  readonly code: string
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
  /** 每局重新生成的 token → sliceId。客户端永远看不到 sliceId */
  private clipTokens = new Map<string, string>()
  private timers = new Set<NodeJS.Timeout>()
  private memorizeEndsAt = 0
  private rematchVotes = new Set<PlayerId>()

  lastActivity = Date.now()

  constructor(
    private readonly catalog: Catalog,
    private readonly config: KarutaConfig = {
      poolSize: KARUTA_DEFAULTS.poolSize,
      fieldCards: KARUTA_DEFAULTS.fieldCards,
      karafuda: KARUTA_DEFAULTS.karafuda,
      tieEpsilonMs: KARUTA_DEFAULTS.tieEpsilonMs,
      minHumanReactionMs: KARUTA_DEFAULTS.minHumanReactionMs,
      windowMs: KARUTA_DEFAULTS.roundWindowSeconds * 1000,
    },
    code: string = newRoomCode(),
  ) {
    this.code = code
  }

  // ── 座位 ──────────────────────────────────────────────

  get isEmpty(): boolean {
    return (['A', 'B'] as const).every((p) => this.seats[p] === null)
  }

  get allOffline(): boolean {
    return (['A', 'B'] as const).every((p) => this.seats[p] === null || this.seats[p]?.conn === null)
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

  leave(player: PlayerId): void {
    this.seats[player] = null
    this.clearTimers()
    this.touch()
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

  /** 每人收到的 MatchView 里 `you` 不同，所以要逐人生成 */
  private broadcastMatch(build: (p: PlayerId) => ServerMsg): void {
    for (const p of ['A', 'B'] as const) if (this.seats[p]) this.send(p, build(p))
  }

  roomView(you: PlayerId): RoomView {
    return {
      code: this.code,
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
      this.send(player, { t: 'stateSync', match: this.matchView(player) })
    } catch {
      this.send(player, { t: 'error', code: 'bad_state', message: '布局无效' })
    }
  }

  memorizeDone(player: PlayerId): void {
    const seat = this.seats[player]
    if (!seat || !this.state || this.state.phase !== 'memorize') return
    seat.ready = true
    // 必须广播，否则先点完的人不知道自己在等谁
    this.broadcastMatch((p) => ({ t: 'stateSync', match: this.matchView(p) }))
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
    this.roundPhase = 'arming'

    const sliceId = this.catalog.sliceIdFor(picked.reading.songId, picked.reading.sliceIndex)
    if (!sliceId) return this.endMatch('cleared')
    const token = randomBytes(16).toString('hex')
    this.clipTokens.set(token, sliceId)

    this.broadcast({
      t: 'roundArm',
      roundNo: picked.reading.roundNo,
      clipToken: token,
      url: `/api/room/${this.code}/clip/${token}`,
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

  private resolveRound(): void {
    const state = this.state
    const reading = this.reading
    if (!state || !reading || this.roundPhase === 'revealing') return
    this.clearTimers()
    this.roundPhase = 'revealing'

    const taps: Tap[] = [...this.taps.values()].map((t) => ({
      player: t.player,
      cardId: t.cardId,
      reactionMs: t.reactionMs,
    }))

    const result = adjudicate(state, reading, taps, this.config)
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
        coverUrl: `/cover/${reading.songId}.webp`,
      },
      taps: result.taps.map((t) => ({
        player: t.player,
        cardId: t.cardId,
        reactionMs: Math.round(t.reactionMs),
        verdict: (this.taps.get(t.player)?.clamped ? 'clamped' : t.verdict) as TapVerdict,
      })),
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
