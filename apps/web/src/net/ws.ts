import type { ClientMsg, ServerMsg } from '@scg/shared'

const PING_INTERVAL_MS = 2000
const SYNC_SAMPLES = 15

/**
 * 座位凭证存 localStorage 而不是 sessionStorage：
 * 掉线的人**关掉标签页再重开**也能找回座位 —— sessionStorage 在关页时被清空，
 * 找回入口从来不会出现（那正是本任务要修的缺口）。
 *
 * 代价是同机两个标签页会读到同一份凭证，所以「同机不抢座位」不再靠存储隔离，
 * 改由服务端探测承担：新标签页先发 `hello{claim:false}`（零副作用），
 * 座位仍在线（busy）就绝不认领 —— 流程在 App.tsx。
 *
 * 凭证带过期戳：宽限只有 60s，过期即视为无凭证，
 * 免得几天后打开浏览器还被人问「要不要找回」一个早就不存在的对局。
 */
const RESUME_KEY = 'scg.resumeToken'
/**
 * 凭证本地存活时长，从**最后一次确认还坐在座位上**起算（不是从拿到凭证起算）。
 * 宽限 60s（difficulty.ts 的 disconnectGraceSeconds）+ 时钟与网络余量。
 */
const RESUME_TTL_MS = 75_000
/**
 * 在线期间把过期戳往后推的最小间隔。
 *
 * 少了这条续期，`exp` 就成了「入座时刻 + TTL」—— 一局牌远不止 75 秒，
 * 凭证会在**对局还在跑的时候**自己过期，掉线后既弹不出找回入口、
 * 同标签页刷新也恢复不了（两条路都卡在 `hasResumeToken` 那道闸上）。
 *
 * 取 10s 而不是跟着 2s 的心跳每次都写：localStorage 是同步 I/O，
 * 牌场上判定按毫秒算，不该为一个只需粗粒度的时间戳去抢那几毫秒。
 * 代价是 `exp` 最坏落在「断线时刻 + 65s」，仍然盖得住 60s 的宽限。
 */
const RESUME_TOUCH_MS = 10_000
/**
 * 「这个标签页持有过这个座位」的标记。
 *
 * localStorage 全标签页共享，光看它分不出「刷新」和「新开标签页」；
 * sessionStorage 天然按标签页隔离，正好承担这个区分：
 * 有标记 = 本标签页本来就持有座位 → 刷新走既有的自动认领（静默恢复）；
 * 没有标记 = 新标签页 → 走探测，摆出「找回 / 放弃」二选一。
 */
const TAB_HELD_KEY = 'scg.seatHeldInThisTab'

interface StoredCredential {
  token: string
  /** 本地过期时刻（Date.now() 口径）。过期即当作没有 —— 真正的权威永远是服务端的 seatOffer */
  exp: number
}

function readResume(): string | null {
  try {
    const raw = localStorage.getItem(RESUME_KEY)
    if (!raw) return null
    const stored = JSON.parse(raw) as StoredCredential
    if (!stored?.token || typeof stored.exp !== 'number' || stored.exp <= Date.now()) {
      // 过期即丢弃并顺手清掉，别让一份死凭证永远占着键位
      localStorage.removeItem(RESUME_KEY)
      return null
    }
    return stored.token
  } catch {
    return null // 隐私模式下 localStorage 会抛，重连能力退化但不该崩
  }
}

function writeResume(token: string | null): void {
  try {
    if (token) {
      const stored: StoredCredential = { token, exp: Date.now() + RESUME_TTL_MS }
      localStorage.setItem(RESUME_KEY, JSON.stringify(stored))
    } else {
      localStorage.removeItem(RESUME_KEY)
    }
  } catch {
    /* 同上 */
  }
}

/** 标记「本标签页持有座位」/ 清除该标记。供 App.tsx 区分自动认领与探测 */
function markTabHeld(held: boolean): void {
  try {
    if (held) sessionStorage.setItem(TAB_HELD_KEY, '1')
    else sessionStorage.removeItem(TAB_HELD_KEY)
  } catch {
    /* 标记只是本标签页的分流依据，存不下就当新标签页探测，无碍 */
  }
}

interface ClockSync {
  /** serverTime ≈ clientTime + offset */
  offsetMs: number
  rttMs: number
  jitterMs: number
}

type Listener = (msg: ServerMsg) => void

/**
 * 联机连接 + 时钟同步。
 *
 * 同步用 Cristian 算法，取 RTT 最小的若干样本 —— 延迟最小的样本路由不对称也最小，
 * 而路由不对称是 rtt/2 无法探测的、不可消除的误差项。
 * 局域网可到 0.5~2ms，公网 5~20ms。这个精度对「反应时间在 800~3000ms」的辨识游戏绰绰有余。
 */
