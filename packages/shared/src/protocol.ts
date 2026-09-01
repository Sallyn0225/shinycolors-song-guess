import { z } from 'zod'

export type PlayerId = 'A' | 'B'
export type CardId = string
export type RoomCode = string

/** 房间码字符集：Crockford base32 去掉 I/L/O/U——语音报码不会念混，也不会拼出脏话 */
export const ROOM_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const ROOM_CODE_LENGTH = 6

/** 房间名显示上限。一行放得下，不会把列表撑歪 */
export const ROOM_NAME_MAX = 24
/** 单次 roomList 推送的条目上限。超出的部分只由 waitingTotal / busyTotal 反映 */
export const ROOM_LIST_MAX = 80

/**
 * 房间可见性。
 *
 * `public` 会出现在大厅列表里，任何人都能点进来；`private` 只能靠房间码进。
 * **协议层的默认值必须是 `private`** —— 漏传字段的失败方向只能是「不暴露」。
 */
export type RoomVisibility = 'public' | 'private'

/** 列表里一条房间的状态。`playing` = 已开局，`full` = 满员但还在大厅 */
export type RoomStatus = 'waiting' | 'full' | 'playing'

/**
 * 房间名归一化。
 *
 * 列表是公网上任何人都能写入的展示面，所以这里挡的不是「不好看」而是三类攻击：
 * - **控制字符**（C0/C1/DEL）：能在终端和部分日志里造成错行
 * - **零宽字符**：肉眼不可见，可以伪造出两个「看起来一模一样」的房间名骗人点错
 * - **双向覆写**（U+202A–202E / U+2066–2069）：能让显示顺序与实际字符串相反，
 *   是经典的视觉欺骗手段
 *
 * 返回空串表示这个名字整体不可用，调用方应当回落到默认名而不是存一个空标题。
 *
 * 放在 shared 而不是 server：前端要在输入时给出同样的即时反馈，
 * 两边必须是同一份实现，否则「前端显示合法、后端存下来变了样」的漂移无法避免。
 */
export function sanitizeRoomName(raw: string): string {
  let out = ''
  // 按码点遍历：不能用 for(i) 逐个 charAt，那会把 emoji 的代理对拆成两半
  for (const ch of raw) {
    const c = ch.codePointAt(0) as number
    // C0 / DEL / C1 控制字符
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f)) continue
    // 零宽字符
    if ((c >= 0x200b && c <= 0x200f) || c === 0xfeff) continue
    if (c >= 0x2060 && c <= 0x2064) continue
    // 双向覆写
    if ((c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069)) continue
    out += ch
  }
  // 折叠所有空白（含全角空格）为单个半角空格，否则可以用一串空格顶掉别人的房间名
  const collapsed = out.replace(/\s+/g, ' ').trim()
  // 截断同样按码点。用 slice() 会在代理对中间下刀，末尾的 emoji 会变成半个乱码
  return Array.from(collapsed).slice(0, ROOM_NAME_MAX).join('')
}

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
  name: string
  visibility: RoomVisibility
  you: PlayerId
  players: Record<PlayerId, PlayerView | null>
  phase: MatchPhase
}

/**
 * 大厅列表里的一条房间。
 *
 * **只由公开房间生成** —— 私人房间在任何情况下都不会出现在这个结构里，
 * 也不计入 `roomList` 的两个总数。这是「私人」二字唯一的技术含义。
 *
 * 不含建房者 IP、不含对局内容、不含任何曲目线索：列表是公网上匿名可读的面，
 * 放进来的每个字段都等于公开。
 */
export interface RoomSummary {
  code: RoomCode
  name: string
  /** 房主（A 座）昵称。B 座昵称不下发——列表只需要回答「谁开的房」 */
  host: string
  /** 1 或 2 */
  players: number
  status: RoomStatus
  /** 服务器时刻。客户端用 socket 的时钟偏移换算成「几分钟前」 */
  createdAt: number
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
  z.object({
    t: z.literal('createRoom'),
    nickname,
    /**
     * 原始房间名。这里只做长度兜底（防分配攻击），语义清洗交给 `sanitizeRoomName` ——
     * 清洗会删字符，先用 max(24) 卡会把「24 个可见字符 + 几个零宽」误判成超长。
     */
    name: z.string().max(64).optional(),
    /** 默认 private：漏传字段时的失败方向只能是「不暴露」 */
    visibility: z.enum(['public', 'private']).default('private'),
  }),
  z.object({ t: z.literal('joinRoom'), code: roomCode, nickname }),
  z.object({ t: z.literal('leaveRoom') }),
  /** 订阅/退订大厅房间列表。入座后服务端会自动退订，不必客户端再发一次 */
  z.object({ t: z.literal('rooms'), subscribe: z.boolean() }),
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

/**
 * 客户端**可以发送**的消息。
 *
 * 用 `z.input` 而不是 `z.infer`（= `z.output`）：`createRoom.visibility` 带 `.default()`，
 * 输出类型里它是必填的，输入类型里才是可选的。发送方要的是后者。
 *
 * 服务端不该用这个类型 —— `hub.ts` 拿的是 `safeParse` 的 `result.data`，
 * 那是输出类型，默认值已经填好，`visibility` 在那一侧必定存在。
 * 两个类型仍然都由同一个 schema 推导，不存在手写漂移。
 */
export type ClientMsg = z.input<typeof clientMsgSchema>

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
  /** 全局房间数已达上限。与 `too_many_rooms` 分开：这条是「服务器满了」，不是「你建太多了」 */
  | 'server_busy'
  /** 单个来源建房过多或过快 */
  | 'too_many_rooms'
  | 'internal'

export type ServerMsg =
  /** `resumed` = 这次连接接管了原来的座位（带 resumeToken 重连成功），而不是新开一局 */
  | { t: 'welcome'; playerId: PlayerId; tServer: number; resumeToken: string; resumed: boolean }
  | { t: 'pong'; seq: number; tClient: number; tServer: number }
  | { t: 'room'; room: RoomView }
  /**
   * 大厅房间列表。只发给订阅了的连接（`{t:'rooms',subscribe:true}`），入座后自动停发。
   *
   * `rooms` 至多 `ROOM_LIST_MAX` 条，两个 total 是**截断前**的总数 ——
   * 少了它们，客户端无法区分「只有这么多房间」和「还有一堆没显示」。
   *
   * 分组是按**能不能加入**，不是按有没有开局：`busyTotal` 同时包含 `full`（满员还在大厅）
   * 和 `playing`（已开局）。把 `full` 算进一个叫 playing 的字段会让 UI 只能撒谎。
   */
  | { t: 'roomList'; rooms: RoomSummary[]; waitingTotal: number; busyTotal: number }
  /**
   * 房间被服务端单方面关闭，客户端应当退回大厅。
   *
   * 刻意**不复用** `error`：房间内的 error 是「这次操作没成功，你还在房间里」，
   * 而这条的含义是「房间没了」。前端无法从一条 `bad_state` 里读出后者，
   * 混用会让人卡在一个已经不存在的房间界面上。
   */
  | { t: 'roomClosed'; reason: 'idle' }
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
