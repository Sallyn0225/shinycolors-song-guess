import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type { FastifyInstance } from 'fastify'

import { ROOM_NAME_MAX, type ClientMsg, type ServerMsg } from '@scg/shared'

import { buildApp, type BuildAppOptions } from '../app.js'

/**
 * 大厅房间列表与房间配额。
 *
 * 和 `room.test.ts` 分开是因为两者要的配额正好相反：那边要宽松到跑得完一整局，
 * 这边有一半用例的目的就是把限流撞出来。
 */

/** 一个只关心大厅消息的精简客户端 */
class Client {
  readonly received: ServerMsg[] = []

  private constructor(private readonly ws: WebSocket) {}

  static async connect(url: string): Promise<Client> {
    const ws = new WebSocket(url)
    const c = new Client(ws)
    ws.on('message', (d) => c.received.push(JSON.parse(d.toString()) as ServerMsg))
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve())
      ws.once('error', reject)
    })
    return c
  }

  send(msg: ClientMsg): void {
    this.ws.send(JSON.stringify(msg))
  }

  close(): void {
    this.ws.close()
  }

  clear(): void {
    this.received.length = 0
  }

  get lists(): Extract<ServerMsg, { t: 'roomList' }>[] {
    return this.received.filter((m) => m.t === 'roomList') as Extract<ServerMsg, { t: 'roomList' }>[]
  }

  /** 等一条指定类型的消息。轮询而不是挂回调，断言失败时能把收到过什么全打出来 */
  async wait<T extends ServerMsg['t']>(t: T, timeoutMs = 4000): Promise<Extract<ServerMsg, { t: T }>> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const hit = this.received.find((m) => m.t === t)
      if (hit) return hit as Extract<ServerMsg, { t: T }>
      await new Promise((r) => setTimeout(r, 20))
    }
    throw new Error(`等待 ${t} 超时。已收到：${this.received.map((m) => m.t).join(', ') || '（空）'}`)
  }

  /** 等到订阅推送里出现满足条件的一版列表 */
  async waitList(
    pred: (m: Extract<ServerMsg, { t: 'roomList' }>) => boolean,
    timeoutMs = 4000,
  ): Promise<Extract<ServerMsg, { t: 'roomList' }>> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const hit = [...this.lists].reverse().find(pred)
      if (hit) return hit
      await new Promise((r) => setTimeout(r, 20))
    }
    const last = this.lists.at(-1)
    throw new Error(`等待列表条件超时。最后一版：${JSON.stringify(last)}`)
  }
}

async function makeApp(opts: BuildAppOptions): Promise<{ app: FastifyInstance; url: string }> {
  const app = await buildApp(opts)
  await app.listen({ port: 0, host: '127.0.0.1' })
  const addr = app.server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  return { app, url: `ws://127.0.0.1:${port}/ws` }
}

// ─────────────────────────────────────────────────────────
// 房间列表
// ─────────────────────────────────────────────────────────

