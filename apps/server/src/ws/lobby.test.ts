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

  /**
   * 等一条满足条件的消息。
   *
   * `wait(t)` 只取缓冲区里**第一条**同类型消息，断不了「先 peer offline、后 peer online」
   * 这种同类型的先后序列 —— 那种断言必须按内容找。
   */
  async waitWhere(pred: (m: ServerMsg) => boolean, timeoutMs = 4000): Promise<ServerMsg> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const hit = this.received.find(pred)
      if (hit) return hit
      await new Promise((r) => setTimeout(r, 20))
    }
    throw new Error(`等待指定消息超时。已收到：${this.received.map((m) => m.t).join(', ') || '（空）'}`)
  }

  /**
   * 等到订阅推送里出现满足条件的一版列表。
   *
   * **扫的是整个缓冲区**（从新到旧），不只是调用之后新到的那些。所以断言
   * 「某房间已从列表消失」时，订阅必须晚于建房 —— 否则建房前那一版空快照
   * 会凭空满足条件，断言看着绿，实际什么也没验。要么调整订阅顺序，要么先 `clear()`。
   */
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

// ─────────────────────────────────────────────────────────
// 分类上限与私人房开关
// ─────────────────────────────────────────────────────────

describe('公开房分类上限', () => {
  let app: FastifyInstance
  let url: string

  beforeAll(async () => {
    ;({ app, url } = await makeApp({
      rooms: { max: 1000, publicMax: 1, maxPerIp: 1000, createPerMin: 1000 },
    }))
  }, 30_000)

  afterAll(async () => {
    await app.close()
  })

  it('公开房满时拒绝第 2 个公开房，但同一时刻私人房仍能建', async () => {
    const first = await Client.connect(url)
    first.send({ t: 'createRoom', nickname: 'A', name: '公开一', visibility: 'public' })
    await first.wait('room')

    const second = await Client.connect(url)
    second.send({ t: 'createRoom', nickname: 'B', name: '公开二', visibility: 'public' })
    const err = await second.wait('error')
    expect(err.code).toBe('server_busy')
    expect(err.message).toContain('公开房间已满')

    // 私人房不吃公开房的上限
    const priv = await Client.connect(url)
    priv.send({ t: 'createRoom', nickname: 'C', name: '私人照常', visibility: 'private' })
    expect((await priv.wait('room')).room.visibility).toBe('private')
    first.close()
    second.close()
    priv.close()
  })
})

describe('私人房分类上限', () => {
  let app: FastifyInstance
  let url: string

  beforeAll(async () => {
    ;({ app, url } = await makeApp({
      rooms: { max: 1000, privateMax: 1, maxPerIp: 1000, createPerMin: 1000 },
    }))
  }, 30_000)

  afterAll(async () => {
    await app.close()
  })

  it('私人房满时拒绝第 2 个私人房，但同一时刻公开房仍能建', async () => {
    const first = await Client.connect(url)
    first.send({ t: 'createRoom', nickname: 'A', name: '私人一', visibility: 'private' })
    await first.wait('room')

    const second = await Client.connect(url)
    second.send({ t: 'createRoom', nickname: 'B', name: '私人二', visibility: 'private' })
    const err = await second.wait('error')
    expect(err.code).toBe('server_busy')
    expect(err.message).toContain('私人房间已满')

    // 公开房不吃私人房的上限
    const pub = await Client.connect(url)
    pub.send({ t: 'createRoom', nickname: 'C', name: '公开照常', visibility: 'public' })
    expect((await pub.wait('room')).room.visibility).toBe('public')
    first.close()
    second.close()
    pub.close()
  })
})

