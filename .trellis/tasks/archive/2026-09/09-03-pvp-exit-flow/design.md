# 技术设计 — PVP 对局退出与对手退出提示

## 边界

| 层 | 文件 | 改动性质 |
|---|---|---|
| 协议 | `packages/shared/src/protocol.ts` | 新增一条 `ServerMsg` 变体 |
| 服务端 | `apps/server/src/ws/room.ts` | `leave()` 改造 + 新增 `resetToLobby()` |
| 服务端 | `apps/server/src/ws/hub.ts` | `leaveRoom` 分支保持结构，仅确认调用顺序 |
| 前端 | `apps/web/src/App.tsx` | `onExit` 落点改大厅；新增 `onPeerLeft` 路由 |
| 前端 | `apps/web/src/screens/Karuta.tsx` | 退出入口 + 确认层 + 对手退出横幅 |

`net/ws.ts`、`audio.ts`、`api.ts`、`features/*` 不动。

## 协议

```ts
// packages/shared/src/protocol.ts — ServerMsg 联合中新增
/**
 * 对手**主动退出**了房间（不是掉线）。
 *
 * 与 `peer{online:false}` 是两条互斥的路：那条说「人还可能回来，座位给他留着」，
 * 这条说「人不会回来了，座位已经释放」。混用会让留守方对着一个不存在的
 * 重连倒计时干等。
 *
 * 带上 `room` 是因为留守方要落回房间屏，而 `App` 的 `room` 消息路由
 * 刻意不接受从 karuta 屏切走（那条守卫是为了「重连时别把牌场顶掉」）。
 * 与其放宽那条守卫，不如把落点数据直接挂在这条消息上。
 */
| { t: 'peerLeft'; playerId: PlayerId; nickname: string; room: RoomView }
```

`ClientMsg` 不动 —— `{t:'leaveRoom'}` 已经存在，含义正好是"主动退出"。
`ServerMsg` 是纯类型联合（没有 zod schema），所以没有 schema 测试要补。

`matchEnd.reason` 的 `'forfeit'` 保持"已定义但未使用"的现状：留守方不看结算
（PRD R3），发一条没有接收者的 `matchEnd` 只会多一条死路径。**不要**顺手删掉这个
取值，它是协议里给未来"判负结算"留的位置，删了是破坏性变更。

## 服务端

### `Room.resetToLobby()`（新增私有方法）

把房间从"对局中"恢复到"可以重新准备"的状态。字段清单按 `startMatch()` 的镜像来写，
漏一个就会让房间卡在 `status === 'playing'`：

```
state = null            // 决定 status 与 roomView().phase 的唯一开关
pool = []; poolById.clear()
reading = null          // 当前回合答案，绝不能跨局残留
roundPhase = 'idle'
roundStartAt = 0
armedBy.clear(); taps.clear(); okuriWait = null
clipTokens.clear()      // 旧 token 必须作废，否则退出者手里的 token 还能换切片
rematchVotes.clear()
memorizeEndsAt = 0
clearTimers()
剩余座位: ready = false, taken = 0, otetsuki = 0
```

`timing`（`PlayerTiming`）**保留**：它攒的是这条连接的 RTT 画像，与对局无关，
清掉等于让留守方的延迟显示归零重来。

### `Room.leave(player)` 改造

```
leave(player):
  const seat = seats[player]; if (!seat) return
  const nickname = seat.nickname            // 必须在清座位前取
  const wasInMatch = state !== null         // 含结算阶段（phase === 'over'）
  seats[player] = null
  clearTimers()
  if (wasInMatch) resetToLobby()
  touch()
  const peer = OPPONENT[player]
  if (!seats[peer]) return                  // 没人留守，Hub 随即回收
  if (wasInMatch) send(peer, { t:'peerLeft', playerId: player, nickname, room: roomView(peer) })
  else            send(peer, { t:'room',     room: roomView(peer) })   // PRD R5
```

要点：

- `wasInMatch` 用 `state !== null` 判，与 `status` getter 同一个口径。结算阶段
  （`phase === 'over'`）也算"对局中"，因为留守方此刻在结算 overlay 上，同样需要横幅。
- `roomView(peer)` 必须在 `resetToLobby()` **之后**取，这样 `phase` 已经是 `'lobby'`、
  对手位是 `null`，留守方拿到的就是可以直接渲染的房间视图。
- `clearTimers()` 保留在 `resetToLobby()` 之外也调一次是冗余但无害；实现时二选一即可，
  不要两处都写成"顺手清一下"而让人以为是两件事。

### `Hub` 的 `leaveRoom` 分支（`hub.ts:526`）

结构不变：取 token → `bySeatToken.delete` → `room.leave(me)` → 清会话指针 →
`markListDirty()` → `dropIfDeserted(room)`。

`room.leave()` 现在会在内部发消息，所以顺序上有一条硬约束：**`dropIfDeserted` 必须在
`leave` 之后**（现状已经如此）。反过来会先 dispose 房间再往里发消息。

`dropIfDeserted` 判的是 `allOffline`，留守方在线时不会回收 —— 这正是我们要的。
两个人都走了（或一退一断）时仍然立刻回收，行为不变。