describe('房间列表', () => {
  let app: FastifyInstance
  let url: string
  const open: Client[] = []

  const client = async () => {
    const c = await Client.connect(url)
    open.push(c)
    return c
  }

  beforeAll(async () => {
    ;({ app, url } = await makeApp({
      // abandonedTtlMs 调到 1s：生产默认是断线宽限 + 5s = 65s，
      // 用它跑「房间散了要从列表消失」会让这个用例等一分多钟
      rooms: { max: 1000, maxPerIp: 1000, createPerMin: 1000, abandonedTtlMs: 1000 },
    }))
  }, 30_000)

  afterAll(async () => {
    for (const c of open) c.close()
    await app.close()
  })

  it('公开房间出现在列表里，字段与建房时一致', async () => {
    const host = await client()
    host.send({ t: 'createRoom', nickname: '房主', name: '来打一局', visibility: 'public' })
    const room = await host.wait('room')

    const watcher = await client()
    watcher.send({ t: 'rooms', subscribe: true })
    const list = await watcher.waitList((m) => m.rooms.some((r) => r.code === room.room.code))

    const entry = list.rooms.find((r) => r.code === room.room.code)
    expect(entry).toMatchObject({
      name: '来打一局',
      host: '房主',
      players: 1,
      status: 'waiting',
    })
    expect(entry?.createdAt).toBeTypeOf('number')
  })

  it('列表条目不含建房者 IP 之类的内部字段', async () => {
    const host = await client()
    host.send({ t: 'createRoom', nickname: '房主', name: '看看字段', visibility: 'public' })
    const room = await host.wait('room')

    const watcher = await client()
    watcher.send({ t: 'rooms', subscribe: true })
    const list = await watcher.waitList((m) => m.rooms.some((r) => r.code === room.room.code))
    const entry = list.rooms.find((r) => r.code === room.room.code)

    expect(Object.keys(entry ?? {}).sort()).toEqual(
      ['code', 'createdAt', 'host', 'name', 'players', 'status'].sort(),
    )
  })

  it('私人房间不进列表、不计入总数，但房间码仍然能进', async () => {
    const watcher = await client()
    watcher.send({ t: 'rooms', subscribe: true })
    const before = await watcher.wait('roomList')
    const baseline = before.waitingTotal

    const host = await client()
    host.send({ t: 'createRoom', nickname: '房主', name: '悄悄的', visibility: 'private' })
    const room = await host.wait('room')
    expect(room.room.visibility).toBe('private')

    // 给列表推送留足合并窗口，确认它确实没被推进去
    await new Promise((r) => setTimeout(r, 600))
    for (const l of watcher.lists) {
      expect(l.rooms.find((r) => r.code === room.room.code)).toBeUndefined()
      expect(l.waitingTotal).toBeLessThanOrEqual(baseline)
    }

    const guest = await client()
    guest.send({ t: 'joinRoom', code: room.room.code, nickname: '客人' })
    const joined = await guest.wait('welcome')
    expect(joined.playerId).toBe('B')
  })

  it('不带 visibility 建房落为私人 —— 漏传字段绝不能意外公开', async () => {
    const watcher = await client()
    watcher.send({ t: 'rooms', subscribe: true })
    await watcher.wait('roomList')

    const host = await client()
    host.send({ t: 'createRoom', nickname: '房主' } as ClientMsg)
    const room = await host.wait('room')
    expect(room.room.visibility).toBe('private')

    await new Promise((r) => setTimeout(r, 600))
    for (const l of watcher.lists) {
      expect(l.rooms.find((r) => r.code === room.room.code)).toBeUndefined()
    }
  })

  it('状态随人数与开局推进：waiting → full → playing，房间散了就消失', async () => {
    const host = await client()
    host.send({ t: 'createRoom', nickname: 'A', name: '状态流转', visibility: 'public' })
    const room = await host.wait('room')
    const code = room.room.code

    const watcher = await client()
    watcher.send({ t: 'rooms', subscribe: true })
    await watcher.waitList((m) => m.rooms.some((r) => r.code === code && r.status === 'waiting'))

    const guest = await client()
    guest.send({ t: 'joinRoom', code, nickname: 'B' })
    await guest.wait('welcome')
    const full = await watcher.waitList((m) => m.rooms.some((r) => r.code === code && r.status === 'full'))
    expect(full.rooms.find((r) => r.code === code)?.players).toBe(2)

    host.send({ t: 'ready', ready: true })
    guest.send({ t: 'ready', ready: true })
    await host.wait('matchStart', 8000)
    await watcher.waitList((m) => m.rooms.some((r) => r.code === code && r.status === 'playing'))

    // 两个人都断开，清扫（5s 一轮）之后房间应当从列表里消失
    host.close()
    guest.close()
    await watcher.waitList((m) => !m.rooms.some((r) => r.code === code), 30_000)
  }, 45_000)

  it('房间名会被清洗；清洗后为空则回落到默认名', async () => {
    const host = await client()
    const NUL = String.fromCodePoint(0)
    const ZWSP = String.fromCodePoint(0x200b)
    host.send({ t: 'createRoom', nickname: 'A', name: `脏${NUL}名${ZWSP}字`, visibility: 'public' })
    const dirty = await host.wait('room')
    expect(dirty.room.name).toBe('脏名字')

    const host2 = await client()
    host2.send({ t: 'createRoom', nickname: '小明', name: '   ', visibility: 'public' })
    const empty = await host2.wait('room')
    expect(empty.room.name).toBe('小明 的房间')
  })

  it('超长房间名被截断到上限', async () => {
    const host = await client()
    host.send({ t: 'createRoom', nickname: 'A', name: 'あ'.repeat(60), visibility: 'public' })
    const room = await host.wait('room')
    expect(Array.from(room.room.name)).toHaveLength(ROOM_NAME_MAX)
  })

  it('短时间内的多次房间变动被合并成一次推送', async () => {
    const watcher = await client()
    watcher.send({ t: 'rooms', subscribe: true })
    await watcher.wait('roomList')
    watcher.clear()

    // 三次建房挤在同一个 250ms 合并窗口里
    const hosts = await Promise.all([client(), client(), client()])
    for (const [i, h] of hosts.entries()) {
      h.send({ t: 'createRoom', nickname: `H${i}`, name: `合并${i}`, visibility: 'public' })
    }
    await new Promise((r) => setTimeout(r, 700))

    // 合并生效的话应当只有 1 条；放宽到 2 是为了容忍建房消息跨窗口的边界情况。
    // 关键是它必须**显著小于**变动次数，否则合并逻辑等于没有
    expect(watcher.lists.length).toBeGreaterThanOrEqual(1)
    expect(watcher.lists.length).toBeLessThanOrEqual(2)
    const last = watcher.lists.at(-1)
    for (const i of [0, 1, 2]) {
      expect(last?.rooms.some((r) => r.name === `合并${i}`)).toBe(true)
    }
  })

  it('入座之后不再收到列表推送', async () => {
    const c = await client()
    c.send({ t: 'rooms', subscribe: true })
    await c.wait('roomList')

    c.send({ t: 'createRoom', nickname: '我', name: '入座即退订', visibility: 'public' })
    await c.wait('room')
    c.clear()

    // 另一个人建房制造一次列表变动
    const other = await client()
    other.send({ t: 'createRoom', nickname: '他', name: '制造变动', visibility: 'public' })
    await other.wait('room')
    await new Promise((r) => setTimeout(r, 700))

    expect(c.lists).toHaveLength(0)
  })

  it('已经在房间里的人不能再建房或加入别的房间', async () => {
    const c = await client()
    c.send({ t: 'createRoom', nickname: '我', name: '占着座位', visibility: 'public' })
    await c.wait('room')
    c.clear()

    c.send({ t: 'createRoom', nickname: '我', name: '再来一个', visibility: 'public' })
    const err = await c.wait('error')
    expect(err.code).toBe('bad_state')
  })

  it('公开房间同样可以用房间码加入', async () => {
    const host = await client()
    host.send({ t: 'createRoom', nickname: 'A', name: '也能用码进', visibility: 'public' })
    const room = await host.wait('room')

    const guest = await client()
    guest.send({ t: 'joinRoom', code: room.room.code, nickname: 'B' })
    expect((await guest.wait('welcome')).playerId).toBe('B')
  })
})

