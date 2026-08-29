export type PlayerId = 'A' | 'B'
export type SongId = string
export type CardId = string

export const OPPONENT: Record<PlayerId, PlayerId> = { A: 'B', B: 'A' }

/** game-core 需要知道的曲库信息（不含曲名等展示字段——规则引擎不关心） */
export interface SongRef {
  id: SongId
  /** 易混淆组。同组内去人声后难以区分，一局里最多取 1 首 */
  confusableGroup: string | null
  /** 该曲可用的切片数量。重播必须换切片，所以需要知道有几个 */
  sliceCount: number
}

export interface Card {
  id: CardId
  songId: SongId
  /** null = 已被取走，退出牌场 */
  owner: PlayerId | null
}

export type MatchPhase = 'memorize' | 'playing' | 'over'

/** 一回合的读札：场上札 or 空札 */
export interface Reading {
  roundNo: number
  songId: SongId
  sliceIndex: number
  kind: 'field' | 'karafuda'
}

export type TapVerdict =
  | 'correct'
  | 'wrong'
  | 'otetsuki_karafuda'
  | 'too_early'
  | 'too_late'
  | 'tie'
  | 'none'

export interface Tap {
  player: PlayerId
  cardId: CardId
  /** 相对片段起播的反应时间（毫秒） */
  reactionMs: number
}

export interface Transfer {
  cardId: CardId
  from: PlayerId | 'field'
  to: PlayerId | 'removed'
  cause: 'take' | 'okuri' | 'otetsuki'
}

export interface RoundResult {
  roundNo: number
  reading: Reading
  taps: Array<Tap & { verdict: TapVerdict }>
  winner: PlayerId | null
  transfers: Transfer[]
  cardsLeft: Record<PlayerId, number>
}

export interface MatchState {
  seed: string
  phase: MatchPhase
  roundNo: number
  cards: Record<CardId, Card>
  /** 每人自陣的摆放顺序。送り札按此确定性地送「待得最久」的那张 */
  layout: Record<PlayerId, CardId[]>
  karafuda: SongId[]
  /** songId → 已用过的切片下标。保证同一首歌重播时换一段 */
  usedSlices: Record<SongId, number[]>
  /** 牌已被取走、退出牌池的曲子 */
  retired: SongId[]
  history: RoundResult[]
  winner: PlayerId | null
}

export interface KarutaConfig {
  poolSize: number
  fieldCards: number
  karafuda: number
  tieEpsilonMs: number
  minHumanReactionMs: number
  /** 回合窗口（毫秒），超过即 too_late */
  windowMs: number
}
