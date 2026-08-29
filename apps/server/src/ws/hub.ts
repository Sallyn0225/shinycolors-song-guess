import { clientMsgSchema, type PlayerId, type ServerMsg } from '@scg/shared'

import type { Catalog } from '../catalog.js'
import { Room, type Connection } from './room.js'

/** 空房间保留时长 */
const ROOM_TTL_MS = 30 * 60 * 1000
/** 单连接的消息速率上限，防刷 */
const RATE_WINDOW_MS = 1000
const RATE_MAX = 60

export interface Socket {
  send(data: string): void
  close(): void
}

interface Session {
  socket: Socket
  room: Room | null
  playerId: PlayerId | null
  msgTimestamps: number[]
}

export class Hub {
  private readonly rooms = new Map<string, Room>()
  private readonly sessions = new Map<Socket, Session>()
  private readonly sweeper: NodeJS.Timeout

  constructor(private readonly catalog: Catalog) {
    this.sweeper = setInterval(() => this.sweep(), 15_000)
    this.sweeper.unref?.()
  }

  private sweep(): void {
    for (const [code, room] of this.rooms) {
      room.forfeitIfAbandoned()
      const stale = Date.now() - room.lastActivity > ROOM_TTL_MS
      if (room.isEmpty || stale) {
        room.dispose()
        this.rooms.delete(code)
      }
    }
  }

  roomByCode(code: string): Room | null {
    return this.rooms.get(code.toUpperCase()) ?? null
  }

  connect(socket: Socket): void {
    this.sessions.set(socket, { socket, room: null, playerId: null, msgTimestamps: [] })
  }

  disconnect(socket: Socket): void {
    const s = this.sessions.get(socket)
    if (!s) return
    // 掉线不立刻踢人：保留座位等重连，宽限到期才判负
    if (s.room && s.playerId) s.room.detach(s.playerId)
    this.sessions.delete(socket)
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
          for (const room of this.rooms.values()) {
            const pid = room.reattach(msg.resumeToken, this.conn(socket))
            if (pid) {
              s.room = room
              s.playerId = pid
              this.reply(socket, {
                t: 'welcome',
                playerId: pid,
                tServer: Date.now(),
                resumeToken: msg.resumeToken,
              })
              this.reply(socket, { t: 'room', room: room.roomView(pid) })
              try {
                this.reply(socket, { t: 'stateSync', match: room.matchView(pid) })
              } catch {
                /* 对局尚未开始 */
              }
              return
            }
          }
        }
        this.reply(socket, { t: 'welcome', playerId: 'A', tServer: Date.now(), resumeToken: '' })
        return
      }

      case 'createRoom': {
        const room = new Room(this.catalog)
        const seat = room.join(msg.nickname, this.conn(socket))
        if (!seat) return
        this.rooms.set(room.code, room)
        s.room = room
        s.playerId = seat.playerId
        this.reply(socket, {
          t: 'welcome',
          playerId: seat.playerId,
          tServer: Date.now(),
          resumeToken: seat.resumeToken,
        })
        this.reply(socket, { t: 'room', room: room.roomView(seat.playerId) })
        return
      }

      case 'joinRoom': {
        const room = this.roomByCode(msg.code)
        if (!room) {
          this.reply(socket, { t: 'error', code: 'room_not_found', message: '房间不存在' })
          return
        }
        const seat = room.join(msg.nickname, this.conn(socket))
        if (!seat) {
          this.reply(socket, { t: 'error', code: 'room_full', message: '房间已满' })
          return
        }
        s.room = room
        s.playerId = seat.playerId
        this.reply(socket, {
          t: 'welcome',
          playerId: seat.playerId,
          tServer: Date.now(),
          resumeToken: seat.resumeToken,
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
      case 'leaveRoom':
        room.leave(me)
        s.room = null
        s.playerId = null
        break
      case 'ready':
        room.setReady(me, msg.ready)
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
      case 'rematch':
        room.voteRematch(me, msg.agree)
        break
      default:
        break
    }
  }

  dispose(): void {
    clearInterval(this.sweeper)
    for (const room of this.rooms.values()) room.dispose()
    this.rooms.clear()
  }
}