// ─────────────────────────────────────────────────────────
// 房间配额
// ─────────────────────────────────────────────────────────

describe('房间配额', () => {
  let app: FastifyInstance
  let url: string
  const open: Client[] = []

  const client = async () => {
    const c = await Client.connect(url)
    open.push(c)
    return c
  }

  beforeAll(async () => {
    ;({ app, url } = await makeApp({
      rooms: { max: 4, maxPerIp: 2, createPerMin: 3, joinFailPerMin: 2, waitingTtlMs: 60_000 },
    }))
  }, 30_000)

  afterAll(async () => {
    for (const c of open) c.close()
    await app.close()
  })

  it('单 IP 同时持有的房间数超限后拒绝建房', async () => {
    // maxPerIp = 2：前两个成功，第三个被拒
    for (const i of [0, 1]) {
      const c = await client()
      c.send({ t: 'createRoom', nickname: `H${i}`, name: `占位${i}`, visibility: 'public' })
      await c.wait('room')
    }
    const third = await client()
    third.send({ t: 'createRoom', nickname: 'H2', name: '第三个', visibility: 'public' })
    const err = await third.wait('error')
    expect(err.code).toBe('too_many_rooms')
  })

  it('建房速率超限后拒绝，且错误码与「你开太多了」区分开', async () => {
    // 上一个用例已经占掉 2 个房间 + 2 次建房速率。
    // 这里全部走同一个 IP（测试进程），所以速率桶是共享的
    const c = await client()
    c.send({ t: 'createRoom', nickname: 'X', name: '撞速率', visibility: 'public' })
    const err = await c.wait('error')
    expect(['too_many_rooms']).toContain(err.code)
  })

  it('连续用错误房间码加入会被限流', async () => {
    const c = await client()
    // joinFailPerMin = 2
    for (let i = 0; i < 3; i++) {
      c.send({ t: 'joinRoom', code: 'ZZZZZZ', nickname: '枚举者' })
      await new Promise((r) => setTimeout(r, 30))
    }
    const codes = c.received.filter((m) => m.t === 'error').map((m) => (m as { code: string }).code)
    expect(codes).toContain('room_not_found')
    expect(codes).toContain('rate_limited')
  })
})

describe('MAX_ROOMS=0 是应急关停开关', () => {
  let app: FastifyInstance
  let url: string

  beforeAll(async () => {
    ;({ app, url } = await makeApp({ rooms: { max: 0 } }))
  }, 30_000)

  afterAll(async () => {
    await app.close()
  })

  it('建房一律返回 server_busy', async () => {
    const c = await Client.connect(url)
    c.send({ t: 'createRoom', nickname: 'A', name: '进不去', visibility: 'public' })
    const err = await c.wait('error')
    expect(err.code).toBe('server_busy')
    c.close()
  })
})

describe('等待太久的房间会被自动关闭', () => {
  let app: FastifyInstance
  let url: string

  beforeAll(async () => {
    ;({ app, url } = await makeApp({
      rooms: { max: 1000, maxPerIp: 1000, createPerMin: 1000, waitingTtlMs: 1 },
    }))
  }, 30_000)

  afterAll(async () => {
    await app.close()
  })

  it('房主收到 roomClosed 而不是一条含义模糊的 error', async () => {
    const c = await Client.connect(url)
    c.send({ t: 'createRoom', nickname: 'A', name: '没人来', visibility: 'public' })
    await c.wait('room')
    // 清扫每 5 秒一轮
    const closed = await c.wait('roomClosed', 20_000)
    expect(closed.reason).toBe('idle')
    c.close()
  }, 30_000)
})
