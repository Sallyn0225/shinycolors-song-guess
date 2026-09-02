import {
  ROOM_LIST_MAX,
  clientMsgSchema,
  sanitizeRoomName,
  type LobbyLimits,
  type PlayerId,
  type RoomSummary,
  type ServerMsg,
} from '@scg/shared'

import type { Catalog } from '../catalog.js'
import { SERVER_CONFIG, type RoomQuotas } from '../config.js'
import { IpQuota } from './quota.js'
import { Room, type Connection } from './room.js'

/** 空房间保留时长 */
const ROOM_TTL_MS = 30 * 60 * 1000
/** 单连接的消息速率上限，防刷 */
const RATE_WINDOW_MS = 1000
const RATE_MAX = 60
/** 配额窗口 */
const QUOTA_WINDOW_MS = 60_000
/**
 * 清扫间隔。
 *
 * 从 15s 降到 5s 是因为它现在还兼任「房间状态变了，该重推列表了」的探测器 ——
 * 开局/结束发生在 `Room` 内部，Hub 不在那条调用栈上。
 */
const SWEEP_MS = 5_000
/**
 * 列表推送的合并窗口。
 *
 * 房间变动的自然频率远低于此，250ms 的延迟在「看列表」这个场景里感知不到，
 * 但足以把开局瞬间的一连串变动合并成一条消息。
 */
const LIST_FLUSH_MS = 250

export interface Socket {
  send(data: string): void
  close(): void
}

interface Session {
  socket: Socket
  /** 来源 IP。按 IP 的配额依赖它，正确性依赖 TRUST_PROXY */
  ip: string
  room: Room | null
  playerId: PlayerId | null
  msgTimestamps: number[]
  /** 是否订阅了大厅房间列表。入座后会被自动置回 false */
  listening: boolean
}

export class Hub {
  private readonly rooms = new Map<string, Room>()
  private readonly sessions = new Map<Socket, Session>()
  /**
   * 座位凭证 → 房间。
   *
   * 没有它，重连要遍历所有房间逐个试 `reattach`；房间数上到几百之后这是纯浪费，
   * 而且 `reattach` 成功时有广播副作用，全表扫的正确性只能依赖「token 不碰撞」
   * 这个从未写下来的假设。索引把它变成显式的。
   */
  private readonly bySeatToken = new Map<string, Room>()
  private readonly quota = new IpQuota()
  private readonly sweeper: NodeJS.Timeout
  private flushTimer: NodeJS.Timeout | null = null
  /** 上一次推送出去的列表指纹，用于在清扫时发现「有人开局了」这类 Hub 看不见的变化 */
  private lastSignature = ''

  constructor(
    private readonly catalog: Catalog,
    private readonly limits: RoomQuotas = SERVER_CONFIG.rooms,
  ) {
    this.sweeper = setInterval(() => this.sweep(), SWEEP_MS)
    this.sweeper.unref?.()
  }

  private sweep(): void {
    const now = Date.now()
    for (const room of [...this.rooms.values()]) {
      room.forfeitIfAbandoned()

      const stale = now - room.lastActivity > ROOM_TTL_MS
      // 等待中的房间用 createdAt 而不是 lastActivity 判断 —— 房主自己挂在那里
      // 每 2 秒一次 ping 就会一直 touch()，靠 lastActivity 永远等不到超时
      const waitedTooLong =
        room.status === 'waiting' && now - room.createdAt > this.limits.waitingTtlMs
      /**
       * 全员掉线房间的清扫兜底。
       *
       * 正常情况下，连接断开或玩家主动退出时只要触发 `allOffline`，就会在 `disconnect` /
       * `leaveRoom` 事件里通过 `dropIfDeserted` 立刻被回收，不再等 TTL。
       * 此处保留原有的 `abandonedTtlMs`（默认 65s）仅作为异常路径（如内部状态未触发 disconnect）
       * 的兜底机制，正常运行时不应当命中。
       */
      const abandoned = room.allOffline && now - room.lastActivity > this.limits.abandonedTtlMs

      if (room.isEmpty || stale || waitedTooLong || abandoned) {
        if (waitedTooLong && !room.isEmpty) {
          room.broadcastClosed('idle')
        }
        this.dropRoom(room)
      }
    }
    // 开局/结束这类迁移发生在 Room 内部，只能靠比对指纹发现
    if (this.listeners().length > 0 && this.signature() !== this.lastSignature) {
      this.markListDirty()
    }
  }

