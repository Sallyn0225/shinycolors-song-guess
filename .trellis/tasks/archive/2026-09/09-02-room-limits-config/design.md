# 技术设计｜公开/私人房上限配置与大厅房间数展示

## 架构边界

```
packages/shared/src/protocol.ts   ← roomList 扩展：privateTotal + limits（改动最小但影响契约）
apps/server/src/config.ts         ← 三个新旋钮进 RoomQuotas
apps/server/src/ws/hub.ts         ← 分类计数 + createRoom 的校验链 + buildList
apps/web/src/screens/Lobby.tsx    ← 计数展示 + 建房弹窗置灰
DEPLOY.md / .env.example          ← 文档
```

**不动**：`ws/room.ts`（Room 已有 `visibility`，一个字段都不用加）、`ws/quota.ts`、
`app.ts`、`net/ws.ts`、`game-core`、任何状态机与定时器。

一句话：**「这个房间能不能建」全部是 Hub 的准入判断，Room 依然只管一局对局。**
本次没有新增任何状态迁移。

---

## 1. 配置层（`apps/server/src/config.ts`）

### `RoomQuotas` 扩展

```ts
export interface RoomQuotas {
  max: number
  /** 同时存在的公开房间数上限 */
  publicMax: number
  /** 同时存在的私人房间数上限 */
  privateMax: number
  /**
   * 是否允许创建私人房间。
   *
   * 放在「配额」里是因为它和 privateMax 是同一件事的两种写法，
   * 判断点也只有一个（见 hub 的 privateAllowed），拆到别处会让准入逻辑要读两个配置源。
   */
  allowPrivate: boolean
  maxPerIp: number
  createPerMin: number
  joinFailPerMin: number
  waitingTtlMs: number
  abandonedTtlMs: number
}
```

### 默认值必须跟随 `MAX_ROOMS` 的**实际取值**

对象字面量里引用不到自己，所以先把总闸算出来：

```ts
/**
 * 先单独求值：两个分类上限的默认值要跟随它的**实际取值**而不是字面量 200。
 * 只配了 MAX_ROOMS=50 的部署者，分类上限也该是 50 —— 否则「我把上限调到 50」
 * 这句话会在大厅里显示成 `公开 0/200`，是个假数字。
 */
const MAX_ROOMS = count('MAX_ROOMS', 200)

export const SERVER_CONFIG = {
  // ...
  rooms: {
    max: MAX_ROOMS,
    publicMax: count('MAX_PUBLIC_ROOMS', MAX_ROOMS),
    privateMax: count('MAX_PRIVATE_ROOMS', MAX_ROOMS),
    allowPrivate: bool('ALLOW_PRIVATE_ROOMS', true),
    // ...
  },
}
```

用 `count` 而不是 `num`：分类上限必须接受 `0`（= 关掉这一类），和既有配额旋钮同一规矩。
`bool` 已有，默认 `true` —— 不配置就是今天的行为。

**兼容性**：`buildApp({ rooms })` 收的是 `Partial<RoomQuotas>`，三个新字段是必填但有默认，
现有 `lobby.test.ts` / `room.test.ts` 的注入写法（`{ max: 1000, maxPerIp: 1000 }`）
不受影响 —— 缺的字段从 `SERVER_CONFIG.rooms` 补齐。

---

## 2. 协议（`packages/shared/src/protocol.ts`）

### 新增类型

```ts
/**
 * 大厅侧的准入信息。随 roomList 下发，供 UI 显示占用与决定建房入口的可用性。
 *
 * **这些数只是 UX 输入**：服务端在 createRoom 里独立做同样的判断，
 * 前端把私人选项置灰只是少一次白跑，不是安全边界。
 */
export interface LobbyLimits {
  /** 公开房上限。已取 min(MAX_PUBLIC_ROOMS, MAX_ROOMS)——不显示一个实际达不到的分母 */
  publicMax: number
  privateMax: number
  /** 私人房是否开放。= ALLOW_PRIVATE_ROOMS && privateMax > 0 */
  allowPrivate: boolean
}
```

### `roomList` 扩展

