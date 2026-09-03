# 技术设计 — 断线重连找回与放弃重连

先读 `prd.md`。本文只写"怎么做"和"为什么不那么做"。

---

## 对 D2 的修正：守卫放在探测里，不放在 `reattach()` 里

用户拍板的方向是「localStorage + 服务端在线守卫」。方向不变，但**守卫的落点必须换**，
理由是写 design 时核对出来的一条既有行为：

`apps/server/src/ws/room.test.ts` 有一条通过的用例
「半开连接：旧 socket 迟到的 close 不能把已接回座位的新连接踢下线」，
配套的规范段落是 `server/backend/realtime-guidelines.md` 的
「Seat ownership transfers with `reattach`」。它描述的是一条**受支持且被测试钉住**的路径：

> 拔网线的玩家不发 FIN，旧 socket 的 close 最长要 25s 才到。
> 在那之前玩家已经在新 socket 上 `reattach` 成功了。

也就是说，**今天"座位仍标记在线时的 reattach"不是异常，而是正常重连路径本身**。
在 `reattach()` 里加一条「座位在线就拒绝」会：

- 直接弄挂上面那条既有用例；
- 更糟的是把**同标签页自动重连**一起废掉 —— 拔网线重连本来几秒就回来，
  加了守卫要等满 25s 心跳。这比原 bug 严重，因为它砸的是每天都在走的那条路。

所以设计改成：

| | 落点 | 行为 |
|---|---|---|
| ❌ 否决 | `Room.reattach()` 加在线守卫 | 破坏半开重连，砸掉既有用例与主路径 |
| ✅ 采用 | 新增**探测**，由探测回报座位是否在线 | 认领路径一字不改，防抢座在认领之前拦住 |

防抢座因此变成：**新标签页永不自动认领，只在探测回报"座位当前离线"时才把
「找回对局」这个选项摆出来**。这恰好复刻了 sessionStorage 原本提供的保证
（同机第二个标签页是新玩家），而没有动认领路径一个字。

残留风险：用户盯着「找回对局」按钮不点，恰好此时原标签页重新上线，这时再点会把
原标签页顶下去。这是自找的、窗口只有几秒的竞态，不值得为它加锁。

---

## 协议

在 `hello` 上加一个可选布尔，而不是新增一条消息：

```ts
// ClientMsg（zod schema，packages/shared/src/protocol.ts）
{ t: 'hello', resumeToken?: string, claim?: boolean }   // claim 默认 true
```

`claim` **默认 true**，所以现有客户端与同标签页刷新那条路一个字节都不用改，
也不会因为字段缺失被当成探测。这与 `createRoom.visibility` 默认 `private`
是同一条原则的两种方向：默认值要落在"不改变既有行为"的那一侧。

`claim: false` 时服务端**不动任何状态**（不 `reattach`、不改 `s.room`/`s.playerId`、
不广播 `peer`），只回一条新消息：

```ts
// ServerMsg
| { t: 'seatOffer'; available: boolean; reason: 'ok' | 'busy' | 'gone'; roomCode?: string; opponent?: string; inMatch: boolean }
```

- `gone` —— `bySeatToken` 里没有这个 token（宽限已过或房间已散）。前端**不提示**，
  按首次访问处理。
- `busy` —— 座位还在但仍持有活连接（半开窗口，或另一个标签页正开着）。
  前端显示「座位仍在使用中」并自动重试，不摆出「找回」按钮。
- `ok` —— 可以认领。`roomCode` / `opponent` / `inMatch` 供提示文案用，
  让人知道自己要回的是哪一局。

`roomCode` 与 `opponent` 只在 `available` 时下发，且持有 token 就等于持有座位，
不构成新的信息泄露面（`protocol-and-contracts.md`「What may never appear」那三类都不涉及）。

---

## 服务端

`hub.ts` 的 `hello` 分支拆成两条：

```
hello
├── claim === false  → 查 bySeatToken → 回 seatOffer，直接 return（零副作用）
└── 否则（默认）      → 完全走今天的逻辑，一字不改
```

`busy` 的判定读 `room.seatOf(pid)?.conn !== null`。需要一个只读访问器，
不要把 `seats` 暴露出去。

**不碰**：`reattach()`、`detach()`、`releaseSeatPointers()`、`forfeitIfAbandoned()`、
`dropIfDeserted()`、`leaveRoom` 分支。整个服务端改动应当只有 `hello` 分支的新增支路
加一个只读访问器。

---

## 前端

### 凭证存储

`net/ws.ts` 是禁区文件（`web/frontend/index.md:43-46`），改动必须最小且可逐条辩护。
本任务只动凭证读写这一小块，**不碰** `connect()` 的重连退避、时钟同步、
心跳、`releaseSeatPointers` 相关的任何逻辑 —— 那些才是注释里说的"线上 bugfix"。

