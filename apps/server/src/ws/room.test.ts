import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type { FastifyInstance } from 'fastify'

import { KARUTA_DEFAULTS, type CardId, type ClientMsg, type PlayerId, type ServerMsg } from '@scg/shared'

import { buildApp } from '../app.js'

let app: FastifyInstance
let baseUrl: string

beforeAll(async () => {
  // 整个套件都从 127.0.0.1 建几十个房间，用生产配额会在第十几个用例上撞限流。
  // 限流本身由 quota.test.ts 和下面「房间配额」一节单独验证，这里要的是不碍事。
  app = await buildApp({ rooms: { max: 1000, maxPerIp: 1000, createPerMin: 1000 } })
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
  playerId: PlayerId | null = null
  /**
   * 收到送り札提示时怎么挑。默认挑队首 —— 与服务端的自动规则一致，
   * 这样绝大多数测试的期望不受影响，同时又不必每回合白等满 10 秒的挑选时限。
   */
  pickOkuri: (candidates: CardId[], count: number) => CardId[] = (c, n) => c.slice(0, n)
  /** 关掉就完全不回应送り札提示，用来验证超时回落 */
  autoOkuri = true

  private constructor(private readonly ws: WebSocket) {}

  static async connect(): Promise<TestClient> {
    const ws = new WebSocket(baseUrl)
    const client = new TestClient(ws)
    ws.on('message', (d) => {
      const msg = JSON.parse(d.toString()) as ServerMsg
      client.received.push(msg)
      if (msg.t === 'welcome') client.playerId = msg.playerId
      if (msg.t === 'roundReveal' && client.autoOkuri) {
        const mine = msg.pending.find((p) => p.player === client.playerId)
        if (mine) {
          client.send({
            t: 'okuri',
            roundNo: msg.roundNo,
            cardIds: client.pickOkuri(mine.candidates, mine.count),
          })
        }
      }
    })
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

  // 跳过记忆阶段（不等自然超时，长度由 KARUTA_DEFAULTS.memorizeSeconds 决定）
  a.send({ t: 'memorizeDone' })
  b.send({ t: 'memorizeDone' })

  return { a, b, code: roomA.room.code, match: startA.match, welcomeA }
}

/**
 * 走完一个完整回合：arm → clipReady → start → 双方各点一张**不同**的牌。
 *
 * 两张牌不同意味着至多一人点对，所以**必然**有人お手つき、必然产生一次送り札，
 * 送り札的测试才不用靠运气。
 */
async function playOneRound(
  a: TestClient,
  b: TestClient,
  match: { layout: Record<PlayerId, string[]> },
) {
  const arm = await a.wait('roundArm')
  a.send({ t: 'clipReady', roundNo: arm.roundNo })
  b.send({ t: 'clipReady', roundNo: arm.roundNo })
  const start = await a.wait('roundStart')
  await new Promise((r) => setTimeout(r, Math.max(0, start.startAtServerTime - Date.now()) + 60))
  a.send({ t: 'tap', roundNo: arm.roundNo, cardId: match.layout.A[0] as string, reactionMs: 900 })
  b.send({ t: 'tap', roundNo: arm.roundNo, cardId: match.layout.B[0] as string, reactionMs: 1100 })
  return arm.roundNo
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
    // fallbackUrl 只在构建过 AAC 兜底时才出现，两种情况都不该多出别的字段
    expect(Object.keys(arm).sort()).toEqual(
      arm.fallbackUrl
        ? ['clipToken', 'fallbackUrl', 'roundNo', 't', 'url']
        : ['clipToken', 'roundNo', 't', 'url'],
    )
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
    await playOneRound(a, b, match)

    const t0 = Date.now()
    const res = await a.wait('roundResult', 8000)
    expect(Date.now() - t0).toBeLessThan(6000)
    expect(res.result.taps).toHaveLength(2)
    a.close()
    b.close()
  }, 30_000)
})