  /** 房间退场的唯一出口：销毁定时器、清索引、出表。任何一步漏掉都是泄漏 */
  private dropRoom(room: Room): void {
    for (const p of ['A', 'B'] as const) {
      const token = room.seatOf(p)?.resumeToken
      if (token) this.bySeatToken.delete(token)
    }
    // 房间马上要 dispose 了，任何还指向它的会话必须同步断开引用，
    // 否则它们后续的消息会打在一个已 dispose 的 Room 上
    for (const s of this.sessions.values()) {
      if (s.room === room) {
        s.room = null
        s.playerId = null
      }
    }
    room.dispose()
    this.rooms.delete(room.code)
    this.markListDirty()
  }

  /**
   * 房里一条活连接都不剩就立刻回收。
   *
   * 判的是 `allOffline` 而不是 `isEmpty`：`detach` 只清连接不清座位（为了重连），
   * 所以「一人掉线 + 一人退出」留下的房间既不空、也够不到 ROOM_TTL_MS，
   * 靠 sweep 要等 abandonedTtlMs（默认 65s）+ 一跳清扫。那 70 秒里它会挂在大厅上、
   * 占着公开房名额、还能被自己接回一间没有对手的房。
   *
   * 重连宽限保护的是「还有人在等你回来」；没人在等的时候，它什么也没有保护。
   */
  private dropIfDeserted(room: Room): void {
    if (!room.allOffline) return
    this.dropRoom(room)
  }

  /**
   * 座位被一条新连接接管后，作废所有仍指向该座位的旧会话指针。
   *
   * 半开连接（拔网线、断电）不会发 FIN，最长要等一个协议心跳周期才判死；这段时间里
   * 客户端已经用新 socket `hello` 接回了座位，`reattach` 也把 `seat.conn` 换成了新连接。
   * 但旧 socket 的会话还留在 `sessions` 里，`room` / `playerId` 照旧 —— 等它的 close
   * 迟到时，`disconnect()` 会拿着这份陈旧指针 `detach(pid)`，把**新连接**的座位置空、
   * 广播 peer 离线，若对手此时也不在线还会被 `dropIfDeserted` 当场销毁整个房间。
   *
   * 座位所有权随 `reattach` 转移；转移之后旧会话的指针已经不代表这个座位了。
   *
   * 判据必须同时比对 `room` 和 `playerId`：只比 `room` 会连对手的会话一起误伤。
   */
  private releaseSeatPointers(room: Room, playerId: PlayerId, keep: Session): void {
    for (const s of this.sessions.values()) {
      if (s === keep) continue
      if (s.room === room && s.playerId === playerId) {
        s.room = null
        s.playerId = null
      }
    }
  }

  roomByCode(code: string): Room | null {
    return this.rooms.get(code.toUpperCase()) ?? null
  }

  connect(socket: Socket, ip: string): void {
    this.sessions.set(socket, {
      socket,
      ip,
      room: null,
      playerId: null,
      msgTimestamps: [],
      listening: false,
    })
  }

  disconnect(socket: Socket): void {
    const s = this.sessions.get(socket)
    if (!s) return
    const room = s.room
    // 掉线不立刻踢人：保留座位等重连，宽限到期才判负（若还有人在等）
    if (room && s.playerId) room.detach(s.playerId)
    this.sessions.delete(socket)
    if (room) this.dropIfDeserted(room)
  }

  private conn(socket: Socket): Connection {
    return {
      send: (msg: ServerMsg) => {
        try {
          socket.send(JSON.stringify(msg))
        } catch {
          /* 连接已断 */
        }
      },
      close: () => socket.close(),
    }
  }

  private reply(socket: Socket, msg: ServerMsg): void {
    try {
      socket.send(JSON.stringify(msg))
    } catch {
      /* 连接已断 */
    }
  }

  private rateLimited(s: Session): boolean {
    const now = Date.now()
    s.msgTimestamps = s.msgTimestamps.filter((t) => now - t < RATE_WINDOW_MS)
    s.msgTimestamps.push(now)
    return s.msgTimestamps.length > RATE_MAX
  }

