# 执行计划｜全员离线房间即时回收

先立护栏（跑基线 + 确认既有重连测试绿），再收敛清理路径，再加回收，最后补测试与文档。
每一阶段结束都有可运行的验证，前一阶段不绿不进下一阶段。

---

## 阶段 0｜基线

- [ ] `pnpm -r typecheck && pnpm -r lint && pnpm -r test`，**记录 `@scg/server` 的用例数与耗时**。
      在改任何代码之前跑——否则后面分不清是新代码坏了还是本来就红。
- [ ] 单独确认这两条现在是绿的（它们是 R4 的护栏）：
      `pnpm --filter @scg/server test -- -t 重连`

---

## 阶段 1｜收敛清理路径（纯重构，行为不变）

`apps/server/src/ws/hub.ts`

- [ ] 把 `sweep()` 里 `waitedTooLong` 分支的**会话清理循环**（`hub.ts:104-110`）挪进 `dropRoom`，
      注释一并带过去并改写成「所有退场路径共享」的口径。
- [ ] `sweep()` 的那个分支只留 `room.broadcastClosed('idle')`——
      它是**发消息**，必须在 `dispose()` 之前，且只有这一条路径需要。
- [ ] 不新增任何行为。

**验证**：`pnpm --filter @scg/server test`（用例数与阶段 0 一致，全绿）

---

## 阶段 2｜即时回收

`apps/server/src/ws/hub.ts`

- [ ] 新增 `private dropIfDeserted(room: Room): void`，判据 `room.allOffline`，
      注释按 `design.md` §3.1 写全：为什么是 `allOffline` 而不是 `isEmpty`、
      为什么重连宽限在这里不适用（「宽限保护的是还有人在等你回来」）。
- [ ] `disconnect()`：先 `detach` → `sessions.delete` → `dropIfDeserted(room)`。
      **顺序不能反**（见 design §3.2）。
- [ ] `leaveRoom` 分支：`markListDirty()` 之后调 `dropIfDeserted(room)`。
- [ ] `sweep()` 的 `abandoned` 分支：逻辑与常量都不动，**只改注释**——
      标注它现在是兜底，正常路径已在事件里回收。

**验证**：`pnpm --filter @scg/server typecheck && pnpm --filter @scg/server test`
（此时既有测试应当全绿；若「重连」那两条红了，说明判据写成了 `isEmpty` 之外的东西，回头看 design §2）

---

## 阶段 3｜测试

`apps/server/src/ws/lobby.test.ts`，新增 `describe('全员离线即时回收')`：

- [ ] **T1 一人掉线 + 一人退出**：A 建公开房、B 加入、C 订阅列表；A `close()`；
      B 发 `leaveRoom` 后 `close()`；C 在 **2 秒**超时内收到不含该房的 `roomList`。
      短超时是断言的一部分——它证明回收不是靠 65s 的 TTL。
- [ ] **T2 凭证作废**：接 T1，A 用原 `resumeToken` 重连 →
      `welcome.resumed === false && welcome.resumeToken === ''`。
- [ ] **T3 双方同时掉线**：都不发 `leaveRoom`，直接 `close()` → 同 T1 的断言。
- [ ] **T4 单人房主掉线**：A 建房后独自 `close()` → 房间消失 + 凭证作废。
      **测试名与注释必须写明这是 D3 有意接受的行为变更**，不是顺带效果。
- [ ] **T5 回归护栏**：A 掉线、B 在线 → C 看到的列表里房间仍在；A 重连 `resumed === true`。
- [ ] **T6 名额释放**：`buildApp({ rooms: { ...紧配额, publicMax: 1 } })` →
      占满 → 全员离线 → 立刻建第二间成功（不再收到 `server_busy`）。
- [ ] **既有的「重连」两条测试一个字都不改。**

**验证**：`pnpm --filter @scg/server test`（用例数 = 阶段 0 + 6）

---

## 阶段 4｜文档与 spec

- [ ] `.env.example` / `DEPLOY.md`：检索 `ABANDONED_TTL_MS` 的说明文字。
      变量与默认值都没变，但它的**语义从「回收时机」变成了「兜底时机」**——
      说明里若写着「全员掉线后多久回收」，要改成兜底的口径。没写就不动。