export class GameSocket {
  private ws: WebSocket | null = null
  private readonly listeners = new Set<Listener>()
  private readonly statusListeners = new Set<(connected: boolean) => void>()
  private samples: Array<{ rtt: number; offset: number }> = []
  private seq = 0
  private pingTimer = 0
  private resumeToken: string | null = readResume()
  /**
   * 新标签页探测期间暂存的凭证。
   *
   * connect() 的 onopen 会自动带上 `resumeToken` 认领座位 —— 那是同标签页
   * 断线重连的正确行为，但对「新标签页」是抢座：座位可能还归另一个标签页
   * 或一条半开连接所有。所以启动流程在 connect() **之前**调 `parkSeat()`，
   * 把凭证从自动认领的路径上摘下来存到这里，用不用由用户在 Splash 上决定。
   * `claimSeat()` 认领时取回；`forgetSeat()` 放弃时清掉。
   */
  private parkedToken: string | null = null
  private closedByUs = false
  private reconnectAttempt = 0
  /** 上次把凭证过期戳往后推的时刻。见 `RESUME_TOUCH_MS` */
  private lastResumeTouch = 0

  clock: ClockSync = { offsetMs: 0, rttMs: 0, jitterMs: 0 }

  /** 有座位凭证 = 上次离开时还在局里，值得试一次重连 */
  get hasResumeToken(): boolean {
    return this.resumeToken !== null && this.resumeToken !== ''
  }

