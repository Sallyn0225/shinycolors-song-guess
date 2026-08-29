import type { ClientMsg, ServerMsg } from '@scg/shared'

const PING_INTERVAL_MS = 2000
const SYNC_SAMPLES = 15

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
  private samples: Array<{ rtt: number; offset: number }> = []
  private seq = 0
  private pingTimer = 0
  private resumeToken: string | null = null
  private closedByUs = false
  private reconnectAttempt = 0

  clock: ClockSync = { offsetMs: 0, rttMs: 0, jitterMs: 0 }
  onStatus: ((connected: boolean) => void) | null = null

  connect(): void {
    this.closedByUs = false
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/ws`)
    this.ws = ws

    ws.onopen = () => {
      this.reconnectAttempt = 0
      this.onStatus?.(true)
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
      if (msg.t === 'welcome' && msg.resumeToken) this.resumeToken = msg.resumeToken
      for (const l of this.listeners) l(msg)
    }

    ws.onclose = () => {
      this.stopSync()
      this.onStatus?.(false)
      if (!this.closedByUs) this.scheduleReconnect()
    }
    ws.onerror = () => ws.close()
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

  close(): void {
    this.closedByUs = true
    this.stopSync()
    this.ws?.close()
    this.ws = null
  }
}

export const socket = new GameSocket()
