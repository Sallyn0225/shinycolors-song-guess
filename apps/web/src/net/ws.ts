import type { ClientMsg, ServerMsg } from '@scg/shared'

const PING_INTERVAL_MS = 2000
const SYNC_SAMPLES = 15

/**
 * 座位凭证存 sessionStorage 而不是 localStorage：
 * 刷新/误关标签页能找回座位，但新开一个标签页是新玩家——
 * 用 localStorage 会让同一台机器开两个窗口互相抢座位。
 */
const RESUME_KEY = 'scg.resumeToken'

interface ClockSync {
  /** serverTime ≈ clientTime + offset */
  offsetMs: number
  rttMs: number
  jitterMs: number
}

type Listener = (msg: ServerMsg) => void

function readResume(): string | null {
  try {
    return sessionStorage.getItem(RESUME_KEY)
  } catch {
    return null // 隐私模式下 sessionStorage 会抛，重连能力退化但不该崩
  }
}

function writeResume(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(RESUME_KEY, token)
    else sessionStorage.removeItem(RESUME_KEY)
  } catch {
    /* 同上 */
  }
}

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
  private closedByUs = false
  private reconnectAttempt = 0

  clock: ClockSync = { offsetMs: 0, rttMs: 0, jitterMs: 0 }

  /** 有座位凭证 = 上次离开时还在局里，值得试一次重连 */
  get hasResumeToken(): boolean {
    return this.resumeToken !== null && this.resumeToken !== ''
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
        // 空 token = 服务端没认出这个座位（宽限已过或房间已散）。
        // 必须清掉，否则每次重连都会再试一遍一个死凭证
        this.resumeToken = msg.resumeToken || null
        writeResume(this.resumeToken)
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

  private startSync(): void {
    this.stopSync()
    const tick = () => {
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

  /** 主动离开：连同座位凭证一起丢掉，下次进来是个新玩家 */
  close(): void {
    this.closedByUs = true
    this.resumeToken = null
    writeResume(null)
    this.stopSync()
    this.ws?.close()
    this.ws = null
  }
}

export const socket = new GameSocket()
