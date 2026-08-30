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

/**
 * 一次「从自陣送一张牌给对手」的记录。
 *
 * 取敵陣的送り札和お手つき的罚牌其实是同一件事——都是某一方要从自陣挑一张送出去。
 * 记下 `candidates` 是为了让上层能把**当时**合法的选项原样问给玩家：
 * 一回合里同一个人可能要送两张（取敵陣 + 对手お手つき），第二张的可选集合已经变了。
 */
export interface SendRecord {
  from: PlayerId
  to: PlayerId
  cause: 'okuri' | 'otetsuki'
  cardId: CardId
  /** 做这次选择时 `from` 自陣的全部牌（含最终送出的那张） */
  candidates: CardId[]
  /** true = 用了玩家自选；false = 回落到「送自陣待得最久的那张」 */
  chosen: boolean
}

/**
 * 玩家本回合想送出的牌，按顺序排队消费。
 *
 * 队列而不是单值：一回合里同一个人可能要送两张。
 * 不合法的条目（不在自陣、已送出）会被跳过并回落到自动规则——
 * 规则引擎永远能算出一个结果，不会因为客户端乱报而卡住。
 */
export type SendChoices = Partial<Record<PlayerId, readonly CardId[]>>

export interface RoundResult {
  roundNo: number
  reading: Reading
  taps: Array<Tap & { verdict: TapVerdict }>
  winner: PlayerId | null
  transfers: Transfer[]
  /** 本回合发生的送札，按发生顺序。`transfers` 里对应的是 okuri/otetsuki 两类 */
  sends: SendRecord[]
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
