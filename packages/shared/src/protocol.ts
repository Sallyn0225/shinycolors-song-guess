import { z } from 'zod'

export type PlayerId = 'A' | 'B'
export type CardId = string
export type RoomCode = string

/** 房间码字符集：Crockford base32 去掉 I/L/O/U——语音报码不会念混，也不会拼出脏话 */
export const ROOM_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const ROOM_CODE_LENGTH = 6

// ─────────────────────────────────────────────────────────
// 下发给客户端的视图
// ─────────────────────────────────────────────────────────

export interface PlayerView {
  id: PlayerId
  nickname: string
  online: boolean
  ready: boolean
  /** 双方的 RTT 都公开 —— 透明比假装公平重要 */
  rttMs: number | null
}

/**
 * 牌面。歌牌规则本来就是公开的，所以曲名必须下发；
 * 但**当前正在播的是哪首**永不下发，客户端只拿到一个不透明 token。
 */
export interface CardView {
  cardId: CardId
  songId: string
  title: string
  artist: string
  unitColor: string | null
  /** null = 已被取走，退出牌场 */
  owner: PlayerId | null
}

export type MatchPhase = 'lobby' | 'memorize' | 'playing' | 'over'

export interface MatchView {
  matchId: string
  /** 你是哪一方 */
  you: PlayerId
  players: Record<PlayerId, PlayerView>
  cards: CardView[]
  layout: Record<PlayerId, CardId[]>
  roundNo: number
  phase: MatchPhase
  karafudaCount: number
  cardsLeft: Record<PlayerId, number>
}

export interface RoomView {
  code: RoomCode
  you: PlayerId
  players: Record<PlayerId, PlayerView | null>
  phase: MatchPhase
}

export type TapVerdict =
  | 'correct'
  | 'wrong'
  | 'otetsuki_karafuda'
  | 'too_early'
  | 'too_late'
  | 'tie'
  | 'clamped'
  | 'none'

export interface TapView {
  player: PlayerId
  cardId: CardId
  reactionMs: number
  verdict: TapVerdict
}

export interface TransferView {
  cardId: CardId
  from: PlayerId | 'field'
  to: PlayerId | 'removed'
  cause: 'take' | 'okuri' | 'otetsuki'
}

/** 此刻才揭晓的答案 */
export interface RevealView {
  songId: string
  title: string
  artist: string
  coverUrl: string
}

export interface RoundResultView {
  roundNo: number
  kind: 'field' | 'karafuda'
  revealed: RevealView
  taps: TapView[]
  winner: PlayerId | null
  transfers: TransferView[]
  cardsLeft: Record<PlayerId, number>
}

/** 某一方要挑几张送り札、能从哪些牌里挑 */
export interface OkuriPending {
  player: PlayerId
  count: number
  /** 第一次选择时的可选集合。要送两张时后一张由展示层自行排除已选的 */
  candidates: CardId[]
}

export interface MatchStats {
  rounds: number
  taken: Record<PlayerId, number>
  otetsuki: Record<PlayerId, number>
  /** 反应时间被服务端校正的次数。赛后公示，靠社交压力约束而不是封禁 */
  clamped: Record<PlayerId, number>
  avgReactionMs: Record<PlayerId, number | null>
}

// ─────────────────────────────────────────────────────────
// 客户端 → 服务端
// ─────────────────────────────────────────────────────────

const nickname = z.string().trim().min(1).max(16)
const roomCode = z
  .string()
  .trim()
  .toUpperCase()
  .length(ROOM_CODE_LENGTH)
  .regex(new RegExp(`^[${ROOM_CODE_ALPHABET}]+$`))