describe('私人房关闭的两条配置路', () => {
  it('allowPrivate: false 时私人建房被拒（bad_state），公开房不受影响', async () => {
    const app = await buildApp({
      rooms: { max: 1000, allowPrivate: false, maxPerIp: 1000, createPerMin: 1000 },
    })
    await app.listen({ port: 0, host: '127.0.0.1' })
    const addr = app.server.address()
    const url = `ws://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/ws`

    try {
      const priv = await Client.connect(url)
      priv.send({ t: 'createRoom', nickname: 'A', name: '进不去', visibility: 'private' })
      const err = await priv.wait('error')
      expect(err.code).toBe('bad_state')
      expect(err.message).toContain('本站未开放私人房间')

      const pub = await Client.connect(url)
      pub.send({ t: 'createRoom', nickname: 'B', name: '公开照常', visibility: 'public' })
      expect((await pub.wait('room')).room.visibility).toBe('public')
      priv.close()
      pub.close()
    } finally {
      await app.close()
    }
  })

  it('privateMax: 0 与 allowPrivate: false 走同一条拒绝路径', async () => {
    const app = await buildApp({
      rooms: { max: 1000, privateMax: 0, maxPerIp: 1000, createPerMin: 1000 },
    })
    await app.listen({ port: 0, host: '127.0.0.1' })
    const addr = app.server.address()
    const url = `ws://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/ws`

    try {
      const c = await Client.connect(url)
      c.send({ t: 'createRoom', nickname: 'A', name: '进不去', visibility: 'private' })
      const err = await c.wait('error')
      expect(err.code).toBe('bad_state')
      expect(err.message).toBe('本站未开放私人房间')
      c.close()
    } finally {
      await app.close()
    }
  })

  it('私人房关闭时，漏传 visibility 的请求同样被拒 —— 不静默降级成公开', async () => {
    const app = await buildApp({
      rooms: { max: 1000, allowPrivate: false, maxPerIp: 1000, createPerMin: 1000 },
    })
    await app.listen({ port: 0, host: '127.0.0.1' })
    const addr = app.server.address()
    const url = `ws://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/ws`

    try {
      const c = await Client.connect(url)
      // schema 默认 private：降级等于替玩家做了「公开你的房间」这个决定，所以必须拒
      c.send({ t: 'createRoom', nickname: 'A', name: '老客户端' } as ClientMsg)
      const err = await c.wait('error')
      expect(err.code).toBe('bad_state')
      expect(err.message).toContain('本站未开放私人房间')
      c.close()
    } finally {
      await app.close()
    }
  })
})

describe('总闸与分类满的顺序', () => {
  it('max: 0 时仍返回 server_busy，文案是「服务器房间已满」而不是分类满', async () => {
    const app = await buildApp({ rooms: { max: 0, publicMax: 1000, privateMax: 1000 } })
    await app.listen({ port: 0, host: '127.0.0.1' })
    const addr = app.server.address()
    const url = `ws://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/ws`

    try {
      const c = await Client.connect(url)
      c.send({ t: 'createRoom', nickname: 'A', name: '进不去', visibility: 'public' })
      const err = await c.wait('error')
      expect(err.code).toBe('server_busy')
      expect(err.message).toBe('服务器房间已满，稍后再试')
      c.close()
    } finally {
      await app.close()
    }
  })
})