  // ── 房间列表 ──────────────────────────────────────────

  private listeners(): Session[] {
    return [...this.sessions.values()].filter((s) => s.listening)
  }

  /** 公开房间的排序结果。waiting 在前，同组内新房在前 */
  private publicRooms(): Room[] {
    const order: Record<string, number> = { waiting: 0, full: 1, playing: 1 }
    return [...this.rooms.values()]
      .filter((r) => r.visibility === 'public')
      .sort((a, b) => {
        const d = (order[a.status] ?? 9) - (order[b.status] ?? 9)
        return d !== 0 ? d : b.createdAt - a.createdAt
      })
  }

  /** 按可见性分组的房间数。准入判断与列表下发共用同一份口径 */
  private counts(): { publicCount: number; privateCount: number } {
    let publicCount = 0
    let privateCount = 0
    for (const r of this.rooms.values()) {
      if (r.visibility === 'public') publicCount++
      else privateCount++
    }
    return { publicCount, privateCount }
  }

  /** 私人房是否开放。两条配置路（开关 / 上限为 0）在这里合并成一个判断 */
  private get privateAllowed(): boolean {
    return this.limits.allowPrivate && this.limits.privateMax > 0
  }

  /** 下发给客户端的上限。min 掉总闸：分母永远是实际达得到的数 */
  private lobbyLimits(): LobbyLimits {
    return {
      publicMax: Math.min(this.limits.publicMax, this.limits.max),
      privateMax: Math.min(this.limits.privateMax, this.limits.max),
      allowPrivate: this.privateAllowed,
    }
  }

  private buildList(): {
    rooms: RoomSummary[]
    waitingTotal: number
    busyTotal: number
    privateTotal: number
    limits: LobbyLimits
  } {
    const all = this.publicRooms()
    let waitingTotal = 0
    let busyTotal = 0
    // 分组按「能不能加入」：full 和 playing 都进 busy
    for (const r of all) {
      if (r.status === 'waiting') waitingTotal++
      else busyTotal++
    }
    // 两个 total 统计的是**截断前**的全量，客户端才能显示「另有 N 个未显示」。
    // privateTotal 只是个数 —— 私人房的可定位字段（码/名/房主/状态）一个都不出门
    return {
      rooms: all.slice(0, ROOM_LIST_MAX).map((r) => r.summary()),
      waitingTotal,
      busyTotal,
      privateTotal: this.counts().privateCount,
      limits: this.lobbyLimits(),
    }
  }

  private signature(): string {
    return JSON.stringify(this.buildList())
  }

