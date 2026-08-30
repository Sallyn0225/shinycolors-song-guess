# 技术设计｜公网联机房间

## 架构边界

四个包，改动量从大到小：

```
packages/shared/src/protocol.ts   ← 协议扩展（RoomSummary / 可见性 / 订阅消息）
apps/server/src/ws/hub.ts         ← 房间注册表 + 列表推送 + 反滥用（改动最大）
apps/server/src/ws/room.ts        ← 只加元数据（name / visibility / createdAt / status）
apps/server/src/config.ts         ← 新增环境变量旋钮
apps/server/src/app.ts            ← ws handler 取 req.ip 传给 hub
apps/web/src/screens/Lobby.tsx    ← 拆成 Lobby（大厅）+ Room（房间内）
apps/web/src/App.tsx              ← 新增 room 屏，离开房间回大厅
```

**不动的东西**：`@scg/game-core`（规则）、`apps/web/src/net/ws.ts`（禁区，只透传新消息）、
`audio.ts`、`api.ts`、`features/*`、`ws/timing.ts`、回合状态机。

一句话：**房间的「元数据与生命周期」是 Hub 的事，房间的「对局」还是 Room 的事。**
Room 只多几个只读字段，不多任何一条新的状态迁移。

---

## 1. 协议契约（`packages/shared/src/protocol.ts`）

### 新增类型

```ts
export type RoomVisibility = 'public' | 'private'
export type RoomStatus = 'waiting' | 'full' | 'playing'

/** 房间名上限。24 是「一行能放下、不会把列表撑歪」的经验值 */
export const ROOM_NAME_MAX = 24
/** 单次 roomList 推送的条目上限 */
export const ROOM_LIST_MAX = 80

/** 列表条目。**只由公开房间生成**，私人房间永远不会出现在这里 */
export interface RoomSummary {
  code: RoomCode
  name: string
  /** 房主（A 座）昵称。B 座的昵称不下发——列表只需要知道「谁开的房」 */
  host: string
  players: number      // 1 | 2
  status: RoomStatus
  /** 服务器时刻。前端用 socket.clock 换算成「几分钟前」 */
  createdAt: number
}
```

### `RoomView` 扩展

```ts
export interface RoomView {
  code: RoomCode
  name: string            // 新增
  visibility: RoomVisibility  // 新增——房间内要显示「公开 / 私人」
  you: PlayerId
  players: Record<PlayerId, PlayerView | null>
  phase: MatchPhase
}
```

### `ClientMsg` 扩展

```ts
const roomName = z.string().trim().min(1).max(ROOM_NAME_MAX)

z.object({
  t: z.literal('createRoom'),
  nickname,
  name: roomName.optional(),
  // 默认 private：漏传字段的失败方向必须是「不暴露」
  visibility: z.enum(['public', 'private']).default('private'),
}),
// 订阅/退订房间列表。进大厅订阅，入座或离开大厅退订
z.object({ t: z.literal('rooms'), subscribe: z.boolean() }),
```

`name` 的清洗**不能只靠 zod 的 `.trim()`**：控制字符和零宽字符要在 shared 里用一个
导出的纯函数处理，server 与 web 共用同一份实现，避免两边规则漂移。

```ts
/** 去控制字符与零宽字符、折叠连续空白。返回空串表示这个名字不可用 */
export function sanitizeRoomName(raw: string): string
```

放 shared 而不是 server：前端要在输入时就给出即时反馈，两边必须是同一个函数。
这不违反「shared 无运行时」——它是纯字符串函数，与 `encode()` 同级。

### `ServerMsg` 扩展

```ts
| {
    t: 'roomList'
    rooms: RoomSummary[]
    /** 截断前的总数，用于「另有 N 个房间未显示」 */
    waitingTotal: number
    playingTotal: number
  }
```

### `ErrCode` 扩展

```ts
| 'server_busy'    // 全局房间数已满
| 'too_many_rooms' // 单 IP 房间数或建房速率超限
```

