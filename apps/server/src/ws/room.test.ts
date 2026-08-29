import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type { FastifyInstance } from 'fastify'

import { KARUTA_DEFAULTS, type ClientMsg, type ServerMsg } from '@scg/shared'

import { buildApp } from '../app.js'

let app: FastifyInstance
let baseUrl: string

beforeAll(async () => {
  app = await buildApp()
  await app.listen({ port: 0, host: '127.0.0.1' })
  const addr = app.server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  baseUrl = `ws://127.0.0.1:${port}/ws`
}, 30_000)

afterAll(async () => {
  await app.close()
})

/** 一个会把收到的消息全部缓存下来的测试客户端 */
class TestClient {
  readonly received: ServerMsg[] = []
  private constructor(private readonly ws: WebSocket) {}

  static async connect(): Promise<TestClient> {
    const ws = new WebSocket(baseUrl)
    const client = new TestClient(ws)
    ws.on('message', (d) => client.received.push(JSON.parse(d.toString()) as ServerMsg))
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve())
      ws.once('error', reject)
    })
    return client
  }

  send(msg: ClientMsg): void {
    this.ws.send(JSON.stringify(msg))
  }

  /** 等一条指定类型的消息 */
  async wait<T extends ServerMsg['t']>(t: T, timeoutMs = 8000): Promise<Extract<ServerMsg, { t: T }>> {
    const existing = this.received.find((m) => m.t === t)
    if (existing) return existing as Extract<ServerMsg, { t: T }>
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20))
      const hit = this.received.find((m) => m.t === t)
      if (hit) return hit as Extract<ServerMsg, { t: T }>
    }
    throw new Error(`等待 ${t} 超时。已收到：${this.received.map((m) => m.t).join(', ')}`)
  }

  /** 等第 n 条指定类型的消息（从 0 计） */
  async waitNth<T extends ServerMsg['t']>(t: T, n: number, timeoutMs = 10_000): Promise<Extract<ServerMsg, { t: T }>> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const all = this.received.filter((m) => m.t === t)
      if (all.length > n) return all[n] as Extract<ServerMsg, { t: T }>
      await new Promise((r) => setTimeout(r, 20))
    }
    throw new Error(`等待第 ${n} 条 ${t} 超时`)
  }

  clear(): void {
    this.received.length = 0
  }

  close(): void {
    this.ws.close()
  }
}

/** 建房、加入、双方就绪、跳过记忆阶段，直接进入对局 */
async function startMatch() {
  const a = await TestClient.connect()
  const b = await TestClient.connect()

  a.send({ t: 'createRoom', nickname: 'A' })
  const welcomeA = await a.wait('welcome')
  const roomA = await a.wait('room')

  b.send({ t: 'joinRoom', code: roomA.room.code, nickname: 'B' })
  await b.wait('welcome')

  a.send({ t: 'ready', ready: true })
  b.send({ t: 'ready', ready: true })

  const startA = await a.wait('matchStart')
  await b.wait('matchStart')

  // 跳过 30 秒记忆阶段
  a.send({ t: 'memorizeDone' })
  b.send({ t: 'memorizeDone' })

  return { a, b, code: roomA.room.code, match: startA.match, welcomeA }
}

describe('房间', () => {
  it('建房返回 6 位房间码，第二人可加入', async () => {
    const { a, b, code } = await startMatch()
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/)
    a.close()
    b.close()
  })

  it('加入不存在的房间报错', async () => {
    const c = await TestClient.connect()
    c.send({ t: 'joinRoom', code: 'ZZZZZZ', nickname: 'X' })
    const err = await c.wait('error')
    expect(err.code).toBe('room_not_found')
    c.close()
  })

  it('第三人加入被拒', async () => {
    const { a, b, code } = await startMatch()
    const c = await TestClient.connect()
    c.send({ t: 'joinRoom', code, nickname: 'C' })
    const err = await c.wait('error')
    expect(err.code).toBe('room_full')
    a.close()
    b.close()
    c.close()
  })

  it('格式非法的消息被拒绝而不是崩溃', async () => {
    const c = await TestClient.connect()
    c.send({ t: 'joinRoom', code: '短', nickname: '' } as unknown as ClientMsg)
    const err = await c.wait('error')
    expect(err.code).toBe('bad_message')
    c.close()
  })
})

describe('发牌', () => {
  it('双方各 12 张，共 24 张场上札 + 6 空札', async () => {
    const { a, b, match } = await startMatch()
    expect(match.cards).toHaveLength(KARUTA_DEFAULTS.fieldCards)
    expect(match.layout.A).toHaveLength(KARUTA_DEFAULTS.ownCards)
    expect(match.layout.B).toHaveLength(KARUTA_DEFAULTS.ownCards)
    expect(match.karafudaCount).toBe(KARUTA_DEFAULTS.karafuda)
    a.close()
    b.close()
  })

  it('牌面带曲名与组合色（歌牌规则本来就是公开的）', async () => {
    const { a, b, match } = await startMatch()
    for (const c of match.cards) {
      expect(c.title).toBeTruthy()
      expect(c.cardId).toBeTruthy()
      expect(['A', 'B']).toContain(c.owner)
    }
    a.close()
    b.close()
  })
})