  private markListDirty(): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flushList()
    }, LIST_FLUSH_MS)
    this.flushTimer.unref?.()
  }

  private flushList(): void {
    const targets = this.listeners()
    const payload = this.buildList()
    // 指纹要无条件更新，否则没人订阅时它会一直停在旧值，
    // 等第一个订阅者进来时 sweep 会误判成「变了」再白推一次
    this.lastSignature = JSON.stringify(payload)
    if (targets.length === 0) return
    const msg: ServerMsg = { t: 'roomList', ...payload }
    for (const s of targets) this.reply(s.socket, msg)
  }

  /** 入座即退订：房间里的人不需要列表，这是省掉最大一份广播流量的地方 */
  private seat(s: Session, room: Room, playerId: PlayerId, resumeToken: string): void {
    s.room = room
    s.playerId = playerId
    s.listening = false
    this.bySeatToken.set(resumeToken, room)
    this.markListDirty()
  }

  handle(socket: Socket, raw: string): void {
    const s = this.sessions.get(socket)
    if (!s) return

    if (this.rateLimited(s)) {
      this.reply(socket, { t: 'error', code: 'rate_limited', message: '消息过于频繁' })
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      this.reply(socket, { t: 'error', code: 'bad_message', message: '不是合法的 JSON' })
      return
    }

    // 每条入站消息都要校验 —— TS 的联合类型是编译期虚构，恶意客户端根本不看
    const result = clientMsgSchema.safeParse(parsed)
    if (!result.success) {
      this.reply(socket, { t: 'error', code: 'bad_message', message: '消息格式无效' })
      return
    }
    const msg = result.data

    switch (msg.t) {
      case 'ping': {
        if (s.room && s.playerId) s.room.notePing(s.playerId, msg.rttMs)
        this.reply(socket, { t: 'pong', seq: msg.seq, tClient: msg.tClient, tServer: Date.now() })
        return
      }

      case 'hello': {
        if (msg.resumeToken) {
          const room = this.bySeatToken.get(msg.resumeToken)
          const pid = room?.reattach(msg.resumeToken, this.conn(socket)) ?? null
          if (room && pid) {
            // 座位所有权已经转到这条连接上，先把旧会话的指针作废再指向自己 ——
            // 否则半开的旧 socket 迟到的 close 会把这条新连接 detach 掉
            this.releaseSeatPointers(room, pid, s)
            s.room = room
            s.playerId = pid
            s.listening = false
            this.reply(socket, {
              t: 'welcome',
              playerId: pid,
              tServer: Date.now(),
              resumeToken: msg.resumeToken,
              resumed: true,
            })
            this.reply(socket, { t: 'room', room: room.roomView(pid) })
            try {
              // 牌面、记忆倒计时、当前回合截止时刻一次给全，客户端不需要再问
              this.reply(socket, room.syncMessage(pid))
            } catch {
              /* 对局尚未开始 */
            }
            return
          }
        }
        // 座位已被回收（宽限到期或房间已散）——告诉客户端这是一次全新连接，
        // 别让它继续挂在「重连中」的界面上等一个永远不会来的 stateSync
        this.reply(socket, {
          t: 'welcome',
          playerId: 'A',
          tServer: Date.now(),
          resumeToken: '',
          resumed: false,
        })
        return
      }

      case 'rooms': {
        // 已入座的人订阅列表没有意义，静默忽略而不是报错 ——
        // 客户端在「离开房间」和「收到 room」之间可能有一次竞态发过来
        s.listening = msg.subscribe && s.room === null
        if (s.listening) this.reply(socket, { t: 'roomList', ...this.buildList() })
        return
      }

      case 'createRoom': {
        if (s.room) {
          this.reply(socket, { t: 'error', code: 'bad_state', message: '你已经在一个房间里了' })
          return
        }
        // 顺序是有讲究的：先挡「服务器满了」再挡「你建太多了」，
        // 这样服务器整体过载时所有人收到的是同一条消息，而不是各自以为自己被限流
        if (this.rooms.size >= this.limits.max) {
          this.reply(socket, { t: 'error', code: 'server_busy', message: '服务器房间已满，稍后再试' })
          return
        }
        // 私人房被关掉时说「未开放」比说「已满 0/0」诚实。
        // 漏传 visibility 的老客户端会走到这里被拒 —— schema 默认 private，
        // 把它降级成 public 等于替玩家做了「公开你的房间」这个决定，所以不降级
        if (msg.visibility === 'private' && !this.privateAllowed) {
          this.reply(socket, { t: 'error', code: 'bad_state', message: '本站未开放私人房间' })
          return
        }
        // 分类上限用既有的 server_busy：语义就是「服务器这边容不下了」，由 message 区分哪一类满。
        // 不新增 ErrCode —— 那会让协议面多一个只有一处会发的分支
        const counts = this.counts()
        if (msg.visibility === 'public' && counts.publicCount >= Math.min(this.limits.publicMax, this.limits.max)) {
          this.reply(socket, {
            t: 'error',
            code: 'server_busy',
            message:
              this.privateAllowed
                ? '公开房间已满，可以创建私人房间'
                : '公开房间已满，稍后再试',
          })
          return
        }
        if (msg.visibility === 'private' && counts.privateCount >= Math.min(this.limits.privateMax, this.limits.max)) {
          this.reply(socket, { t: 'error', code: 'server_busy', message: '私人房间已满，稍后再试' })
          return
        }
        let mine = 0
        for (const r of this.rooms.values()) if (r.creatorIp === s.ip) mine++
        if (mine >= this.limits.maxPerIp) {
          this.reply(socket, { t: 'error', code: 'too_many_rooms', message: '你同时开的房间太多了' })
          return
        }
        if (this.quota.hit(s.ip, 'create', QUOTA_WINDOW_MS, this.limits.createPerMin)) {
          this.reply(socket, { t: 'error', code: 'too_many_rooms', message: '建房太频繁，稍后再试' })
          return
        }

        // 清洗后为空就回落到默认名，而不是存一个空标题让列表出现一条无名条目
        const name = sanitizeRoomName(msg.name ?? '') || `${msg.nickname} 的房间`
        const room = new Room(this.catalog, {
          name,
          visibility: msg.visibility,
          creatorIp: s.ip,
        })
        const seat = room.join(msg.nickname, this.conn(socket))
        if (!seat) return
        this.rooms.set(room.code, room)
        this.seat(s, room, seat.playerId, seat.resumeToken)
        this.reply(socket, {
          t: 'welcome',
          playerId: seat.playerId,
          tServer: Date.now(),
          resumeToken: seat.resumeToken,
          resumed: false,
        })
        this.reply(socket, { t: 'room', room: room.roomView(seat.playerId) })
        return
      }

      case 'joinRoom': {
        if (s.room) {
          this.reply(socket, { t: 'error', code: 'bad_state', message: '你已经在一个房间里了' })
          return
        }
        // 失败次数一旦超限就直接拒绝，**不再查表** ——
        // 这是私人房间不被暴力枚举的实际保障，比房间码本身的熵更重要
        // `>=` 而不是 `>`：joinFailPerMin 是「允许失败几次」，
        // 攒够了这一次就该拒。用 `>` 会实际放行 N+1 次
        if (this.quota.peek(s.ip, 'joinFail', QUOTA_WINDOW_MS) >= this.limits.joinFailPerMin) {
          this.reply(socket, { t: 'error', code: 'rate_limited', message: '尝试过于频繁，稍后再试' })
          return
        }

        const room = this.roomByCode(msg.code)
        if (!room) {
          this.quota.hit(s.ip, 'joinFail', QUOTA_WINDOW_MS, this.limits.joinFailPerMin)
          this.reply(socket, { t: 'error', code: 'room_not_found', message: '房间不存在' })
          return
        }
        const seat = room.join(msg.nickname, this.conn(socket))
        if (!seat) {
          this.quota.hit(s.ip, 'joinFail', QUOTA_WINDOW_MS, this.limits.joinFailPerMin)
          this.reply(socket, { t: 'error', code: 'room_full', message: '房间已满' })
          return
        }
        this.seat(s, room, seat.playerId, seat.resumeToken)
        this.reply(socket, {
          t: 'welcome',
          playerId: seat.playerId,
          tServer: Date.now(),
          resumeToken: seat.resumeToken,
          resumed: false,
        })
        for (const p of ['A', 'B'] as const) {
          const other = room.seatOf(p)
          if (other?.conn) other.conn.send({ t: 'room', room: room.roomView(p) })
        }
        return
      }

      default:
        break
    }

    // 以下都要求已入座
    if (!s.room || !s.playerId) {
      this.reply(socket, { t: 'error', code: 'not_in_room', message: '尚未加入房间' })
      return
    }
    const room = s.room
    const me = s.playerId

    switch (msg.t) {
      case 'leaveRoom': {
        const token = room.seatOf(me)?.resumeToken
        if (token) this.bySeatToken.delete(token)
        room.leave(me)
        s.room = null
        s.playerId = null
        this.markListDirty()
        this.dropIfDeserted(room)
        break
      }
      case 'ready':
        room.setReady(me, msg.ready)
        // ready 可能直接触发开局，房间状态会从 full 变成 playing
        this.markListDirty()
        break
      case 'layout':
        room.setLayout(me, msg.order)
        break
      case 'memorizeDone':
        room.memorizeDone(me)
        break
      case 'clipReady':
        room.clipReady(me, msg.roundNo)
        break
      case 'tap':
        room.tap(me, msg.roundNo, msg.cardId, msg.reactionMs)
        break
      case 'okuri':
        room.okuri(me, msg.roundNo, msg.cardIds)
        break
      case 'rematch':
        room.voteRematch(me, msg.agree)
        break
      default:
        break
    }
  }

  dispose(): void {
    clearInterval(this.sweeper)
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    for (const room of this.rooms.values()) room.dispose()
    this.rooms.clear()
    this.bySeatToken.clear()
  }
}