`joinRoom` 失败限流复用既有的 `'rate_limited'`——对枚举者而言，
「你被限流了」和「房间不存在」都不该给出可区分的信息增量，但也没必要新造错误码。

---

## 2. `Room` 的改动（最小）

构造参数增加 `name` 与 `visibility`，加一个 `createdAt` 与两个只读 getter：

```ts
readonly createdAt = Date.now()

get playerCount(): number  // seats 里非 null 的个数
get status(): RoomStatus {
  if (this.state && this.state.phase !== 'lobby') return 'playing'
  return this.playerCount >= 2 ? 'full' : 'waiting'
}
get hostNickname(): string  // A 座昵称；A 座空了取 B 座
summary(): RoomSummary
```

`roomView()` 多带 `name` / `visibility` 两个字段。

**Room 不感知列表**。它不持有订阅者、不主动推送列表。状态变了由 Hub 发现——
这是为了不破坏 `.trellis/spec/server/backend/realtime-guidelines.md` 里
「Room 只管传输、计时和权威状态」的分层。

### Hub 怎么知道 Room 变了

两条路，都要有：

1. **显式标脏**：Hub 自己处理的动作（`createRoom` / `joinRoom` / `leaveRoom` / `disconnect`）
   直接调 `markListDirty()`。
2. **兜底轮询**：`ready → 开局`、`matchEnd` 这些迁移发生在 Room 内部，Hub 不在调用栈上。
   现有的 `sweep()` 每 15s 一次太慢。做法是让 `sweep()` 之外再挂一个轻量的
   **状态快照比对**：Hub 缓存上次推送的 summary 列表，在既有 sweeper 的 tick 里比对；
   同时把 sweeper 间隔从 15s 降到 5s。

> 权衡：更干净的做法是给 Room 一个 `onChange` 回调，由 Room 在每次
> `broadcastMatch` 时通知 Hub。但那会让 Room 反向依赖 Hub 的关注点，
> 且要在 Room 的 6 处状态迁移里逐个补调用——漏一处就是一个「列表状态卡住」的隐性 bug。
> 快照比对是 O(房间数)、每 5s 一次、房间数有上限，代价可忽略，且**不可能漏**。
>
> 若实现中发现 5s 的状态延迟在 UI 上明显（例如对手加入后列表还显示 waiting），
> 就在 `join` / `leave` 这两条 Hub 已在调用栈上的路径补显式标脏——它们覆盖了
> 用户最能感知的两次变化。这也正是上面第 1 条存在的理由。

---

## 3. `Hub` 的改动（本任务的重心）

### 会话与订阅

```ts
interface Session {
  socket: Socket
  ip: string            // 新增
  room: Room | null
  playerId: PlayerId | null
  msgTimestamps: number[]
  listening: boolean    // 新增：是否订阅了房间列表
}
```

`connect(socket, ip)` 签名变化，`app.ts` 的 ws handler 改为
`(socket, req) => hub.connect(s, req.ip)`。

> `req.ip` 在 `TRUST_PROXY=1` 时是 `X-Forwarded-For` 的最后一跳，Caddy 默认会带上；
> 不开 `TRUST_PROXY` 时是反代自己的地址，此时**所有连接会共享同一个 IP 桶**，
> 按 IP 的配额会变成全局配额。这不是安全漏洞（更严格），但会误伤，
> 必须写进 `DEPLOY.md`。

### 列表推送

```ts
private listDirty = false
private flushTimer: NodeJS.Timeout | null = null

private markListDirty(): void {
  this.listDirty = true
  if (this.flushTimer) return
  this.flushTimer = setTimeout(() => { this.flushTimer = null; this.flushList() }, LIST_FLUSH_MS)
  this.flushTimer.unref?.()
}
```

`flushList()`：