export const clientMsgSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('hello'), resumeToken: z.string().max(200).optional() }),
  z.object({
    t: z.literal('ping'),
    seq: z.number().int().nonnegative(),
    tClient: z.number(),
    /**
     * 客户端自己测得的 RTT。
     * 服务端无法在不主动探测的情况下独立测量单向延迟，所以这个值只能由客户端提供——
     * 服务端会做区间钳制并用历史到达时间自校准，不会照单全收。
     */
    rttMs: z.number().nonnegative().max(5000).optional(),
  }),
  z.object({ t: z.literal('createRoom'), nickname }),
  z.object({ t: z.literal('joinRoom'), code: roomCode, nickname }),
  z.object({ t: z.literal('leaveRoom') }),
  z.object({ t: z.literal('ready'), ready: z.boolean() }),
  /** 记忆阶段重排自陣。必须是自陣现有牌的一个排列 */
  z.object({ t: z.literal('layout'), order: z.array(z.string().max(40)).max(64) }),
  z.object({ t: z.literal('memorizeDone') }),
  /** 音频已下载并解码完毕。双方都 ready 或超时后服务器才定起播时刻 */
  z.object({ t: z.literal('clipReady'), roundNo: z.number().int().nonnegative() }),
  z.object({
    t: z.literal('tap'),
    roundNo: z.number().int().nonnegative(),
    cardId: z.string().max(40),
    /** 相对片段起播的反应时间。服务端会做交叉校验，不会照单全收 */
    reactionMs: z.number().finite(),
  }),
  /**
   * 本回合要送出的牌，按顺序。一回合可能要送两张（取敵陣 + 对手お手つき）。
   * 不合法或不够数时服务端静默回落到自动规则，不会报错也不会卡住回合。
   */
  z.object({
    t: z.literal('okuri'),
    roundNo: z.number().int().nonnegative(),
    cardIds: z.array(z.string().max(40)).max(4),
  }),
  z.object({ t: z.literal('rematch'), agree: z.boolean() }),
])

export type ClientMsg = z.infer<typeof clientMsgSchema>

// ─────────────────────────────────────────────────────────
// 服务端 → 客户端
// ─────────────────────────────────────────────────────────

export type ErrCode =
  | 'room_not_found'
  | 'room_full'
  | 'not_in_room'
  | 'bad_state'
  | 'bad_message'
  | 'rate_limited'
  | 'internal'

export type ServerMsg =
  /** `resumed` = 这次连接接管了原来的座位（带 resumeToken 重连成功），而不是新开一局 */
  | { t: 'welcome'; playerId: PlayerId; tServer: number; resumeToken: string; resumed: boolean }
  | { t: 'pong'; seq: number; tClient: number; tServer: number }
  | { t: 'room'; room: RoomView }
  | { t: 'error'; code: ErrCode; message: string }
  | { t: 'matchStart'; match: MatchView; memorizeEndsAtServer: number }
  /** 先发这条让客户端下载解码，**不含任何曲目信息**。`fallbackUrl` 是 AAC 兜底（老 Safari 放不了 Ogg Opus） */
  | { t: 'roundArm'; roundNo: number; clipToken: string; url: string; fallbackUrl?: string }
  /** 双方都就绪后才定起播时刻，避免慢速下载的一方被不公平地开始 */
  | { t: 'roundStart'; roundNo: number; startAtServerTime: number; windowMs: number; deadlineMs: number }
  /**
   * 只在**有人要挑送り札**时才发：先把答案揭晓，再等人挑，最后才发 roundResult。
   * 没有送札的回合直接发 roundResult，不走这条——少一次往返，节奏也不被打断。
   */
  | {
      t: 'roundReveal'
      roundNo: number
      kind: 'field' | 'karafuda'
      revealed: RevealView
      taps: TapView[]
      winner: PlayerId | null
      /** 被取走的那张牌，用于在牌场上标出答案 */
      takenCardId: CardId | null
      pending: OkuriPending[]
      deadlineAtServer: number
    }
  | { t: 'roundResult'; result: RoundResultView; match: MatchView }
  | {
      t: 'stateSync'
      match: MatchView
      round?: { roundNo: number; endsAtServerTime: number }
      /** 记忆阶段重连时要拿回倒计时的终点 */
      memorizeEndsAtServer?: number
    }
  | { t: 'peer'; playerId: PlayerId; online: boolean; graceEndsAtServer?: number }
  /** 再战投票状态。要双方都同意才会重开，所以必须让人看到对方同意了没有 */
  | { t: 'rematchState'; votes: PlayerId[] }
  | {
      t: 'matchEnd'
      winner: PlayerId | null
      reason: 'cleared' | 'forfeit' | 'disconnect'
      stats: MatchStats
      match: MatchView
    }

export function encode(msg: ServerMsg | ClientMsg): string {
  return JSON.stringify(msg)
}