### 掉线路径

`detach()` / `forfeitIfAbandoned()` / `reattach()` **一行都不改**。这是本任务
最重要的负向约束：`peer` 广播、`DISCONNECT_GRACE_MS`、`matchEnd('disconnect')`
的时序是线上验证过的。

## 前端

### `App.tsx`

```
Screen 类型不变（'room' 分支已经带 RoomView）

<Karuta
  onExit={() => { socket.send({ t:'leaveRoom' }); setScreen({ name:'lobby' }) }}
  onPeerLeft={(room) => setScreen({ name:'room', room })}
/>
```

- `onExit` 去掉 `socket.close()`。断线时 `socket.send` 会静默失败（`ws.ts` 的既有行为），
  落到大厅后 Lobby 屏自己会连接并订阅列表 —— 不需要在这里做分支。
- `case 'room'` 那条守卫（只接受 `start | lobby | room`）**保持原样**。
  留守方的落点走 `onPeerLeft` 显式回调，不靠放宽守卫 —— 放宽了就等于允许
  任何一条 `room` 消息把正在进行的牌场顶掉。

### `Karuta.tsx`

三块新增，都是屏内局部状态，不进任何单例：

**1. 退出入口**

放在现有顶栏工具位（与 `IconButton`/`ToolRail` 同一组），仅在
`stage !== 'over' && online` 时出现。结算页与断线遮罩里已有的两个出口保持不变，
但它们的 `onClick` 现在指向同一个 `onExit`（落点已改为大厅）。

**2. 确认层**

```tsx
const [confirmExit, setConfirmExit] = useState(false)
```

复用 `ui/Overlay`（不新建组件 —— 只有这一处用，抽组件反而多一层间接）。
文案：标题「退出对局？」，正文「退出后这一局立即作废，判你负，且无法再回到这一局。」
按钮：`primary`「继续对局」（默认焦点，误触时最可能落在它上面）+ `ghost`「确认退出」。
主次刻意反着放：视觉重量给"留下"，因为这个弹层存在的唯一理由就是防误触。

**3. 对手退出横幅**

```tsx
const [peerLeft, setPeerLeft] = useState<{ nickname: string; room: RoomView } | null>(null)
const PEER_LEFT_RETURN_MS = 10_000
```

- 监听 `peerLeft` 消息 → `setPeerLeft(...)`、`setLocked(true)`、`audio.stop()`。
- 倒计时用与 `peerGraceLeft` 同一套写法（`useEffect` + 1s interval，按本地时刻算剩余），
  秒数到 0 时调 `onPeerLeft(room)`；卸载时清 interval。
- 横幅样式复用掉线横幅那一套（`sc-fixed-top` + `glass` 面），但**颜色不同**：
  掉线用 `--color-wrong`（红，"还有救但在流血"），退出用中性的 primary 面
  （已成定局，不是警报）。这个色差就是 PRD R4 要的"一眼可区分"。
- 横幅上带「立即返回」按钮 → 同样调 `onPeerLeft(room)`。
- 横幅出现时不再渲染掉线横幅与断线遮罩（对手都走了，那两条信息没有意义）。

`peerLeft` 状态存在期间牌面必须不可点：走现有的 `locked` 状态即可，
另外给牌场容器加一层灰度/降透明度，让"不能点"这件事在视觉上先说出来。

## 数据流（对局中退出）

```
退出方点退出 → 确认层 → confirm
  ↓ socket.send({t:'leaveRoom'})           ↓ setScreen('lobby')
Hub.leaveRoom: bySeatToken.delete(token)
  ↓ Room.leave('A')
     seats.A = null; resetToLobby()
     send('B', {t:'peerLeft', playerId:'A', nickname, room: roomView('B')})
  ↓ markListDirty() → 房间以 waiting 重新出现在大厅列表
  ↓ dropIfDeserted() → B 在线，不回收
留守方 Karuta: setPeerLeft(...) → 横幅 + 冻结 + audio.stop()
  ↓ 10s / 点击
onPeerLeft(room) → App.setScreen({name:'room', room}) → Room 屏
```

## 兼容性与回滚

- 新增消息是纯增量：旧客户端收到 `peerLeft` 会走 `default: break`（`Karuta` 与 `App`
  的 switch 都有兜底），表现退化成"停在牌面上"，即当前行为，不会崩。
- 服务端与前端不需要同步发布。
- 回滚 = 还原三个文件的 diff + 删掉协议里那条变体。无持久化、无迁移。

## 风险

| 风险 | 处置 |
|---|---|
| `resetToLobby()` 漏清字段 → 房间卡在 `playing` | 测试断言 `room.status === 'waiting'` 且第三人能加入并开局 |
| 定时器在 leave 后仍触发（回合推进打在半空房间上） | `leave()` 里 `clearTimers()` 在清座位后立即调用；测试用假时钟推进验证无回合广播 |
| 留守方倒计时被 React 严格模式的双次挂载重复注册 | interval 存 ref、effect 返回清理函数，与 `peerGraceLeft` 同一写法 |
| 退出者的 clipToken 仍可换切片 | `resetToLobby()` 里 `clipTokens.clear()`；测试断言旧 token 换不到切片 |