```ts
| {
    t: 'roomList'
    rooms: RoomSummary[]
    waitingTotal: number
    busyTotal: number
    /**
     * 私人房间的数量。**只有数量**——房间码、房间名、房主昵称、状态一个都不下发。
     *
     * 这是对「私人房不出现在 roomList 里」这条旧契约的有意收窄：
     * 一个聚合计数定位不到任何具体房间，也不缩短 32^6 房间码的枚举成本
     * （枚举的实际成本由 joinFailPerMin 决定，与知不知道「有几个」无关）。
     * 换来的是玩家能看懂「为什么建不了房」。
     */
    privateTotal: number
    limits: LobbyLimits
  }
```

**公开房总数不新增字段**：`waitingTotal + busyTotal` 已经是截断前的公开房全量
（见既有注释）。再加一个 `publicTotal` 就有了两个可能互相矛盾的真相源。

---

## 3. Hub（`apps/server/src/ws/hub.ts`）

### 分类计数

`publicRooms()` 已经在 filter 公开房，但准入判断需要两类数字，且不需要排序结果。
新增一个单遍计数：

```ts
/** 按可见性分组的房间数。准入判断与列表下发共用同一份口径 */
private counts(): { publicCount: number; privateCount: number } {
  let publicCount = 0
  let privateCount = 0
  for (const r of this.rooms.values()) {
    if (r.visibility === 'public') publicCount++
    else privateCount++
  }
  return { publicCount, privateCount }
}

/** 私人房是否开放。两条配置路（开关 / 上限为 0）在这里合并成一个判断 */
private get privateAllowed(): boolean {
  return this.limits.allowPrivate && this.limits.privateMax > 0
}

/** 下发给客户端的上限。min 掉总闸：分母永远是实际达得到的数 */
private lobbyLimits(): LobbyLimits {
  return {
    publicMax: Math.min(this.limits.publicMax, this.limits.max),
    privateMax: Math.min(this.limits.privateMax, this.limits.max),
    allowPrivate: this.privateAllowed,
  }
}
```

### `createRoom` 的校验链

顺序（**先全局、后分类、再个人**，既有的「服务器过载时所有人收到同一条消息」不被打断）：

```
1. 已在房间里            → bad_state
2. rooms.size >= max     → server_busy  「服务器房间已满，稍后再试」   ← 不动
3. 想建私人 && !privateAllowed → bad_state 「本站未开放私人房间」
4. 该类已满              → server_busy  「公开房间已满…」/「私人房间已满…」
5. 单 IP 持有数           → too_many_rooms                            ← 不动
6. 单 IP 建房频次         → too_many_rooms                            ← 不动
```

第 3 步在第 4 步之前：私人房被关掉时，说「未开放」比说「已满 0/0」诚实。

**错误码不新增**：
- 分类满用既有的 `server_busy`（语义就是「服务器这边容不下了」，不是「你建太多了」），
  由 `message` 区分是哪一类满，并提示另一类还能不能建。
- 「本站不开私人房」用 `bad_state` —— 它既不是忙也不是限流，而是这个操作在本部署上
  根本不存在。新增一个 `ErrCode` 会让协议面多一个只有一处会发的分支。

**不静默降级**：`visibility` 在 schema 里 `.default('private')`，所以漏传字段的老客户端
会走到第 3 步被拒。这是正确的失败方向 —— 把它降级成 `public` 等于替玩家做了
「公开你的房间」这个决定。

### `buildList()`

```ts
private buildList(): {
  rooms: RoomSummary[]; waitingTotal: number; busyTotal: number
  privateTotal: number; limits: LobbyLimits
}
```

`privateTotal` 取自 `counts()`，`limits` 取自 `lobbyLimits()`。

**对推送频率的影响**：`signature()` 是 `buildList()` 的 JSON，加入 `privateTotal` 后
「私人房建立/销毁」会成为一个新的列表变更源。这不增加消息量 —— `seat()` 与 `dropRoom()`
本来就无条件 `markListDirty()`，私人房的变动今天也已经触发推送，只是 payload 恰好没变。
现在 payload 会变，语义反而更正确了。`limits` 是常量，对指纹无影响。

---

## 4. 前端（`apps/web/src/screens/Lobby.tsx`）

### 状态

