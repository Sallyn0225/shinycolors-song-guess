# 技术设计｜全员离线房间即时回收

> 对应 `prd.md`。改动面：`apps/server/src/ws/hub.ts` 一个文件 + 测试 + 文档/spec。

## 1 · 边界：为什么这件事只能在 Hub 做

`Room` 知道自己有没有活连接（`allOffline`），但**不知道自己在不在表里**——
`hub.rooms`、`bySeatToken`、大厅订阅者列表全在 Hub。
`hub.ts:121` 那句注释已经把规矩写死了：

> 房间退场的唯一出口：销毁定时器、清索引、出表。任何一步漏掉都是泄漏

所以本任务**不给 `Room` 加回调、不让 `Room` 自己上报**，只在 Hub 已有的两个事件入口上
补一次判断。`Room` 侧一行不改。

---

## 2 · 判据

```ts
// room.ts:163（既有，不改）
get allOffline(): boolean {
  return (['A', 'B'] as const).every((p) => this.seats[p] === null || this.seats[p]?.conn === null)
}
```

注意它对**空房间也返回 `true`**（`every` 在两个 `null` 座位上成立），
所以判据就是 `room.allOffline` 一个，不需要再 `|| room.isEmpty`。
`sweep()` 里今天写的是 `room.isEmpty || ... || abandoned`，那是因为它还要区分
「空房」与「全员掉线但未到 TTL」两种不同的处置；新的即时回收路径没有这个区分。

**判据的语义要在代码注释里钉死**：判的是「还有没有人能收到消息」，
不是「还有没有座位」。座位是为重连保留的**期待**，期待要有人在等才成立。

---

## 3 · 改动点

### 3.1 新增 `dropIfDeserted(room)`

```ts
/**
 * 房里一条活连接都不剩就立刻回收。
 *
 * 判的是 `allOffline` 而不是 `isEmpty`：`detach` 只清连接不清座位（为了重连），
 * 所以「一人掉线 + 一人退出」留下的房间既不空、也够不到 ROOM_TTL_MS，
 * 靠 sweep 要等 abandonedTtlMs（默认 65s）+ 一跳清扫。那 70 秒里它会挂在大厅上、
 * 占着公开房名额、还能被自己接回一间没有对手的房。
 *
 * 重连宽限保护的是「还有人在等你回来」；没人在等的时候，它什么也没有保护。
 */
private dropIfDeserted(room: Room): void {
  if (!room.allOffline) return
  this.dropRoom(room)
}
```

### 3.2 两个调用点

```ts
disconnect(socket: Socket): void {
  const s = this.sessions.get(socket)
  if (!s) return
  const room = s.room
  if (room && s.playerId) room.detach(s.playerId)
  this.sessions.delete(socket)          // 先摘会话，再判回收
  if (room) this.dropIfDeserted(room)
}
```

```ts
case 'leaveRoom': {
  const token = room.seatOf(me)?.resumeToken
  if (token) this.bySeatToken.delete(token)
  room.leave(me)
  s.room = null
  s.playerId = null
  this.markListDirty()
  this.dropIfDeserted(room)             // leave 之后这间房可能已经没人了
  break
}
```

**顺序有讲究**：`sessions.delete` / `s.room = null` 必须在 `dropIfDeserted` 之前，
否则 3.3 那段会话清理会去动一个正在被处理的会话，读起来像是自己清自己。

### 3.3 `dropRoom` 顺手把指向它的会话清干净

今天这段清理只写在 `sweep()` 的 `waitedTooLong` 分支里（`hub.ts:101-111`）。
把它挪进 `dropRoom`，**所有**退场路径共享同一份清理：

```ts
private dropRoom(room: Room): void {
  for (const p of ['A', 'B'] as const) {
    const token = room.seatOf(p)?.resumeToken
    if (token) this.bySeatToken.delete(token)
  }
  // 房间马上要 dispose 了，任何还指向它的会话必须同步断开引用，
  // 否则它们后续的消息会打在一个已 dispose 的 Room 上
  for (const s of this.sessions.values()) {
    if (s.room === room) { s.room = null; s.playerId = null }
  }
  room.dispose()
  this.rooms.delete(room.code)
  this.markListDirty()
}
```