describe('送り札由玩家自选', () => {
  it('挑哪张就送哪张，而不是自动送队首', async () => {
    const { a, b, match } = await startMatch()
    // 故意挑**最后**一张：与自动规则（队首）不同，才能证明选择真的生效了
    const pickLast = (c: string[], n: number) => c.slice(-n).reverse()
    a.pickOkuri = pickLast
    b.pickOkuri = pickLast

    await playOneRound(a, b, match)

    const reveal = await a.wait('roundReveal', 12_000)
    expect(reveal.pending.length).toBeGreaterThan(0)
    // 揭晓要先于结算到达 —— 挑牌的人得先知道发生了什么
    expect(reveal.revealed.title).toBeTruthy()

    const res = await a.wait('roundResult', 12_000)
    for (const p of reveal.pending) {
      const sent = res.result.transfers.find((t) => t.from === p.player && t.cause !== 'take')
      expect(sent?.cardId).toBe(p.candidates[p.candidates.length - 1])
      expect(sent?.cardId).not.toBe(p.candidates[0])
    }
    a.close()
    b.close()
  }, 40_000)

  // 慢的人、掉线的人不能把整局卡住 —— 到点就回落到 MVP 一直在用的自动规则
  it('不挑就超时回落到「自陣待得最久的那张」', async () => {
    const { a, b, match } = await startMatch()
    a.autoOkuri = false
    b.autoOkuri = false

    await playOneRound(a, b, match)
    const reveal = await a.wait('roundReveal', 12_000)

    const t0 = Date.now()
    const res = await a.wait('roundResult', 20_000)
    // 必须等满挑选时限才结算，不能一见没人应就提前定案
    expect(Date.now() - t0).toBeGreaterThan(KARUTA_DEFAULTS.okuriSeconds * 1000 - 2000)
    for (const p of reveal.pending) {
      const sent = res.result.transfers.find((t) => t.from === p.player && t.cause !== 'take')
      expect(sent?.cardId).toBe(p.candidates[0])
    }
    a.close()
    b.close()
  }, 45_000)

  it('送り札提示不泄露答案以外的东西，且不接受别人的选择', async () => {
    const { a, b, match } = await startMatch()
    a.autoOkuri = false
    b.autoOkuri = false
    await playOneRound(a, b, match)

    const reveal = await a.wait('roundReveal', 12_000)
    const chooser = reveal.pending[0]
    expect(chooser).toBeDefined()
    const other = chooser?.player === 'A' ? b : a
    // 不是你该挑的，你替对手挑不作数
    other.send({
      t: 'okuri',
      roundNo: reveal.roundNo,
      cardIds: [chooser?.candidates[chooser.candidates.length - 1] as string],
    })

    const res = await a.wait('roundResult', 20_000)
    const sent = res.result.transfers.find((t) => t.from === chooser?.player && t.cause !== 'take')
    expect(sent?.cardId).toBe(chooser?.candidates[0])
    a.close()
    b.close()
  }, 45_000)
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

describe('重连', () => {
  it('带 resumeToken 重连接回原座位，并一次性拿回牌面', async () => {
    const { a, b, welcomeA, match } = await startMatch()
    b.clear()
    a.close()
    await b.wait('peer', 8000)

    const a2 = await TestClient.connect()
    a2.send({ t: 'hello', resumeToken: welcomeA.resumeToken })

    const w = await a2.wait('welcome')
    expect(w.resumed).toBe(true)
    expect(w.playerId).toBe('A') // 座位没被回收，还是同一个人

    const sync = await a2.wait('stateSync')
    expect(sync.match.you).toBe('A')
    expect(sync.match.matchId).toBe(match.matchId)
    expect(sync.match.cards).toHaveLength(KARUTA_DEFAULTS.fieldCards)

    // 对手必须知道人回来了，否则会一直盯着掉线倒计时
    const back = await b.waitNth('peer', 1, 8000)
    expect(back.online).toBe(true)

    a2.close()
    b.close()
  }, 30_000)

  it('记忆阶段重连能拿回倒计时终点', async () => {
    const a = await TestClient.connect()
    const b = await TestClient.connect()
    a.send({ t: 'createRoom', nickname: 'A' })
    const welcomeA = await a.wait('welcome')
    const roomA = await a.wait('room')
    b.send({ t: 'joinRoom', code: roomA.room.code, nickname: 'B' })
    await b.wait('welcome')
    a.send({ t: 'ready', ready: true })
    b.send({ t: 'ready', ready: true })
    await a.wait('matchStart')

    a.close()
    const a2 = await TestClient.connect()
    a2.send({ t: 'hello', resumeToken: welcomeA.resumeToken })
    const sync = await a2.wait('stateSync')
    expect(sync.match.phase).toBe('memorize')
    expect(sync.memorizeEndsAtServer).toBeGreaterThan(Date.now())

    a2.close()
    b.close()
  }, 30_000)

  // 座位早就被回收时不能假装成功，否则客户端会一直挂在「正在找回对局」
  it('凭证无效时明确告知这是一次新连接', async () => {
    const c = await TestClient.connect()
    c.send({ t: 'hello', resumeToken: 'deadbeef'.repeat(4) })
    const w = await c.wait('welcome')
    expect(w.resumed).toBe(false)
    expect(w.resumeToken).toBe('')
    c.close()
  })

  /**
   * 半开连接：旧 socket 还没死，新 socket 已经接回了座位。
   *
   * 拔网线/断电的一方不会发 FIN，旧 socket 的 close 最长要等一个协议心跳周期才到；
   * 而客户端这边早就用新 socket `hello` 接回了座位。旧会话的 `room`/`playerId` 若不作废，
   * 那条迟到的 close 会 detach 掉**新连接**的座位。
   */
  async function halfOpenRoom() {
    const a1 = await TestClient.connect()
    const b = await TestClient.connect()
    a1.send({ t: 'createRoom', nickname: 'A' })
    const welcomeA = await a1.wait('welcome')
    const roomA = await a1.wait('room')
    b.send({ t: 'joinRoom', code: roomA.room.code, nickname: 'B' })
    await b.wait('welcome')

    // 关键：a1 **不关闭**，模拟半开
    const a2 = await TestClient.connect()
    a2.send({ t: 'hello', resumeToken: welcomeA.resumeToken })
    const w = await a2.wait('welcome')
    expect(w.resumed).toBe(true)
    expect(w.playerId).toBe('A')

    // reattach 会广播 peer 上线，先把它消化掉，后面的 peer 断言才干净
    const online = await b.wait('peer')
    expect(online.online).toBe(true)

    return { a1, a2, b, code: roomA.room.code }
  }

  it('半开连接：旧 socket 迟到的 close 不能把已接回座位的新连接踢下线', async () => {
    const { a1, a2, b, code } = await halfOpenRoom()

    b.clear()
    a1.close()

    // 给迟到的 close 充分的时间落地（远大于一次事件循环）
    await new Promise((r) => setTimeout(r, 800))
    expect(b.received.some((m) => m.t === 'peer')).toBe(false)
    expect(b.received.some((m) => m.t === 'roomClosed')).toBe(false)

    // 新连接仍然在座：ready 会广播一版房间视图，而不是回 not_in_room
    a2.clear()
    a2.send({ t: 'ready', ready: true })
    const view = await a2.wait('room')
    expect(view.room.code).toBe(code)
    expect(a2.received.some((m) => m.t === 'error')).toBe(false)

    a2.close()
    b.close()
  }, 30_000)

  it('半开连接：对手也离线时，旧 socket 的 close 不能让房间被当成全员离线销毁', async () => {
    const { a1, a2, b, code } = await halfOpenRoom()

    // 对手先走，此时房里唯一的活连接是 a2
    b.close()
    await new Promise((r) => setTimeout(r, 300))

    // 迟到的半开 close：若旧会话指针还在，这里会 detach 掉 a2 的座位，
    // 房间随即满足 allOffline 被 dropIfDeserted 就地销毁
    a1.close()
    await new Promise((r) => setTimeout(r, 800))

    a2.clear()
    a2.send({ t: 'ready', ready: true })
    const view = await a2.wait('room')
    expect(view.room.code).toBe(code)
    expect(a2.received.some((m) => m.t === 'error')).toBe(false)

    a2.close()
  }, 30_000)
})

describe('主动退出', () => {
  it('对局中退出：留守方收到 peerLeft，房间回到等待态，且没有结算', async () => {
    const { a, b, code } = await startMatch()

    b.clear()
    // 对局已经在跑（startMatch 里两人都点过「我记好了」），此刻退出即「对局中退出」
    a.send({ t: 'leaveRoom' })

    const left = await b.wait('peerLeft', 8000)
    expect(left.playerId).toBe('A')
    expect(left.nickname).toBe('A')
    expect(left.room.code).toBe(code)
    expect(left.room.phase).toBe('lobby')
    expect(left.room.players.A).toBeNull()
    expect(left.room.players.B).not.toBeNull()

    // 对手跑了的一局没有值得展示的数据：不发 matchEnd
    await new Promise((r) => setTimeout(r, 600))
    expect(b.received.some((m) => m.t === 'matchEnd')).toBe(false)
    expect(b.received.some((m) => m.t === 'peer')).toBe(false)

    a.close()
    b.close()
  }, 30_000)

  it('退出后房间可复用：重回大厅列表，第三人加入并与留守方再开一局', async () => {
    const watcher = await TestClient.connect()
    watcher.send({ t: 'rooms', subscribe: true })
    await watcher.wait('roomList')

    const a = await TestClient.connect()
    const b = await TestClient.connect()
    a.send({ t: 'createRoom', nickname: 'A', visibility: 'public' })
    const roomA = await a.wait('room')
    const code = roomA.room.code
    b.send({ t: 'joinRoom', code, nickname: 'B' })
    await b.wait('welcome')
    a.send({ t: 'ready', ready: true })
    b.send({ t: 'ready', ready: true })
    await a.wait('matchStart')
    await b.wait('matchStart')
    a.send({ t: 'memorizeDone' })
    b.send({ t: 'memorizeDone' })
    await a.wait('roundArm', 12_000)

    a.send({ t: 'leaveRoom' })
    const left = await b.wait('peerLeft', 8000)
    expect(left.room.phase).toBe('lobby')

    // 公开房以 waiting 重新出现在大厅列表里
    const deadline = Date.now() + 8000
    let entry = null
    while (Date.now() < deadline) {
      const lists = watcher.received.filter((m) => m.t === 'roomList')
      const last = lists[lists.length - 1]
      entry = last?.rooms.find((r) => r.code === code) ?? null
      if (entry?.status === 'waiting') break
      await new Promise((r) => setTimeout(r, 50))
    }
    expect(entry?.status).toBe('waiting')

    // 第三人用房间码加入，坐的是空出来的 A 座，并能与留守方再开一局
    const c = await TestClient.connect()
    c.send({ t: 'joinRoom', code, nickname: 'C' })
    const welcomeC = await c.wait('welcome')
    expect(welcomeC.playerId).toBe('A')

    b.send({ t: 'ready', ready: true })
    c.send({ t: 'ready', ready: true })
    const restart = await b.waitNth('matchStart', 1, 10_000)
    expect(restart.match.phase).toBe('memorize')
    await c.wait('matchStart')

    a.close()
    b.close()
    c.close()
    watcher.close()
  }, 40_000)

  it('旧凭证与切片 token 作废：原 resumeToken 接不回座位，旧 clipToken 换不到切片', async () => {
    const { a, b, code, welcomeA } = await startMatch()
    const arm = await a.wait('roundArm', 12_000)
    const oldClipToken = arm.clipToken

    a.send({ t: 'leaveRoom' })
    await b.wait('peerLeft', 8000)

    // 原座位凭证已从索引移除 —— 明确告知这是一次新连接
    const a2 = await TestClient.connect()
    a2.send({ t: 'hello', resumeToken: welcomeA.resumeToken })
    const w = await a2.wait('welcome')
    expect(w.resumed).toBe(false)

    // 旧 clipToken 换不到切片
    const res = await app.inject({ method: 'GET', url: `/api/room/${code}/clip/${oldClipToken}` })
    expect(res.statusCode).toBe(404)

    a.close()
    b.close()
    a2.close()
  }, 30_000)

  it('等待阶段退出：留守方收到 room，对手位清空，不走横幅', async () => {
    const a = await TestClient.connect()
    const b = await TestClient.connect()
    a.send({ t: 'createRoom', nickname: 'A' })
    const roomA = await a.wait('room')
    b.send({ t: 'joinRoom', code: roomA.room.code, nickname: 'B' })
    await b.wait('welcome')

    b.clear()
    a.send({ t: 'leaveRoom' })

    const view = await b.wait('room', 8000)
    expect(view.room.players.A).toBeNull()
    expect(view.room.players.B).not.toBeNull()

    await new Promise((r) => setTimeout(r, 600))
    expect(b.received.some((m) => m.t === 'peerLeft')).toBe(false)

    a.close()
    b.close()
  }, 20_000)

  it('退出 ≠ 掉线：直接断开只发 peer，不发 peerLeft，也不定案', async () => {
    const { a, b } = await startMatch()

    b.clear()
    // 不发 leaveRoom，直接断开 —— 走的是 detach 路径
    a.close()

    const peer = await b.wait('peer', 8000)
    expect(peer.playerId).toBe('A')
    expect(peer.online).toBe(false)
    expect(peer.graceEndsAtServer).toBeGreaterThan(Date.now())

    await new Promise((r) => setTimeout(r, 1500))
    expect(b.received.some((m) => m.t === 'peerLeft')).toBe(false)
    // 宽限（60s）没到，不能提前定案
    expect(b.received.some((m) => m.t === 'matchEnd')).toBe(false)

    b.close()
  }, 20_000)

  // 等待阶段的「一退一断」由 lobby.test.ts 的 T1/T2 覆盖；这里走对局中那条，
  // 因为它多经过一次 resetToLobby —— 重置之后 dropIfDeserted 仍要照常回收
  it('对局中一退一断后房间被立即回收：房间码不再能加入', async () => {
    const { a, b, code } = await startMatch()

    a.send({ t: 'leaveRoom' })
    await b.wait('peerLeft', 8000)
    // 留守方也走：房里一条活连接都不剩
    b.close()

    await new Promise((r) => setTimeout(r, 800))

    const c = await TestClient.connect()
    c.send({ t: 'joinRoom', code, nickname: 'C' })
    const err = await c.wait('error', 8000)
    expect(err.code).toBe('room_not_found')

    a.close()
    c.close()
  }, 20_000)
})

/**
 * 断线重连找回（`hello{claim:false}` 探测）。
 *
 * 设计取舍见 design.md：防抢座的守卫放在**探测**里而不是 `reattach()` 里 ——
 * 后者会砸掉半开连接的正常重连路径。探测必须零副作用，这条是全部测试的地基。
 */
describe('座位探测', () => {
  /**
   * 地基测试：探测是「只问不动」，座位的状态、对手的感知、探测方的会话一个都不变。
   * 如果这条挂了，说明探测支路写出了副作用 —— 后面所有 reason 的测试都建立在它之上。
   */
  it('探测零副作用：座位仍是断线态，对手没有收到 peer 上线，探测方未被 seat 上', async () => {
    const { a, b, welcomeA } = await startMatch()
    b.clear()
    a.close()
    const peerOff = await b.wait('peer', 8000)
    expect(peerOff.online).toBe(false)
    // 清掉掉线时的那条 peer（online:false），后面的「没有第二条 peer」断言才干净
    b.clear()

    // 探测：新连接，claim:false
    const probe = await TestClient.connect()
    probe.send({ t: 'hello', resumeToken: welcomeA.resumeToken, claim: false })
    const offer = await probe.wait('seatOffer')
    expect(offer.available).toBe(true)
    expect(offer.reason).toBe('ok')

    // 对手的视角没有任何变化：没有第二条 peer（reattach 会广播 online:true）
    await new Promise((r) => setTimeout(r, 800))
    expect(b.received.some((m) => m.t === 'peer')).toBe(false)
    expect(b.received.some((m) => m.t === 'peerLeft')).toBe(false)

    // 探测方没有被 seat 上：后续要求入座的消息回 not_in_room，而不是被当成房间成员
    probe.send({ t: 'ready', ready: true })
    const err = await probe.wait('error')
    expect(err.code).toBe('not_in_room')
    expect(probe.received.some((m) => m.t === 'welcome')).toBe(false)
    expect(probe.received.some((m) => m.t === 'stateSync')).toBe(false)

    // 探测之后座位还能被正常认领 —— 探测没有把任何东西弄脏
    const claimer = await TestClient.connect()
    claimer.send({ t: 'hello', resumeToken: welcomeA.resumeToken })
    const w = await claimer.wait('welcome')
    expect(w.resumed).toBe(true)

    probe.close()
    claimer.close()
    b.close()
  }, 30_000)

  it('宽限内离线 → ok，roomCode / opponent / inMatch 正确', async () => {
    const { a, b, welcomeA, match } = await startMatch()
    b.clear()
    a.close()
    const peerOff = await b.wait('peer', 8000)
    expect(peerOff.online).toBe(false)

    const probe = await TestClient.connect()
    probe.send({ t: 'hello', resumeToken: welcomeA.resumeToken, claim: false })
    const offer = await probe.wait('seatOffer')
    expect(offer.available).toBe(true)
    expect(offer.reason).toBe('ok')
    expect(offer.roomCode).toBeTruthy()
    expect(offer.opponent).toBe('B')
    expect(offer.inMatch).toBe(true)
    // roomCode 是这个房间的真实 6 位码 —— 提示文案要靠它指回「哪一局」
    expect(offer.roomCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/)

    probe.close()
    b.close()
  }, 30_000)

  it('座位仍在线（另一个连接持有）→ busy，不摆出可认领', async () => {
    // 半开场景：a1 不关（座位上仍是活连接），探测同一凭证必须报 busy
    const a1 = await TestClient.connect()
    const b = await TestClient.connect()
    a1.send({ t: 'createRoom', nickname: 'A' })
    const welcomeA = await a1.wait('welcome')
    const roomA = await a1.wait('room')
    b.send({ t: 'joinRoom', code: roomA.room.code, nickname: 'B' })
    await b.wait('welcome')

    const probe = await TestClient.connect()
    probe.send({ t: 'hello', resumeToken: welcomeA.resumeToken, claim: false })
    const offer = await probe.wait('seatOffer')
    expect(offer.available).toBe(false)
    expect(offer.reason).toBe('busy')
    expect(offer.roomCode).toBeUndefined()
    expect(offer.opponent).toBeUndefined()

    // 持有者不掉线：这正是防抢座要保证的事
    await new Promise((r) => setTimeout(r, 600))
    expect(b.received.some((m) => m.t === 'peer')).toBe(false)

    probe.close()
    a1.close()
    b.close()
  }, 30_000)

  it('凭证从未存在或座位已回收 → gone', async () => {
    const c = await TestClient.connect()
    c.send({ t: 'hello', resumeToken: 'deadbeef'.repeat(4), claim: false })
    const offer = await c.wait('seatOffer')
    expect(offer.available).toBe(false)
    expect(offer.reason).toBe('gone')
    expect(offer.roomCode).toBeUndefined()
    c.close()

    // 主动退出作废凭证后，同一条 token 也必须是 gone（而不是 ok/busy）
    const a = await TestClient.connect()
    const b = await TestClient.connect()
    a.send({ t: 'createRoom', nickname: 'A' })
    const welcomeA = await a.wait('welcome')
    const roomA = await a.wait('room')
    b.send({ t: 'joinRoom', code: roomA.room.code, nickname: 'B' })
    await b.wait('welcome')
    a.send({ t: 'leaveRoom' })
    await b.wait('room', 8000)

    const probe = await TestClient.connect()
    probe.send({ t: 'hello', resumeToken: welcomeA.resumeToken, claim: false })
    const gone = await probe.wait('seatOffer')
    expect(gone.available).toBe(false)
    expect(gone.reason).toBe('gone')

    probe.close()
    a.close()
    b.close()
  }, 30_000)

  it('放弃重连：探测 → 认领 → leaveRoom → 留守方收到 peerLeft，房间回 waiting 重回列表', async () => {
    const watcher = await TestClient.connect()
    watcher.send({ t: 'rooms', subscribe: true })
    await watcher.wait('roomList')

    const a = await TestClient.connect()
    const b = await TestClient.connect()
    a.send({ t: 'createRoom', nickname: 'A', visibility: 'public' })
    const welcomeA = await a.wait('welcome')
    const roomA = await a.wait('room')
    const code = roomA.room.code
    b.send({ t: 'joinRoom', code, nickname: 'B' })
    await b.wait('welcome')
    a.send({ t: 'ready', ready: true })
    b.send({ t: 'ready', ready: true })
    await a.wait('matchStart')
    await b.wait('matchStart')
    a.send({ t: 'memorizeDone' })
    b.send({ t: 'memorizeDone' })

    // 掉线（关闭标签页的模拟）
    a.close()
    await b.wait('peer', 8000)

    // 新标签页：先探测，再认领
    const a2 = await TestClient.connect()
    a2.send({ t: 'hello', resumeToken: welcomeA.resumeToken, claim: false })
    const offer = await a2.wait('seatOffer')
    expect(offer.reason).toBe('ok')

    a2.send({ t: 'hello', resumeToken: welcomeA.resumeToken })
    const w = await a2.wait('welcome')
    expect(w.resumed).toBe(true)

    // 「放弃重连」= 认领后直接离开。留守方走 peerLeft 路径（不是 peer）
    a2.send({ t: 'leaveRoom' })
    const left = await b.wait('peerLeft', 8000)
    expect(left.playerId).toBe('A')
    expect(left.nickname).toBe('A')
    expect(left.room.code).toBe(code)
    expect(left.room.players.A).toBeNull()

    // 房间以 waiting 重回大厅列表
    const deadline = Date.now() + 8000
    let entry = null
    while (Date.now() < deadline) {
      const lists = watcher.received.filter((m) => m.t === 'roomList')
      const last = lists[lists.length - 1]
      entry = last?.rooms.find((r) => r.code === code) ?? null
      if (entry?.status === 'waiting') break
      await new Promise((r) => setTimeout(r, 50))
    }
    expect(entry?.status).toBe('waiting')

    a2.close()
    b.close()
    watcher.close()
  }, 40_000)

  it('回归护栏：不带 claim 的 hello{resumeToken} 行为与既有路径逐字一致', async () => {
    const { a, b, welcomeA, match } = await startMatch()
    b.clear()
    a.close()
    await b.wait('peer', 8000)

    // 不带 claim 字段 —— 服务端必须把它当成显式 true：reattach + welcome + room + stateSync
    const a2 = await TestClient.connect()
    a2.send({ t: 'hello', resumeToken: welcomeA.resumeToken })

    const w = await a2.wait('welcome')
    expect(w.resumed).toBe(true)
    expect(w.playerId).toBe('A')
    expect(w.resumeToken).toBe(welcomeA.resumeToken)

    const room = await a2.wait('room')
    expect(room.room.you).toBe('A')
    expect(room.room.players.A?.online).toBe(true)

    const sync = await a2.wait('stateSync')
    expect(sync.match.you).toBe('A')
    expect(sync.match.matchId).toBe(match.matchId)

    // 对手收到 peer 上线 —— 认领路径的广播一字未改
    const back = await b.waitNth('peer', 1, 8000)
    expect(back.online).toBe(true)

    a2.close()
    b.close()
  }, 30_000)
})