```ts
const [privateTotal, setPrivateTotal] = useState(0)
const [limits, setLimits] = useState<LobbyLimits | null>(null)
```

`limits` 初值 `null` = 还没收到过 `roomList`。**渲染时按 `null` 走保守分支**：
计数行不显示分母，私人选项不置灰（未知不等于禁止，置灰一个其实开着的选项更糟）。

### 计数行

```
ルーム / ROOMS            公开 3/50 · 私人 2/20
                          等人 2 · 进行中 1
```

- `publicTotal = waitingTotal + busyTotal`
- 私人房关闭时那一段显示 `私人 已关闭` 而不是 `私人 0/0`。
- `limits === null` 时退回今天的单行 `等人 N · 进行中 N`。

`sr-only` 摘要同步带上上限，例如
`公开房间 3 间（上限 50），私人房间 2 间（上限 20），等人 2 间，进行中 1 间`。

### 建房弹窗

`VisibilityChoice` 增 `allowPrivate: boolean` prop：

- 私人项 `<input disabled>`，整个 label 去掉 `cursor-pointer`、降透明度，
  `hint` 文案换成「本站已关闭私人房间」。
- 提交与 `checked` 都用 `effectiveVisibility = allowPrivate ? visibility : 'public'`，
  避免「玩家先选了私人，服务端配置在重连后变了」留下一个选中却不可提交的状态。
- **不改 `useState<RoomVisibility>('public')` 的初值**：大厅的默认建房意图仍是公开房。

---

## 5. 契约修订与兼容

| 面 | 变化 | 兼容性 |
|---|---|---|
| `roomList` | 加两个字段 | 加法。老前端忽略未知字段，仍能正常显示列表 |
| `createRoom` | 新增两条拒绝路径 | 只在部署者主动配置后才会触发 |
| `RoomQuotas` | 加三个字段 | `Partial` 注入，测试不受影响 |
| 环境变量 | 三个新变量 | 全部有默认；不配 = 今天的行为 |

**要改的 spec（3.3 阶段，不能漏）**：

- `.trellis/spec/shared/backend/protocol-and-contracts.md:56` —— *"Private rooms never appear
  in `roomList` and are not counted in its totals. That is the entire technical meaning of
  'private'"* 这句已被本次修订。新表述：可定位字段（code / name / host / status）一个都不
  下发，只下发聚合数量；`waitingTotal` / `busyTotal` 仍然只统计公开房。
  同一文件 §"What a list entry may carry" 提到 `lobby.test.ts` 钉死了 `RoomSummary` 的
  key 集合 —— 本次**不动** `RoomSummary`，那条断言应当原样通过。
- `.trellis/spec/server/backend/index.md` —— `config.ts` 的旋钮清单。
- `.trellis/spec/server/backend/secrecy-and-anticheat.md` —— 若其中复述了「私人房完全不
  出现在列表消息里」，同步收窄为「只下发聚合数量」。

---

## 6. 风险

| 风险 | 处理 |
|---|---|
| 总闸小于两类上限之和时，「都没满却建不了房」 | 分母已 `min` 总闸；`DEPLOY.md` 写明建议 `MAX_ROOMS >= 两者之和`；第 2 步的 `server_busy` 文案本来就说的是「服务器满了」 |
| 私人房数量泄露 | 只有聚合数量，定位不到房间；枚举成本仍由 `joinFailPerMin` 决定。这是 PRD 明确接受的权衡 |
| 老客户端漏传 `visibility` 在关闭私人房后建不了房 | 有意为之（不降级）。提示文案要说清「本站未开放私人房间」，玩家改选公开即可 |
| 现有测试的宽松注入被新的分类上限卡住 | 新字段默认跟随 `SERVER_CONFIG.rooms`，默认 200；现有测试实际建房数是个位数，不会触及。阶段 0 的基线跑一遍即可确认 |

---

## 7. 回滚

三处独立可回滚，互不依赖：

- 配置层：删三个变量读取 → 回到单一 `max`。
- 协议 + Hub：`roomList` 的两个字段是加法，删掉即回旧行为。
- 前端：计数行与置灰都是纯展示，回退不影响联机。

线上回滚不需要改镜像：把三个新变量从 `.env` 里删掉即可回到今天的行为。