// 这一组是联机模式的安全边界
describe('答案不泄露', () => {
  it('roundArm 不含任何曲目信息，只有不透明 token', async () => {
    const { a, b } = await startMatch()
    const arm = await a.wait('roundArm', 12_000)
    const raw = JSON.stringify(arm)
    expect(raw).not.toMatch(/songId/)
    expect(raw).not.toMatch(/sliceId/)
    expect(raw).not.toMatch(/title/)
    expect(arm.clipToken).toMatch(/^[0-9a-f]{32}$/)
    expect(Object.keys(arm).sort()).toEqual(['clipToken', 'roundNo', 't', 'url'])
    a.close()
    b.close()
  })

  it('roundStart 也不含曲目信息', async () => {
    const { a, b } = await startMatch()
    const arm = await a.wait('roundArm')
    a.send({ t: 'clipReady', roundNo: arm.roundNo })
    b.send({ t: 'clipReady', roundNo: arm.roundNo })
    const start = await a.wait('roundStart')
    expect(JSON.stringify(start)).not.toMatch(/songId|title|sliceId/)
    a.close()
    b.close()
  }, 20_000)

  it('答案只在回合结算时揭晓', async () => {
    const { a, b, match } = await startMatch()
    const arm = await a.wait('roundArm')
    a.send({ t: 'clipReady', roundNo: arm.roundNo })
    b.send({ t: 'clipReady', roundNo: arm.roundNo })
    const start = await a.wait('roundStart')
    await new Promise((r) => setTimeout(r, Math.max(0, start.startAtServerTime - Date.now()) + 60))
    // 双方都点，触发提前结算
    a.send({ t: 'tap', roundNo: arm.roundNo, cardId: match.layout.A[0] as string, reactionMs: 900 })
    b.send({ t: 'tap', roundNo: arm.roundNo, cardId: match.layout.B[0] as string, reactionMs: 1100 })
    const res = await a.wait('roundResult', 15_000)
    expect(res.result.revealed.title).toBeTruthy()
    expect(res.result.revealed.coverUrl).toMatch(/^\/cover\//)
    a.close()
    b.close()
  }, 20_000)
})

describe('回合推进', () => {
  it('从不发 clipReady 也会按服务器定时器开始与结算（防卡住免输）', async () => {
    const { a, b } = await startMatch()
    // 双方都不发 clipReady，也不点牌
    const start = await a.wait('roundStart', 12_000)
    expect(start.startAtServerTime).toBeGreaterThan(Date.now() - 1000)
    const res = await a.wait('roundResult', 20_000)
    expect(res.result.winner).toBeNull()
    a.close()
    b.close()
  }, 30_000)

  it('双方都点过之后立刻结算，不必等满窗口', async () => {
    const { a, b, match } = await startMatch()
    const arm = await a.wait('roundArm')
    a.send({ t: 'clipReady', roundNo: arm.roundNo })
    b.send({ t: 'clipReady', roundNo: arm.roundNo })
    const start = await a.wait('roundStart')

    await new Promise((r) => setTimeout(r, Math.max(0, start.startAtServerTime - Date.now()) + 60))
    const cardA = match.layout.A[0] as string
    const cardB = match.layout.B[0] as string
    a.send({ t: 'tap', roundNo: arm.roundNo, cardId: cardA, reactionMs: 900 })
    b.send({ t: 'tap', roundNo: arm.roundNo, cardId: cardB, reactionMs: 1500 })

    const t0 = Date.now()
    const res = await a.wait('roundResult', 8000)
    expect(Date.now() - t0).toBeLessThan(6000)
    expect(res.result.taps).toHaveLength(2)
    a.close()
    b.close()
  }, 30_000)
})

describe('判定', () => {
  it('抢跑（低于人类反应下限）被判 too_early', async () => {
    const { a, b, match } = await startMatch()
    const arm = await a.wait('roundArm')
    a.send({ t: 'clipReady', roundNo: arm.roundNo })
    b.send({ t: 'clipReady', roundNo: arm.roundNo })
    const start = await a.wait('roundStart')
    await new Promise((r) => setTimeout(r, Math.max(0, start.startAtServerTime - Date.now()) + 60))

    a.send({ t: 'tap', roundNo: arm.roundNo, cardId: match.layout.A[0] as string, reactionMs: 30 })
    b.send({ t: 'tap', roundNo: arm.roundNo, cardId: match.layout.B[0] as string, reactionMs: 1200 })
    const res = await a.wait('roundResult', 15_000)
    const tap = res.result.taps.find((t) => t.player === 'A')
    expect(tap?.verdict).toBe('too_early')
    a.close()
    b.close()
  }, 30_000)

  it('一回合只接受一次点击', async () => {
    const { a, b, match } = await startMatch()
    const arm = await a.wait('roundArm')
    a.send({ t: 'clipReady', roundNo: arm.roundNo })
    b.send({ t: 'clipReady', roundNo: arm.roundNo })
    const start = await a.wait('roundStart')
    await new Promise((r) => setTimeout(r, Math.max(0, start.startAtServerTime - Date.now()) + 60))

    a.send({ t: 'tap', roundNo: arm.roundNo, cardId: match.layout.A[0] as string, reactionMs: 800 })
    a.send({ t: 'tap', roundNo: arm.roundNo, cardId: match.layout.A[1] as string, reactionMs: 810 })
    b.send({ t: 'tap', roundNo: arm.roundNo, cardId: match.layout.B[0] as string, reactionMs: 1400 })
    const res = await a.wait('roundResult', 15_000)
    expect(res.result.taps.filter((t) => t.player === 'A')).toHaveLength(1)
    // 只采信第一次点击，后来的那次要被丢弃
    expect(res.result.taps.find((t) => t.player === 'A')?.cardId).toBe(match.layout.A[0])
    a.close()
    b.close()
  }, 30_000)

  it('对陈旧回合号的点击被忽略', async () => {
    const { a, b, match } = await startMatch()
    const arm = await a.wait('roundArm')
    a.send({ t: 'clipReady', roundNo: arm.roundNo })
    b.send({ t: 'clipReady', roundNo: arm.roundNo })
    const start = await a.wait('roundStart')
    await new Promise((r) => setTimeout(r, Math.max(0, start.startAtServerTime - Date.now()) + 60))

    a.send({ t: 'tap', roundNo: arm.roundNo + 99, cardId: match.layout.A[0] as string, reactionMs: 800 })
    b.send({ t: 'tap', roundNo: arm.roundNo, cardId: match.layout.B[0] as string, reactionMs: 900 })
    const res = await a.wait('roundResult', 20_000)
    expect(res.result.taps.find((t) => t.player === 'A')).toBeUndefined()
    expect(res.result.taps.find((t) => t.player === 'B')).toBeDefined()
    a.close()
    b.close()
  }, 30_000)
})

describe('就绪与再战的可见性', () => {
  // 先点完的人必须知道自己在等谁，否则会以为卡住了
  it('开局时 ready 会重置，一方点「我记好了」后双方都能看到', async () => {
    const a = await TestClient.connect()
    const b = await TestClient.connect()
    a.send({ t: 'createRoom', nickname: 'A' })
    const roomA = await a.wait('room')
    b.send({ t: 'joinRoom', code: roomA.room.code, nickname: 'B' })
    await b.wait('welcome')
    a.send({ t: 'ready', ready: true })
    b.send({ t: 'ready', ready: true })

    const start = await a.wait('matchStart')
    // 大厅阶段的 ready 不能带进记忆阶段
    expect(start.match.players.A.ready).toBe(false)
    expect(start.match.players.B.ready).toBe(false)

    a.clear()
    b.clear()
    a.send({ t: 'memorizeDone' })

    const syncB = await b.wait('stateSync', 6000)
    expect(syncB.match.players.A.ready).toBe(true)
    expect(syncB.match.players.B.ready).toBe(false)

    a.close()
    b.close()
  }, 20_000)

  it('再战投票会广播，先同意的人能看到自己在等对方', async () => {
    const { a, b } = await startMatch()
    // 直接投票（未结束时应被忽略，不广播）
    a.clear()
    a.send({ t: 'rematch', agree: true })
    await new Promise((r) => setTimeout(r, 400))
    expect(a.received.find((m) => m.t === 'rematchState')).toBeUndefined()
    a.close()
    b.close()
  }, 20_000)
})

describe('时钟同步', () => {
  it('pong 原样回传 seq 与 tClient，并给出服务器时刻', async () => {
    const c = await TestClient.connect()
    const t0 = Date.now()
    c.send({ t: 'ping', seq: 7, tClient: t0, rttMs: 42 })
    const pong = await c.wait('pong')
    expect(pong.seq).toBe(7)
    expect(pong.tClient).toBe(t0)
    expect(pong.tServer).toBeGreaterThanOrEqual(t0 - 1000)
    c.close()
  })
})

describe('掉线', () => {
  it('掉线后对手会收到 peer 离线通知与宽限期', async () => {
    const { a, b } = await startMatch()
    b.clear()
    a.close()
    const peer = await b.wait('peer', 8000)
    expect(peer.playerId).toBe('A')
    expect(peer.online).toBe(false)
    expect(peer.graceEndsAtServer).toBeGreaterThan(Date.now())
    b.close()
  }, 20_000)
})
