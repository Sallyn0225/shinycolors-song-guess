import fs from 'node:fs'
import path from 'node:path'

import { KARUTA_DEFAULTS } from '@scg/shared'

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

/**
 * 和 `num` 的区别只有一个：**接受 0**。
 *
 * 配额类的旋钮必须能被设成 0 —— `MAX_ROOMS=0` 是不改代码临时关停联机的应急开关，
 * 用 `num` 的话 0 会被当成「没配」而回落到默认值，开关直接失效。
 */
function count(name: string, fallback: number): number {
  const v = Number(process.env[name])
  return Number.isFinite(v) && v >= 0 ? v : fallback
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

/**
 * 房间配额。
 *
 * 单独抽成一个类型是为了**可注入** —— `buildApp()` 允许覆盖它，
 * 测试才能一边用宽松额度跑正常对局，一边用极紧额度验证限流真的会触发。
 * 靠环境变量做这件事会让两组测试在同一个进程里互相打架。
 */
export interface RoomQuotas {
  max: number
  maxPerIp: number
  createPerMin: number
  joinFailPerMin: number
  waitingTtlMs: number
  abandonedTtlMs: number
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

  /**
   * 房间配额。
   *
   * 房间列表把建房入口暴露给了任何拿到网址的人，所以这几个数不是可选的调优项，
   * 而是这个入口能不能开着的前提。
   *
   * **按 IP 的两项依赖 `TRUST_PROXY=1`**：不开的话 `req.ip` 是反代自己的地址，
   * 所有连接会挤进同一个桶，配额从「每人」退化成「全局」。那样更严格、不会漏，
   * 但会误伤正常用户。
   */
  rooms: {
    /** 全局同时存在的房间数上限。设成 0 即临时关停建房 */
    max: count('MAX_ROOMS', 200),
    /**
     * 单 IP 同时持有的房间数。
     *
     * **这一项会误伤 NAT 后面的人**：同一个宿舍/办公室/家庭出口的所有玩家共享一个公网 IP，
     * 在服务端看来就是同一个人。默认给到 5 是「几个朋友同时开房」和「挡住刷房」之间的折中；
     * 如果你的玩家集中在同一个出口，把它调大。
     */
    maxPerIp: count('MAX_ROOMS_PER_IP', 5),
    /** 单 IP 每分钟建房次数。同样受 NAT 影响，但每分钟十几次对正常用户已经很宽 */
    createPerMin: count('CREATE_PER_MIN', 15),
    /**
     * 单 IP 每分钟 `joinRoom` **失败**次数。
     *
     * 这是私人房间私密性的实际保障：房间码是 32^6 ≈ 10.7 亿种，
     * 每分钟 20 次意味着穷举一遍要一千年量级。成功加入不计数，正常用户打错几次也够用。
     */
    joinFailPerMin: count('JOIN_FAIL_PER_MIN', 20),
    /** 等待中的房间无人加入的存活上限。默认 15 分钟 */
    waitingTtlMs: num('WAITING_TTL_MS', 15 * 60_000),

    /**
     * 全员掉线的房间还留多久。
     *
     * 掉线不会立刻清座位（要留给重连），所以这类房间既不 `isEmpty` 也不会因
     * `ROOM_TTL_MS` 过期——在有房间列表之前它只是浪费一点内存，
     * 有了列表之后它会**顶在大厅里显示成一个可以加入的活房间**，长达半小时。
     *
     * **绝不能小于 `disconnectGraceSeconds`**：小了就等于取消了重连宽限，
     * 刷新一下页面座位就没了。默认取宽限 + 5 秒。
     */
    abandonedTtlMs: num('ABANDONED_TTL_MS', (KARUTA_DEFAULTS.disconnectGraceSeconds + 5) * 1000),
  },

  webRoot: findWebRoot(),
} as const

/** 封面地址。配了 PUBLIC_ASSET_BASE 就指向 CDN，否则走本进程 */
export function coverUrl(songId: string): string {
  return `${SERVER_CONFIG.assetBase}/cover/${songId}.webp`
}
