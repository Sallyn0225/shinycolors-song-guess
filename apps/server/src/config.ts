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
 * 先单独求值：两个分类上限（`MAX_PUBLIC_ROOMS` / `MAX_PRIVATE_ROOMS`）的默认值
 * 要跟随它的**实际取值**而不是字面量 200。只配了 `MAX_ROOMS=50` 的部署者，
 * 分类上限也该是 50 —— 否则「我把上限调到 50」这句话会在大厅里显示成 `公开 0/200`，
 * 是个假数字。对象字面量里引用不到自己，所以只能提出来。
 */
const MAX_ROOMS = count('MAX_ROOMS', 200)

/**
 * 房间配额。
 *
 * 单独抽成一个类型是为了**可注入** —— `buildApp()` 允许覆盖它，
 * 测试才能一边用宽松额度跑正常对局，一边用极紧额度验证限流真的会触发。
 * 靠环境变量做这件事会让两组测试在同一个进程里互相打架。
 */
export interface RoomQuotas {
  max: number
  /** 同时存在的公开房间数上限。默认跟随 `max` 的实际取值 */
  publicMax: number
  /** 同时存在的私人房间数上限。默认跟随 `max` 的实际取值；设成 0 即关闭私人房 */
  privateMax: number
  /**
   * 是否允许创建私人房间。
   *
   * 放在「配额」里是因为它和 `privateMax` 是同一件事的两种写法，
   * 判断点也只有一个（见 hub 的 `privateAllowed`），拆到别处会让准入逻辑要读两个配置源。
   */
  allowPrivate: boolean
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
   * WebSocket 心跳间隔（毫秒）。
   *
   * 客户端本来每 2 秒有一次业务 ping，但**那是应用层消息**，
   * 中间的反代看的是 TCP/帧层面的活跃度，且有的代理只认协议级 ping/pong。
   * 这里再补一层协议级心跳，同时用它清掉半开连接（对端拔网线不会发 FIN）。
   */
  wsHeartbeatMs: num('WS_HEARTBEAT_MS', 25_000),

  /**
   * 单 IP 每分钟取环境 BGM 曲目的次数。
   *
   * 这一项防的是**流量滥用**，不是作弊：氛围端点下发的 token 不带任何曲目身份信息，
   * 拉再多也积累不出「切片 ↔ 曲目」对照表（见 `ambience.ts` 开头）。
   * 一个正常客户端每 45~60 秒才需要续一个曲目，30 次留了几十倍余量；
   * 与按 IP 的房间配额一样，它同样会误伤 NAT 后面的人，同样依赖 `TRUST_PROXY=1`。
   */
  ambienceTracksPerMin: count('AMBIENCE_TRACKS_PER_MIN', 30),

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
    /** 全局同时存在的房间数上限。设成 0 即临时关停建房，三道闸里最外层的一道 */
    max: MAX_ROOMS,
    /** 公开房间数上限。必须用 `count` 不是 `num`：要能设成 0（关掉这一类房间） */
    publicMax: count('MAX_PUBLIC_ROOMS', MAX_ROOMS),
    /** 私人房间数上限。与 `ALLOW_PRIVATE_ROOMS=0` 是等价的两条路，Hub 里合并成一个判断 */
    privateMax: count('MAX_PRIVATE_ROOMS', MAX_ROOMS),
    /** 是否允许创建私人房间。默认 true —— 不配置就是今天的行为 */
    allowPrivate: bool('ALLOW_PRIVATE_ROOMS', true),
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
