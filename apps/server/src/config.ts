import fs from 'node:fs'
import path from 'node:path'

import { REPO_ROOT } from './catalog.js'

function bool(name: string, fallback = false): boolean {
  const v = process.env[name]
  if (v === undefined) return fallback
  return v === '1' || v.toLowerCase() === 'true'
}

function num(name: string, fallback: number): number {
  const v = Number(process.env[name])
  return Number.isFinite(v) && v > 0 ? v : fallback
}

/** 前端构建产物。存在就由本进程一起伺服，公网部署只需要开一个端口 */
function findWebRoot(): string | null {
  const explicit = process.env['WEB_ROOT']
  const guess = explicit ?? path.join(REPO_ROOT, 'apps', 'web', 'dist')
  try {
    if (fs.statSync(path.join(guess, 'index.html')).isFile()) return guess
  } catch {
    /* 没构建过前端，纯 API 模式 */
  }
  return null
}

export const SERVER_CONFIG = {
  port: num('PORT', 5179),
  /** 默认监听所有网卡，方便局域网开黑。公网部署时建议设成 127.0.0.1 只让反代进来 */
  host: process.env['HOST'] ?? '0.0.0.0',

  /**
   * 在反向代理后面时打开，Fastify 才会认 `X-Forwarded-*`。
   * **只有在确实有可信代理时才开** —— 直接暴露在公网上开了它，
   * 任何人都能伪造 `X-Forwarded-For` 把自己的来源 IP 说成别的。
   */
  trustProxy: bool('TRUST_PROXY'),

  /**
   * 封面/缩略图的外部前缀，可以指向 CDN。
   *
   * **切片绝不能走 CDN**：clip token 是一次性的、必须由本进程校验，
   * 放到 CDN 上等于取消了这层校验，还会因为缓存让同一个切片被反复取到。
   */
  assetBase: (process.env['PUBLIC_ASSET_BASE'] ?? '').replace(/\/+$/, ''),

  /**
   * WebSocket 心跳间隔（毫秒）。
   *
   * 客户端本来每 2 秒有一次业务 ping，但**那是应用层消息**，
   * 中间的反代看的是 TCP/帧层面的活跃度，且有的代理只认协议级 ping/pong。
   * 这里再补一层协议级心跳，同时用它清掉半开连接（对端拔网线不会发 FIN）。
   */
  wsHeartbeatMs: num('WS_HEARTBEAT_MS', 25_000),

  webRoot: findWebRoot(),
} as const

/** 封面地址。配了 PUBLIC_ASSET_BASE 就指向 CDN，否则走本进程 */
export function coverUrl(songId: string): string {
  return `${SERVER_CONFIG.assetBase}/cover/${songId}.webp`
}
