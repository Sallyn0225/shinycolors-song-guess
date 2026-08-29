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

export interface RoundResultView {
  roundNo: number
  kind: 'field' | 'karafuda'
  /** 此刻才揭晓答案 */
  revealed: { songId: string; title: string; artist: string; coverUrl: string }
  taps: TapView[]
  winner: PlayerId | null
  transfers: TransferView[]
  cardsLeft: Record<PlayerId, number>
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
  | { t: 'welcome'; playerId: PlayerId; tServer: number; resumeToken: string }
  | { t: 'pong'; seq: number; tClient: number; tServer: number }
  | { t: 'room'; room: RoomView }
  | { t: 'error'; code: ErrCode; message: string }
  | { t: 'matchStart'; match: MatchView; memorizeEndsAtServer: number }
  /** 先发这条让客户端下载解码，**不含任何曲目信息** */
  | { t: 'roundArm'; roundNo: number; clipToken: string; url: string }
  /** 双方都就绪后才定起播时刻，避免慢速下载的一方被不公平地开始 */
  | { t: 'roundStart'; roundNo: number; startAtServerTime: number; windowMs: number; deadlineMs: number }
  | { t: 'roundResult'; result: RoundResultView; match: MatchView }
  | { t: 'stateSync'; match: MatchView; round?: { roundNo: number; endsAtServerTime: number } }
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