`sweep()` 的 `waitedTooLong` 分支只保留 `broadcastClosed('idle')`（那是**发消息**，
必须赶在 dispose 之前，且只有这一条路径需要），会话清理由 `dropRoom` 承担。

这一步是纯收敛，不改任何可观察行为——但它让「新增了一条回收路径」这件事
不需要在第二个地方再抄一遍清理。

### 3.4 `sweep()` 的 `abandoned` 分支降级为兜底

逻辑与 `abandonedTtlMs` 都不动，只改注释：说明正常路径已在事件里回收，
这一条防的是没有触发 `disconnect` 的异常路径（例如进程内部状态不一致），
正常运行时它应当永不命中。

---

## 4 · 影响面分析（这次改动会不会碰坏别的东西）

| 场景 | 今天 | 改后 | 判断 |
|---|---|---|---|
| 一方掉线，另一方在线 | 保留，60s 宽限，到期判负 | **完全不变**（`allOffline === false`） | ✅ PRD R4 |
| 对局中双方都掉线 | 等 65s + 清扫；`forfeitIfAbandoned` 可能先给一方判胜 | 立刻回收，不再判胜 | ✅ 没人收得到那个胜负 |
| 房间只剩一人且他掉线 | 保留 65s，可重连 | 立刻回收，重连失败 | ⚠️ **有意的行为变更**（D3），有专门的测试 |
| 双方都 `leaveRoom` | `isEmpty` → 下一次清扫（≤5s） | 立刻 | ✅ 更快，方向一致 |
| `waitedTooLong`（15 分钟无人加入） | 广播 `roomClosed` 再 drop | 不变 | ✅ |
| 大厅列表 | 幽灵房最长挂 70s | 不会出现 | ✅ 父任务 AC-P3 |
| 公开/私人房名额 | 被幽灵房占最长 70s | 不占 | ✅ |

### 前端为什么零改动

回收后旧凭证走的是**已经存在**的分支：`hello` 找不到 `bySeatToken` → 回
`welcome { resumed: false, resumeToken: '' }`（`hub.ts:341-350`）→
`App.tsx:78-90` 收到后 `setResuming(false)`，若当时停在牌场则退回首页并提示
「对局已结束 —— 座位在断线宽限内没能恢复」。

那句提示对新场景**仍然说得通**（座位确实没能恢复），本轮不改文案；
如果实测觉得对「我自己退的」这种情形太重，那是另一个任务的事，记在 PRD Non-Goals 之外的观察项里。

---

## 5 · 测试策略

放在 `apps/server/src/ws/lobby.test.ts`（房间生命周期与列表是它的主题；
`room.test.ts` 是对局与重连）。新增一个 `describe('全员离线即时回收')`：

| 用例 | 断言要点 |
|---|---|
| 一人掉线 + 一人退出 → 立刻消失 | 订阅列表的第三方客户端在**远小于 `abandonedTtlMs`** 的超时内收到不含该房的 `roomList`；用短超时（如 2s）来证明「不是靠 TTL」 |
| 同上，旧凭证重连 | `welcome.resumed === false && resumeToken === ''` |
| 双方同时掉线 | 同上 |
| 单人房主掉线（D3） | 房间消失 + 凭证作废，**注释写明这是有意的行为变更** |
| 还有人在线就不回收 | A 掉线、B 在线 → 列表里房间仍在；A 重连 `resumed === true` |
| 公开房名额释放 | `buildApp({ rooms: { publicMax: 1, ... } })` 注入紧配额：占满 → 全员离线 → 立刻可再建 |

配额注入沿用既有写法（`buildApp` 允许覆盖 `RoomQuotas`，见 `lobby.test.ts` 里
`max: 0` 与分类上限那几条用例）。

**既有的两条重连测试不许改断言**——它们正是 R4 的护栏。

---

## 6 · 回滚

单文件、无协议改动、无持久化：`git revert` 即可。
回滚后行为退回「等 65s + 清扫」，不会留下任何不一致状态。
