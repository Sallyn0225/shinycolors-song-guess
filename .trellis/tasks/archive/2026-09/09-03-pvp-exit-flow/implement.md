# 执行计划 — PVP 对局退出与对手退出提示

先读 `prd.md` → `design.md`。禁区文件：`apps/web/src/net/ws.ts`、`audio.ts`、`api.ts`、
`src/features/*`（见 `.trellis/spec/web/frontend/index.md`）。本任务不需要碰它们，
如果你发现"必须改 ws.ts 才能做"，停下来说明原因而不是直接改。

## 步骤 1 — 协议

- [x] `packages/shared/src/protocol.ts`：`ServerMsg` 联合新增 `peerLeft` 变体
      （字段与注释见 design.md「协议」节）。注释用中文，与该文件其余注释同风格。
- [x] 不动 `ClientMsg`，不动 `matchEnd.reason` 的取值。

验证：`pnpm --filter @scg/shared typecheck`

## 步骤 2 — 服务端房间

- [x] `apps/server/src/ws/room.ts` 新增私有 `resetToLobby()`，字段清单严格按 design.md
      的镜像表；对照 `startMatch()` 逐字段核一遍，漏一个就是"房间卡在 playing"。
- [x] 改造 `leave(player)`：先取昵称 → 判 `wasInMatch` → 清座位 → 清定时器 →
      `resetToLobby()` → 按分支给留守方发 `peerLeft` 或 `room`。
- [x] **不要**碰 `detach()` / `reattach()` / `forfeitIfAbandoned()` / `endMatch()`。
- [x] `hub.ts` 的 `leaveRoom` 分支：确认 `dropIfDeserted` 仍在 `room.leave()` 之后调用；
      除此之外不改。

验证：`pnpm --filter @scg/server typecheck`

## 步骤 3 — 服务端测试

在 `apps/server/src/ws/room.test.ts`（或 `lobby.test.ts`，按现有用例归属选，
两文件都用真实 `ws` 客户端打真实监听服务）新增：

- [x] **对局中退出**：A、B 开局到牌面 → A 发 `leaveRoom` → B 收到 `peerLeft`，
      `playerId === 'A'`、`nickname` 正确、`room.phase === 'lobby'`、`room.players.A === null`。
- [x] **房间可复用**：承上，断言房间 `status`/大厅列表条目为 `waiting`，
      第三个客户端用房间码能加入并与 B 再开一局。
- [x] **旧凭证与 token 作废**：A 拿原 `resumeToken` 重连拿不回座位；
      A 手上的 `clipToken` 换不到切片。
- [x] **等待阶段退出**：未开局时 A 离开 → B 收到 `room`，`players.A === null`。
- [x] **退出 ≠ 掉线**：A 直接断开连接（不发 `leaveRoom`）→ B 收到的是
      `peer{online:false, graceEndsAtServer}`，**不是** `peerLeft`；宽限到期后收到
      `matchEnd(reason:'disconnect')`。这条是回归护栏，必须有。
- [x] **双方都走**：一退一断后房间仍被立即回收（`dropIfDeserted` 不退化）。

验证：`pnpm --filter @scg/server test`

## 步骤 4 — 前端路由

- [x] `apps/web/src/App.tsx`：`Karuta` 的 `onExit` 去掉 `socket.close()`，落点改
      `{name:'lobby'}`；新增 `onPeerLeft={(room) => setScreen({name:'room', room})}`。
- [x] `case 'room'` 的守卫保持原样（design.md 说明了为什么不放宽）。
- [x] 顺手更新 `onExit` 上方那条注释 —— 它现在说的是旧行为。

## 步骤 5 — Karuta 屏

- [x] Props 增加 `onPeerLeft: (room: RoomView) => void`。
- [x] 新增退出入口（顶栏工具位，`stage !== 'over' && online` 时可见）。
- [x] 新增确认层：`ui/Overlay` + 两个 `Button`，主次按 design.md 反着放
      （「继续对局」是 primary）。Esc / 点遮罩 = 取消。
- [x] 监听 `peerLeft`：存状态、`setLocked(true)`、`audio.stop()`。
- [x] 横幅：中性 primary 面（与掉线的 `--color-wrong` 红面明确区分）、昵称、
      剩余秒数、「立即返回」。倒计时写法对齐现有 `peerGraceLeft` 的 effect。
- [x] `peerLeft` 期间不渲染掉线横幅与断线遮罩；牌场容器加灰度/降透明表达不可点。
- [x] 检查所有 `onExit` 调用点（结算页「退出房间」、断线遮罩「放弃这局」、
      `stage==='over' && !ended` 的「返回」）在落点改为大厅后语义仍然通顺。

验证：`pnpm --filter @scg/web typecheck` → `pnpm --filter @scg/web test`

## 步骤 6 — 全量校验

- [x] `pnpm -r typecheck`
- [x] `pnpm -r test`
- [x] 手动联机走查（两个浏览器窗口，见下）—— 用户 2026-09-03 实机走查，7 条全部通过

### 手动走查清单

1. 建房 → 两人入座 → 准备开局 → 记忆阶段中途 A 点退出 → 弹确认 → 取消 →
   记忆倒计时未受影响。