- [ ] `.trellis/spec/server/backend/realtime-guidelines.md`：补一条房间生命周期的规则。
      建议措辞：**「重连宽限保护的是『还有人在等你回来』。一条活连接都不剩的房间立刻回收，
      座位凭证同时作废。」** 并注明判据是 `allOffline` 而非 `isEmpty`，以及那个反直觉的点：
      `detach` 不清座位，所以全员掉线的房间既不空也不过期。
- [ ] 若 `.trellis/spec/server/backend/index.md` 里有房间退场路径的清单，同步 `dropRoom` 现在
      还负责清会话引用。

**验证**：`pnpm -r typecheck && pnpm -r lint && pnpm -r test`

---

## 阶段 5｜手工验收

两个浏览器 + 一个开着大厅的第三窗口，按 `prd.md` 的 AC1–AC6 走一遍。
`MAX_PUBLIC_ROOMS=1` 起服务端验 AC6。

---

## 阶段 6｜半开连接重连竞态（追加）

### 背景

`hello` 重连成功后只把**新** socket 的会话指向了座位，旧 socket 的会话仍留在 `sessions` 里，
`room` / `playerId` 未清。失效链：

1. 旧 socket 半开（拔网线、断电，不发 FIN），最长要等一个协议心跳周期（`WS_HEARTBEAT_MS`，25s）才判死；
2. 这期间客户端已用新 socket `hello` 接回座位，`reattach` 把 `seat.conn` 换成了新连接；
3. 旧 socket 迟到的 close 触发 `disconnect()`，拿陈旧的 `s.playerId` 调 `room.detach(pid)`，
   把**新连接**的座位置空并广播 `peer offline`；
4. 阶段 2 新增的 `dropIfDeserted` 放大了后果——若对手此时也离线，房间当场被销毁、座位凭证作废。

### 改法

`apps/server/src/ws/hub.ts`

- [x] 新增 `private releaseSeatPointers(room, playerId, keep)`：清掉除 `keep` 之外所有
      `s.room === room && s.playerId === playerId` 的会话指针。形状与 `dropRoom` 里那次会话扫描一致，
      但 `dropRoom` 的既有行为不动。
- [x] 判据**同时**比对 `room` 与 `playerId`——只比 `room` 会把同房间对手的会话一起误伤。
- [x] `hello` 重连成功分支：设置新会话指针**之前**调 `this.releaseSeatPointers(room, pid, s)`。
- [x] 注释写明「座位所有权随 `reattach` 转移，旧会话的指针已经不代表这个座位」。
- [x] `room.ts` 的 `reattach` / `detach` 语义与 `sweep()` 的常量、判据一字未动。

### 测试

`apps/server/src/ws/room.test.ts` 的 `describe('重连')` 末尾新增两条（既有三条一字未改）：

- [x] **半开连接：旧 socket 迟到的 close 不能把已接回座位的新连接踢下线**——
      A 建房、B 加入；A **不关** socket1 直接用 socket2 `hello` → `resumed === true`；
      再关 socket1；断言 B 收不到 `peer` 与 `roomClosed`，A 在 socket2 上 `ready` 仍能拿回房间视图而非 `not_in_room`。
- [x] **半开连接：对手也离线时，旧 socket 的 close 不能让房间被当成全员离线销毁**——
      同上但先让 B `close()`，确认房间不会被 `dropIfDeserted` 误销毁。
- [x] 反向验证：临时禁用 `releaseSeatPointers` 调用后这两条**均失败**
      （一条断在 `peer` 上，一条只收到 `error`），证明它们确实在守这个缺陷。

### 文档

- [x] `.trellis/spec/server/backend/realtime-guidelines.md` 的 Reconnect 一节新增
      「Seat ownership transfers with `reattach`; stale session pointers must be voided」。

**验证**：`pnpm --filter @scg/server typecheck && pnpm --filter @scg/server test`
（102 passed / 5 files = 阶段 3 的 100 + 本阶段 2）

---

## 回滚点

- 阶段 1 之后：纯重构，可独立提交，可独立回滚。
- 阶段 2 之后：行为变更全部在这一步，`git revert` 单个提交即回到旧行为。
- 建议**分两个提交**（重构 / 行为变更），这样万一线上要回滚，回的是最小的那一块。