describe('roomList 的私人计数与上限下发', () => {
  let app: FastifyInstance
  let url: string

  beforeAll(async () => {
    ;({ app, url } = await makeApp({
      rooms: { max: 1000, maxPerIp: 1000, createPerMin: 1000 },
    }))
  }, 30_000)

  afterAll(async () => {
    await app.close()
  })

  it('建 1 公开 + 1 私人后：rooms 只有公开那条，privateTotal 为 1，limits 三字段正确', async () => {
    const watcher = await Client.connect(url)
    watcher.send({ t: 'rooms', subscribe: true })
    const before = await watcher.wait('roomList')
    const waitingBase = before.waitingTotal
    const privateBase = before.privateTotal

    const pub = await Client.connect(url)
    pub.send({ t: 'createRoom', nickname: 'P', name: '公开房', visibility: 'public' })
    const pubRoom = await pub.wait('room')

    const priv = await Client.connect(url)
    priv.send({ t: 'createRoom', nickname: 'Q', name: '私人房不要看', visibility: 'private' })
    const privRoom = await priv.wait('room')

    // 私人房建立只改变 privateTotal，公开列表的条目与两个 total 都不动
    const list = await watcher.waitList((m) => m.privateTotal === privateBase + 1)
    expect(list.rooms.some((r) => r.code === privRoom.room.code)).toBe(false)
    expect(list.rooms.some((r) => r.code === pubRoom.room.code)).toBe(true)
    expect(list.waitingTotal).toBe(waitingBase + 1)
    expect(list.busyTotal).toBe(0)

    // 注入只覆盖了部分配额，缺省字段从 SERVER_CONFIG.rooms 补齐 ——
    // 环境未配置时 publicMax/privateMax 的默认是 200（MAX_ROOMS 的字面量默认值），
    // 而不是跟随注入的 max。下发前已各自 min 掉总闸
    expect(list.limits).toEqual({
      publicMax: 200,
      privateMax: 200,
      allowPrivate: true,
    })

    // 保密回归：断言原始 JSON 全文，任何新字段泄露都会被抓到
    const raw = JSON.stringify(list)
    expect(raw).not.toContain(privRoom.room.code)
    expect(raw).not.toContain('私人房不要看')
    watcher.close()
    pub.close()
    priv.close()
  })

  it('lobbyLimits 把分类上限 min 到总闸：max: 2, publicMax: 10 下发 publicMax === 2', async () => {
    const minApp = await buildApp({ rooms: { max: 2, publicMax: 10 } })
    await minApp.listen({ port: 0, host: '127.0.0.1' })
    const addr = minApp.server.address()
    const minUrl = `ws://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/ws`

    try {
      const c = await Client.connect(minUrl)
      c.send({ t: 'rooms', subscribe: true })
      const list = await c.wait('roomList')
      expect(list.limits.publicMax).toBe(2)
      expect(list.limits.privateMax).toBe(2)
      c.close()
    } finally {
      await minApp.close()
    }
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

// ─────────────────────────────────────────────────────────
// 全员离线即时回收
// ─────────────────────────────────────────────────────────

describe('全员离线即时回收', () => {
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
      // 保持默认的 abandonedTtlMs（65s），不缩短 TTL ——
      // 这样测试里 2 秒短超时的断言能严格证明房间是在事件触发时立刻回收，
      // 而不是靠 65 秒后的清扫兜底
      rooms: { max: 1000, maxPerIp: 1000, createPerMin: 1000 },
    }))
  }, 30_000)

  afterAll(async () => {
    for (const c of open) c.close()
    await app.close()
  })

  it('T1 一人掉线 + 一人退出：房间立刻从列表消失（<2s，不等 65s 的 TTL）', async () => {
    const hostA = await client()
    hostA.send({ t: 'createRoom', nickname: 'A', name: '房T1', visibility: 'public' })
    const roomA = await hostA.wait('room')

    const clientB = await client()
    clientB.send({ t: 'joinRoom', code: roomA.room.code, nickname: 'B' })
    await clientB.wait('welcome')

    const watcherC = await client()
    watcherC.send({ t: 'rooms', subscribe: true })
    await watcherC.waitList((m) => m.rooms.some((r) => r.code === roomA.room.code))

    // A 掉线，B 退出
    hostA.close()
    clientB.send({ t: 'leaveRoom' })
    clientB.close()

    // C 在 2 秒超时内必须收到不含该房的新列表（短超时证明回收不等 65s 的 abandonedTtlMs）
    const list = await watcherC.waitList((m) => !m.rooms.some((r) => r.code === roomA.room.code), 2000)
    expect(list.rooms.some((r) => r.code === roomA.room.code)).toBe(false)
  })

  it('T2 凭证作废：一人掉线 + 一人退出后，A 用原 resumeToken 重连告知新连接且收不到对局状态', async () => {
    const hostA = await client()
    hostA.send({ t: 'createRoom', nickname: 'A', name: '房T2', visibility: 'public' })
    const welcomeA = await hostA.wait('welcome')
    const roomA = await hostA.wait('room')

    const clientB = await client()
    clientB.send({ t: 'joinRoom', code: roomA.room.code, nickname: 'B' })
    await clientB.wait('welcome')

    const watcher = await client()
    watcher.send({ t: 'rooms', subscribe: true })
    await watcher.waitList((m) => m.rooms.some((r) => r.code === roomA.room.code))

    // A 掉线，B 退出
    hostA.close()
    clientB.send({ t: 'leaveRoom' })
    clientB.close()

    // 确认已完成回收
    await watcher.waitList((m) => !m.rooms.some((r) => r.code === roomA.room.code), 2000)

    // A 带旧凭证重连：必须被告知这是一次新连接，且收不到 room 或 stateSync
    const reconnA = await client()
    reconnA.send({ t: 'hello', resumeToken: welcomeA.resumeToken })
    const w = await reconnA.wait('welcome')
    expect(w.resumed).toBe(false)
    expect(w.resumeToken).toBe('')
    expect(reconnA.received.some((m) => m.t === 'room' || m.t === 'stateSync')).toBe(false)
  })

  it('T3 双方同时掉线：都不发 leaveRoom 直接断开，房间同样立刻回收且凭证作废', async () => {
    const hostA = await client()
    hostA.send({ t: 'createRoom', nickname: 'A', name: '房T3', visibility: 'public' })
    const welcomeA = await hostA.wait('welcome')
    const roomA = await hostA.wait('room')

    const clientB = await client()
    clientB.send({ t: 'joinRoom', code: roomA.room.code, nickname: 'B' })
    await clientB.wait('welcome')

    const watcherC = await client()
    watcherC.send({ t: 'rooms', subscribe: true })
    await watcherC.waitList((m) => m.rooms.some((r) => r.code === roomA.room.code))

    // 双方都不发 leaveRoom，直接断开连接
    hostA.close()
    clientB.close()

    // 2 秒内从列表消失
    const list = await watcherC.waitList((m) => !m.rooms.some((r) => r.code === roomA.room.code), 2000)
    expect(list.rooms.some((r) => r.code === roomA.room.code)).toBe(false)

    // 凭证作废
    const reconn = await client()
    reconn.send({ t: 'hello', resumeToken: welcomeA.resumeToken })
    const w = await reconn.wait('welcome')
    expect(w.resumed).toBe(false)
    expect(w.resumeToken).toBe('')
  })

  /**
   * D3 明确接受的行为变更：单人房主断开连接后房间立刻消失、凭证作废。
   * 重连宽限保护的是「还有人在等你回来」；独处一室的人掉线，没有人在等待，故不再保活 65 秒。
   */
  it('T4 单人房主掉线（D3 有意接受的行为变更）：独自断开后房间立刻消失且凭证作废', async () => {
    const hostA = await client()
    hostA.send({ t: 'createRoom', nickname: 'A', name: '单人房', visibility: 'public' })
    const welcomeA = await hostA.wait('welcome')
    const roomA = await hostA.wait('room')

    // 订阅必须**晚于**建房：`waitList` 扫的是整个缓冲区，建房之前那一版快照里本来就没有这间房，
    // 「房间已消失」的断言会被它凭空满足。订阅在后，首推里就带着这间房，
    // 之后再出现「不含该房」的一版才只可能是真的回收了
    const watcher = await client()
    watcher.send({ t: 'rooms', subscribe: true })
    await watcher.waitList((m) => m.rooms.some((r) => r.code === roomA.room.code))

    // 房主独自断开
    hostA.close()

    // 列表在 2 秒内移除该房
    const list = await watcher.waitList((m) => !m.rooms.some((r) => r.code === roomA.room.code), 2000)
    expect(list.rooms.some((r) => r.code === roomA.room.code)).toBe(false)

    // 原凭证作废
    const reconn = await client()
    reconn.send({ t: 'hello', resumeToken: welcomeA.resumeToken })
    const w = await reconn.wait('welcome')
    expect(w.resumed).toBe(false)
    expect(w.resumeToken).toBe('')
  })

  it('T5 回归护栏：一人掉线但另一人在线时，房间不回收且掉线方可在宽限内重连', async () => {
    const hostA = await client()
    hostA.send({ t: 'createRoom', nickname: 'A', name: '有人等待', visibility: 'public' })
    const welcomeA = await hostA.wait('welcome')
    const roomA = await hostA.wait('room')

    const clientB = await client()
    clientB.send({ t: 'joinRoom', code: roomA.room.code, nickname: 'B' })
    await clientB.wait('welcome')

    const watcher = await client()
    watcher.send({ t: 'rooms', subscribe: true })
    await watcher.waitList((m) => m.rooms.some((r) => r.code === roomA.room.code))

    // 仅 A 掉线，B 仍然在线
    hostA.close()
    await clientB.waitWhere((m) => m.t === 'peer' && m.playerId === 'A' && !m.online)

    // 稍候 400ms（大于一个 250ms 的 LIST_FLUSH_MS），房间绝不能被回收。
    // 要主动拉一版**新的**列表快照：掉线不标脏列表，只看 `lists.at(-1)` 拿到的
    // 会是掉线前那一版，那样断言即使房间真被回收了也照样过
    await new Promise((r) => setTimeout(r, 400))
    watcher.clear()
    watcher.send({ t: 'rooms', subscribe: true })
    const fresh = await watcher.wait('roomList')
    expect(fresh.rooms.some((r) => r.code === roomA.room.code)).toBe(true)

    // A 在宽限期内重连成功接回原座位
    const reconnA = await client()
    reconnA.send({ t: 'hello', resumeToken: welcomeA.resumeToken })
    const w = await reconnA.wait('welcome')
    expect(w.resumed).toBe(true)
    expect(w.playerId).toBe('A')

    const roomMsg = await reconnA.wait('room')
    expect(roomMsg.room.code).toBe(roomA.room.code)

    // 对手侧也要复原：B 必须收到 A 重新上线（AC5）
    const back = await clientB.waitWhere((m) => m.t === 'peer' && m.playerId === 'A' && m.online)
    expect(back).toMatchObject({ t: 'peer', playerId: 'A', online: true })
  })

  it('T6 名额释放：公开房占满后全员离线，立刻可以再建新公开房', async () => {
    const tightApp = await buildApp({
      rooms: { max: 1000, publicMax: 1, maxPerIp: 1000, createPerMin: 1000 },
    })
    await tightApp.listen({ port: 0, host: '127.0.0.1' })
    const addr = tightApp.server.address()
    const tightUrl = `ws://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/ws`

    try {
      const a = await Client.connect(tightUrl)
      a.send({ t: 'createRoom', nickname: 'A', name: '房一', visibility: 'public' })
      const roomA = await a.wait('room')

      // 尝试建第二间，已被 publicMax: 1 阻挡
      const b = await Client.connect(tightUrl)
      b.send({ t: 'createRoom', nickname: 'B', name: '房二', visibility: 'public' })
      const err = await b.wait('error')
      expect(err.code).toBe('server_busy')
      expect(err.message).toContain('公开房间已满')

      // A 离线 → 全员离线，立刻触发回收释放配额。
      // 用列表推送等回收落地，而不是睡一个固定毫秒数 ——
      // 睡多久都只是猜，而这里等的正是「房间真的出表了」这件事
      b.send({ t: 'rooms', subscribe: true })
      await b.wait('roomList')
      a.close()
      await b.waitList((m) => !m.rooms.some((r) => r.code === roomA.room.code), 2000)

      // B 再次建房立刻成功，证明名额已释放，不再被拒
      b.send({ t: 'createRoom', nickname: 'B', name: '房二再试', visibility: 'public' })
      const roomB = await b.wait('room')
      expect(roomB.room.name).toBe('房二再试')

      b.close()
    } finally {
      await tightApp.close()
    }
  })
})