1. 取出全部 `visibility === 'public'` 的房间，生成 summary；
2. 排序：`waiting` 组在前（按 `createdAt` 倒序），`full` / `playing` 组在后（同样倒序）；
3. 截断到 `ROOM_LIST_MAX`；
4. 统计 `waitingTotal` / `playingTotal`（截断前的总数）；
5. 推给所有 `listening === true` 的会话。

**订阅者与座位互斥**：`joinRoom` / `createRoom` 成功后自动把 `listening` 置 false ——
已经在房间里的人不需要再收列表，省掉最大的一份广播流量。
`leaveRoom` 后前端会重新发 `{t:'rooms', subscribe:true}`。

`LIST_FLUSH_MS = 250`。选 250 而不是更小：房间变动的自然频率远低于此，
250ms 的延迟在「看列表」这个场景里感知不到，但能把开局瞬间的连锁变动合并成一条。

### 反滥用

一个独立的小模块 `apps/server/src/ws/quota.ts`，不塞进 `hub.ts`：

```ts
/** 按 IP 的滑动窗口计数器。窗口过期自动回收，不需要单独的清理定时器 */
export class IpQuota {
  hit(ip: string, bucket: 'create' | 'joinFail', windowMs: number, max: number): boolean
  // 返回 true = 超限
}
```

Hub 里的检查顺序（`createRoom`）：

```
1. 全局房间数 >= MAX_ROOMS            → 'server_busy'
2. 该 IP 名下活跃房间数 >= MAX_ROOMS_PER_IP → 'too_many_rooms'
3. 该 IP 建房速率超限                  → 'too_many_rooms'
4. 房间名不合法                        → 'bad_message'
5. 通过，建房
```

「该 IP 名下活跃房间数」通过在 `Room` 上记一个 `creatorIp` 实现（不下发、不进 summary）。
房间销毁时自然释放，不需要额外的引用计数。

`joinRoom` 失败（房间不存在 / 已满）时 `hit(ip, 'joinFail', ...)`，超限直接
回 `'rate_limited'` 并**不再查表**——这是私人房间不被枚举的实际保障。
成功加入不计数。

### 等待中的公开房间回收

`sweep()` 里增加一条：`status === 'waiting'` 且 `Date.now() - createdAt > WAITING_TTL_MS`
的房间，先给房主发一条 `{t:'error', code:'bad_state', message:'房间等待太久已自动关闭'}`，
再销毁。

> 复用既有 `error` 消息而不是新造一条 `roomClosed`：前端在房间内已经有错误展示位，
> 新造一条消息就要在 Room 屏再加一条分支。收益不抵成本。
> 若实施中发现前端难以区分「这条 error 意味着要退回大厅」，再升级为独立消息类型。

### `hello` 重连的 O(n) 扫描

房间数从「几个」变成「可能上百」，`hub.ts:123` 的全表扫描要换成索引：

```ts
private readonly bySeatToken = new Map<string, Room>()
```

`join` 时登记，`leave` / 房间销毁时清除。这不是可选优化——
在 `MAX_ROOMS` 上限下，每次重连扫 200 个房间 × 2 个座位是纯浪费，
而且 `reattach` 有副作用（成功时会 `broadcast`），全表扫的正确性完全依赖
「token 不碰撞」这个隐含假设。索引让它变成显式的。

---

## 4. 环境变量（`apps/server/src/config.ts`）

| 变量 | 默认 | 说明 |
|---|---|---|
| `MAX_ROOMS` | `200` | 全局同时存在的房间数上限 |
| `MAX_ROOMS_PER_IP` | `3` | 单 IP 同时持有的房间数 |
| `CREATE_PER_MIN` | `10` | 单 IP 每分钟建房次数 |
| `JOIN_FAIL_PER_MIN` | `20` | 单 IP 每分钟 `joinRoom` 失败次数 |
| `WAITING_TTL_MS` | `900000`（15 分钟） | 等待中的房间无人加入的存活上限 |