  /** 本标签页持有过这个座位。true = 刷新走既有的自动认领；false = 新标签页，先探测 */
  get tabHeldSeat(): boolean {
    try {
      return sessionStorage.getItem(TAB_HELD_KEY) === '1'
    } catch {
      return false
    }
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  /** 连接已断、正在退避重试的第几次。给 UI 显示「重连中…」 */
  get retrying(): number {
    return this.reconnectAttempt
  }

  connect(): void {
    // 幂等：重连中的界面和大厅都会调它，重复建连会开出第二条 socket 抢座位
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }
    this.closedByUs = false
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/ws`)
    this.ws = ws

    ws.onopen = () => {
      this.reconnectAttempt = 0
      this.emitStatus(true)
      // 带上 resumeToken 尝试恢复原座位
      this.send({ t: 'hello', ...(this.resumeToken ? { resumeToken: this.resumeToken } : {}) })
      this.startSync()
    }

    ws.onmessage = (ev) => {
      let msg: ServerMsg
      try {
        msg = JSON.parse(String(ev.data)) as ServerMsg
      } catch {
        return
      }
      if (msg.t === 'pong') {
        this.notePong(msg.tClient, msg.tServer)
        return
      }
      if (msg.t === 'welcome') {
        if (msg.resumeToken) {
          this.resumeToken = msg.resumeToken
          this.parkedToken = null
          this.persistResume(msg.resumeToken)
        } else if (!this.parkedToken) {
          // 空 token = 服务端没认出这个座位（宽限已过或房间已散）。
          // 仅在非探测暂存状态下清理存储，避免探测用临时连接收到的空 token 误删本地凭证
          this.resumeToken = null
          writeResume(null)
        }
      }
      for (const l of this.listeners) l(msg)
    }

    ws.onclose = () => {
      this.stopSync()
      this.emitStatus(false)
      if (!this.closedByUs) this.scheduleReconnect()
    }
    ws.onerror = () => ws.close()
  }

  private emitStatus(connected: boolean): void {
    for (const l of this.statusListeners) l(connected)
  }

  /** 订阅连接状态。返回退订函数——多个界面同时关心它，不能是单个回调槽 */
  onStatus(fn: (connected: boolean) => void): () => void {
    this.statusListeners.add(fn)
    return () => this.statusListeners.delete(fn)
  }

  private scheduleReconnect(): void {
    const delay = Math.min(8000, 400 * 2 ** this.reconnectAttempt++)
    window.setTimeout(() => {
      if (!this.closedByUs) this.connect()
    }, delay)
  }

  /**
   * 写入凭证并把过期戳推到 `now + TTL`，同时记下这次写入的时刻供节流用。
   * 只管**有凭证**的情况；清除凭证仍然直接走 `writeResume(null)`。
   */
  private persistResume(token: string): void {
    this.lastResumeTouch = Date.now()
    writeResume(token)
  }

  /**
   * 心跳顺带续期：只要这条连接还坐着座位，就把过期戳往后推。
   *
   * 过期戳要表达的是「离开座位之后还能找回多久」，所以它必须跟着
   * 「最后一次还在座位上」走。不续期的话它退化成「入座后多久」，
   * 对局跑过 75 秒凭证就自己死了（见 `RESUME_TOUCH_MS`）。
   */
  private touchResume(): void {
    if (!this.resumeToken) return
    if (Date.now() - this.lastResumeTouch < RESUME_TOUCH_MS) return
    this.persistResume(this.resumeToken)
  }

  private startSync(): void {
    this.stopSync()
    const tick = () => {
      this.touchResume()
      this.send({
        t: 'ping',
        seq: this.seq++,
        tClient: Date.now(),
        ...(this.clock.rttMs > 0 ? { rttMs: this.clock.rttMs } : {}),
      })
    }
    tick()
    // 开局连打几次，快速收敛
    for (let i = 1; i <= 4; i++) window.setTimeout(tick, i * 180)
    this.pingTimer = window.setInterval(tick, PING_INTERVAL_MS)
  }

  private stopSync(): void {
    if (this.pingTimer) window.clearInterval(this.pingTimer)
    this.pingTimer = 0
  }

  private notePong(tClient: number, tServer: number): void {
    const t3 = Date.now()
    const rtt = t3 - tClient
    if (rtt < 0 || rtt > 5000) return
    this.samples.push({ rtt, offset: tServer + rtt / 2 - t3 })
    if (this.samples.length > SYNC_SAMPLES) this.samples.shift()

    // 取 RTT 最小的 30% 样本：路由不对称最小，误差最小
    const sorted = [...this.samples].sort((a, b) => a.rtt - b.rtt)
    const best = sorted.slice(0, Math.max(3, Math.ceil(sorted.length * 0.3)))
    const offsets = best.map((s) => s.offset).sort((a, b) => a - b)
    const rtts = this.samples.map((s) => s.rtt)
    const mean = rtts.reduce((a, b) => a + b, 0) / rtts.length
    const rttSorted = [...rtts].sort((a, b) => a - b)

    this.clock = {
      offsetMs: offsets[Math.floor(offsets.length / 2)] ?? 0,
      rttMs: Math.round(rttSorted[Math.floor(rttSorted.length / 2)] ?? 0),
      jitterMs: Math.sqrt(rtts.reduce((a, b) => a + (b - mean) ** 2, 0) / rtts.length),
    }
  }

  /** 服务器时刻 → 本地 Date.now() 时刻 */
  toLocalTime(serverTime: number): number {
    return serverTime - this.clock.offsetMs
  }

  send(msg: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /**
   * 把凭证从「onopen 自动认领」的路径上摘下来暂存，返回暂存的 token。
   *
   * 凭证留在内存与本地存储中，但在当前连接的自动认领路径上被隔离，
   * 免得 connect() 时误发带凭证的 hello 导致抢座。
   * 用它去探测、等用户决定。幂等：重复调用返回同一份暂存，不覆盖。
   */
  parkSeat(): string | null {
    if (this.parkedToken === null && this.resumeToken) {
      this.parkedToken = this.resumeToken
      this.resumeToken = null
    }
    return this.parkedToken
  }

  /**
   * 认领座位：`hello{resumeToken, claim:true}`。
   *
   * 探测（`claim:false`）确认「能找回」之后由「找回对局」/「放弃重连」走这条 ——
   * 服务端随之 reattach、广播 peer 上线、推回牌面。与 onopen 的自动认领
   * 是同一条服务端路径，只是时机由用户决定。
   * 优先用暂存的凭证（新标签页探测后认领），否则用当前的。
   *
   * 返回认领 hello 是否**真的发出去了**：凭证不存在（无座位可认领）或连接
   * 没开（发不出去）都返回 false，此时不发 leaveRoom 之类的后续 ——
   * 调用方据此区分「真正的认领-退出」与「纯本地放弃」（R5 / R7）。
   */
  claimSeat(): boolean {
    const token = this.resumeToken ?? this.parkedToken
    if (!token || !this.connected) return false
    this.parkedToken = null
    this.resumeToken = token
    this.persistResume(token)
    markTabHeld(true)
    this.send({ t: 'hello', resumeToken: token, claim: true })
    return true
  }

  /** 本标签页正式持有了一个座位（新坐进 or 接回）。刷新时走静默自动恢复而不是探测 */
  markTabHeldSeat(): void {
    markTabHeld(true)
  }

  /**
   * 清掉座位凭证（本地记忆 + 暂存 + 存储 + 标签页标记），但**不断开 socket**。
   *
   * 主动退出（`leaveRoom`）之后必须调它：服务端已经把座位释放、token 作废，
   * 留着一份指向已消失座位的凭证，新标签页就会被人问「要不要找回」一个
   * 根本不存在的对局（prd.md F8）。「放弃重连」同样落在这里 —— 本地丢弃后
   * 与首次访问无异。
   */
  forgetSeat(): void {
    this.resumeToken = null
    this.parkedToken = null
    writeResume(null)
    markTabHeld(false)
  }

  /** 主动离开：连同座位凭证一起丢掉，下次进来是个新玩家 */
  close(): void {
    this.closedByUs = true
    this.forgetSeat()
    this.stopSync()
    this.ws?.close()
    this.ws = null
  }
}

export const socket = new GameSocket()