存储从 `sessionStorage` 换成 `localStorage`，并带上过期戳：

```ts
{ token: string, exp: number }   // exp = Date.now() + 宽限 60s + 余量
```

读取时过期即当作没有（并顺手清掉）。**过期戳只是本地的省事优化**，
真正的权威永远是服务端的 `seatOffer` —— 本地时钟不可信，不能拿它当判据。

同时补两件既有欠账（`prd.md` F8/F9）：`close()` 之外，主动退出（`leaveRoom`）
也要清凭证；修正 `ws.ts:8` 那句错误注释。

### 启动流程

今天是 `App.tsx:36,58` 一票否决。改成三岔：

```
读本地凭证
├── 无 / 已过期        → 首次访问，什么都不做（与今天一致）
├── 有，且同标签页       → 今天的路：直接 connect + 自动认领，静默恢复
└── 有，但新标签页       → connect + hello{claim:false} → 按 seatOffer 分支
```

「同标签页」怎么判：在 `sessionStorage` 里留一个标记位。有标记 = 这个标签页本来就
持有过这个座位 → 走自动认领；没有 = 新标签页 → 走探测。这样 R4 的两条体验天然分开，
而且**同标签页刷新那条路的代码路径完全没变**。

### 选择界面

挂在 `Splash` 上，不新开一屏。理由有三：

1. `Splash` 已经有 `resume` prop，并且已经会把提示语换成「点击继续对局」
   （`Splash.tsx:45,213`）—— 挂载点是现成的。
2. 那次点击是解锁 AudioContext 的必要手势（`Splash.tsx:15-18`），
   任何路径都绕不开它，不如就在这一屏做完选择。
3. `Splash` 已经有 Tab 圈闭与 `aria-modal`，两个按钮直接进现有的焦点陷阱，
   不会重蹈 `pvp-exit-flow` 里「横幅在圈闭外键盘够不到」那条遗留项。

`seatOffer` 三个 reason 对应三种呈现：

| reason | Splash 呈现 |
|---|---|
| `ok` | 「上一局还在进行中」+ 房间码/对手 + 两个按钮：「找回对局」「放弃重连」 |
| `busy` | 「座位仍在使用中」+ 自动重试，不摆按钮（避免顶掉自己另一个标签页） |
| `gone` | 不提示，照常走开场动画 |

- **找回** → `hello{claim:true}` → 现有 `welcome{resumed:true}` + `room` + `syncMessage` 路径，
  一字不改。跳过问候语音与 BGM（`Splash` 的 resume 支线今天就是这么做的）。
- **放弃** → 先认领再发 `leaveRoom` → 留守方收到 `peerLeft`（`pvp-exit-flow` 已实现）
  → 清本地凭证 → 落**首页**。

落首页而不是大厅：`pvp-exit-flow` 里退出落大厅，是因为那时人已经在联机语境里、
下一步多半是"换一局"。这里人刚打开应用，还没表达要联机，直接丢进大厅是替他做决定。

`busy` 窗口里选「放弃」认领不到座位，退化为纯本地放弃（清凭证、落首页），
留守方等宽限到期收 `matchEnd('disconnect')`。见 `prd.md` R7。

---

## 兼容与回滚

- 无持久化、无迁移、无部署侧配置。
- `claim` 默认 true 保证新服务端 + 旧客户端行为不变；旧服务端 + 新客户端会因为
  zod 拒绝未知字段而失败 —— 前后端同批发布，本项目无灰度，不构成问题。
- 回滚 = 还原 `protocol.ts`、`hub.ts`、`room.ts`（只读访问器）、
  `ws.ts`、`App.tsx`、`Splash.tsx` 的 diff。
- 唯一不可逆的用户可见变化：凭证从 sessionStorage 搬到 localStorage。回滚后
  localStorage 里的残留不会被读，无副作用。

## 测试要点

服务端（`room.test.ts` / `lobby.test.ts`，真实 ws 客户端）：

1. `hello{claim:false}` **零副作用**：探测后座位仍是断线态，对手**没有**收到
   `peer{online:true}`，探测方也没被 seat 上。这条是本设计的地基。
2. 三个 reason 各一条：宽限内离线 → `ok`；座位仍在线 → `busy`；宽限过后 → `gone`。
3. 放弃重连：探测 → 认领 → `leaveRoom` → 留守方收到 `peerLeft`，房间回 `waiting`。
4. **回归护栏**：不带 `claim` 的 `hello{resumeToken}` 行为与今天逐字一致；
   「半开连接」那两条既有用例必须仍然通过（它们是这次设计取舍的直接依据）。