默认值的取法：`MAX_ROOMS=200` 时最坏内存占用仍在几 MB 量级（房间本身只有座位和几个
定时器，牌面要开局才生成）；`JOIN_FAIL_PER_MIN=20` 对正常用户（手输房间码打错几次）
绰绰有余，对枚举者则意味着穷举 32⁶ ≈ 10.7 亿个码需要约 1000 年。

---

## 5. 前端结构

### 屏幕拆分

`Lobby.tsx` 当前是「大厅 + 房间内」二合一。拆成：

```
src/screens/Lobby.tsx   大厅：房间列表 + 创建房间 + 房间码加入
src/screens/Room.tsx    房间内：房间名/码、双方状态、准备、离开
src/components/RoomCard.tsx   列表里的一条（新建，属于 game-specific 无状态组件层）
```

拆分理由不只是行数：两个视图的**生命周期不同**。大厅要订阅列表、要在断线时保持可用；
房间内要处理座位和 ready。塞在一个组件里意味着列表订阅的 effect 在房间内也在跑。

### `App.tsx` 的屏幕状态

```ts
type Screen =
  | ...
  | { name: 'lobby' }
  | { name: 'room'; room: RoomView }   // 新增
```

- 收到 `room` 消息 → 切到 `{name:'room'}`（现在是切到 `lobby`，`App.tsx:87`）。
- Room 屏的 `onLeave`：`socket.send({t:'leaveRoom'})` → 回 `{name:'lobby'}`，**不 close socket**。
- Lobby 屏的 `onBack`：`socket.close()` → 回 `{name:'start'}`（即现有行为）。

> 注意 `App.tsx:87` 现有那句 `prev.name === 'start' ? lobby : prev` 的守卫是为了
> 「重连时不要把牌场顶掉」。改成 room 屏后同样要保留这个守卫，
> 条件放宽到 `prev.name === 'start' || prev.name === 'lobby'`。

### 昵称持久化

`localStorage` key `scg.nickname`，读写都包 try/catch（隐私模式会抛），
与 `net/ws.ts:22` 对 sessionStorage 的既有处理方式一致。

**不能用 sessionStorage**：昵称是跨会话的个人偏好，与座位凭证的语义相反
（座位凭证故意用 sessionStorage 以避免多标签页抢座）。

### 视觉与交互

走 `/impeccable`（见 `implement.md` 的阶段安排）。设计约束沿用 `DESIGN.md`
与 `.trellis/spec/web/frontend/`：

- 尺寸走 `--u`，不写死 px；
- 状态不能只靠颜色编码（`Lobby.tsx:17` 的 `Presence` 是既有范例）；
- 列表条目是可点击元素，要有键盘可达性与 `disabled` 语义。

---

## 6. 兼容性与迁移

- **无持久化 = 无数据迁移。** 服务重启房间全丢，与现状一致。
- **协议是加法**：`RoomView` 新增两个必填字段，前后端同批发布（同一进程托管同一份前端），
  不存在版本错配窗口。`createRoom` 的新字段都可选/有默认，
  既有测试的 `{t:'createRoom', nickname}` 仍然合法（落为私人房间，正是 D3 的默认方向）。
- **`app.test.ts` / `room.test.ts` 不应大面积改写**：新增测试独立成块，
  既有 49 个用例除非因 `RoomView` 新字段而断言失败，否则不动。

## 7. 运维与回滚

- 回滚点见 `implement.md`。协议层与服务端层可以独立回滚：
  前端不发 `{t:'rooms'}` 时，服务端的列表推送逻辑完全不激活。
- **应急开关**：`MAX_ROOMS=0` 可以在不改代码的前提下让所有建房请求返回 `server_busy`，
  等于临时关停联机。这条要写进 `DEPLOY.md`。
- 观测：服务端 logger 是关的（`.trellis/spec/server/backend/logging-guidelines.md`），
  本任务**不引入日志**。配额命中不打印——打印来源 IP 与建房行为会引入新的隐私面，
  且与「日志里不出现任何曲目信息」的既有约束方向一致（保守优先）。