2. 再点退出 → 确认 → A 到大厅且房间列表可见；B 看到横幅、牌面变灰、音频停。
3. B 等满 10 秒 → 落到 Room 屏，房间码不变，对手位"等待对手加入…"，准备按钮禁用。
4. 重来一次，B 点「立即返回」→ 落点与第 3 条一致。
5. 回合进行中（音频正在播）退出 → B 侧音频立即停止，不会播完整段。
6. 结算页阶段 A 点「退出房间」→ B 在结算 overlay 上看到横幅并能返回房间。
7. 对照组：A 直接关标签页（掉线）→ B 看到的是红色「掉线了，等待重连」横幅，
   A 在宽限内重开页面能接回牌面。

## 复查门（提交前）

- [x] `detach` / `reattach` / `forfeitIfAbandoned` 的 diff 为空。
- [x] `net/ws.ts`、`audio.ts`、`api.ts`、`features/*` 的 diff 为空。
- [x] `resetToLobby()` 与 `startMatch()` 的字段集合逐条对过。
- [x] 新增消息在 `Karuta`、`App`、`Room` 三处 switch 里都不会打穿到意料外的分支。

## 回滚点

每个步骤都是独立提交点。整体回滚 = 还原 5 个文件的 diff
（`protocol.ts`、`room.ts`、`App.tsx`、`Karuta.tsx`、测试文件）。无持久化、无迁移、
无部署侧配置。

---

## 验收结果（2026-09-03）

自动化门禁全绿，两条命令均由主会话独立复跑确认，非转述：

- `pnpm -r typecheck` — 5 个包全部 Done，exit=0
- `pnpm -r test` — 310 passed（shared 13 / web 113 / game-core 62 / prepare-audio 14 /
  server 108），exit=0

服务端新增 5 条用例，覆盖 prd 要求的三条路径外加三条护栏：对局中退出、房间可复用、
等待阶段退出、**退出 ≠ 掉线**（关键回归护栏）、对局中一退一断后立即回收。

复查门逐条通过：禁区文件（`net/ws.ts`、`audio.ts`、`api.ts`、`features/*`）与掉线路径
（`detach` / `reattach` / `forfeitIfAbandoned` / `endMatch`）diff 均为空，`hub.ts` 完全未动；
`resetToLobby()` 与 `startMatch()` 字段已逐条对过。

### 检查阶段发现并修掉的实质问题

1. 退出入口自成一行会把自陣 3 张牌顶出折线（390×844 实测，该屏只剩 6px 余量）。
   改为挂进自陣 sticky 名牌行右端，`.tap-line` + `-my-2` 撑 44px 热区，行高只涨 1px。
2. 横幅那 10 秒里 `RoomView` 会过期（房间已重回大厅列表，第三人随时可能进来）。
   新增 `case 'room'` 在横幅期间刷新落点数据。
3. 「立即返回」在 12% 紫面上对比度 3.96:1 不达标 → 改 `text-primary`（4.69:1）。
4. `peerLeft` 期间牌面未加 `inert`，24 颗牌仍在 tab 序列里。
5. 新增中文按钮落在 `lang="ja"` 容器内，补 `lang="zh-CN"`。
6. `clearTimers()` 两处都写 → 收敛到 `leave()` 单一所有者。

### 遗留项（未修，需人工判断）

1. **结算页收到 `peerLeft` 时键盘够不到「立即返回」**：结算 `Overlay` 是 `aria-modal` +
   Tab 圈闭（z=40），横幅 z-50 视觉在上但不在圈闭内；10s 自动返回兜底。同时「再战一局」
   仍可点，服务端已忽略（`state === null`），但文案会停在「等待 X 同意…」。改不改属产品判断。
2. **退出方本地 `sessionStorage` 的 `resumeToken` 不再被清**：服务端凭证已作废，残留的只是
   本地字符串，后果是退出后刷新会闪一下「正在找回对局…」。与 Room 屏「离开房间」的既有行为
   一致，且清理入口在禁区文件 `net/ws.ts`，按规范未动。
3. **`peerLeft` 期间光带仍在跑本回合倒计时**，中央面板仍显示「聴」+ 秒数，而牌面已冻结。
   信息不矛盾但略吵，留给手动走查决定。
4. **宽限到期的 `matchEnd(reason:'disconnect')` 无自动化覆盖**（宽限 60s，测试跑不动），
   只能手动走查；好在相关 diff 为空，行为不可能变。

### 手动走查结果

用户 2026-09-03 实机走查，7 条全部通过，含第 7 条对照组（关标签页 → 留守方看到的是红色
「掉线了，等待重连」，不是退出横幅）。

走查中发现一个**既有缺陷**（非本任务引入，已另立任务）：掉线方重新打开链接时没有任何
重连提示，启动路径与首次访问完全一致。根因是座位凭证存 `sessionStorage`
（`apps/web/src/net/ws.ts:11-37`），标签页一关就被浏览器清空，`App.tsx:58` 的
`hasResumeToken` 为 false，客户端连试都不会试。服务端侧是好的：座位与 `bySeatToken`
在整个宽限期内都还在。`ws.ts:8` 的注释「刷新/误关标签页能找回座位」后半句是错的。

### 另开任务的线索（不属本任务）

- `tools/ui-audit/probe.mjs` 已「绿着过期」：不关 `Splash` 遮罩，选择器与建房流程都对不上，
  直接跑会抛「找不到按钮」。已在 `web/frontend/quality-guidelines.md` 加警告，但工具本身待修。
- `apps/server/src/ws/room.ts:118` 的 `private pool` 自 HEAD 起就只写不读（真正被读的是
  `poolById`）。本任务只按镜像要求加了一行 `this.pool = []`，未改变其读写性质。
