# 执行计划｜公网联机房间

自底向上：协议 → 服务端 → 反滥用 → 前端 → 文档。
每个阶段结束都有可运行的验证，前一阶段不绿不进下一阶段。

---

## 阶段 0｜基线

- [ ] `pnpm -r typecheck && pnpm -r test` 先跑一遍，记录基线（server 应为 49 个用例全绿）。
      **在改任何代码之前**——否则后面分不清是新代码坏了还是本来就红。

---

## 阶段 1｜协议（`packages/shared`）

- [ ] `protocol.ts`：新增 `RoomVisibility` / `RoomStatus` / `RoomSummary` /
      `ROOM_NAME_MAX` / `ROOM_LIST_MAX`。
- [ ] `protocol.ts`：`RoomView` 增 `name` / `visibility`。
- [ ] `protocol.ts`：`clientMsgSchema` 的 `createRoom` 增 `name?` / `visibility`（默认 `private`）；
      新增 `{t:'rooms', subscribe}`。
- [ ] `protocol.ts`：`ServerMsg` 增 `roomList`；`ErrCode` 增 `server_busy` / `too_many_rooms`。
- [ ] `protocol.ts`：导出纯函数 `sanitizeRoomName(raw): string`。
- [ ] 给 `sanitizeRoomName` 写单测（控制字符、零宽字符、连续空白、超长、纯空白）。

**验证**：`pnpm --filter @scg/shared typecheck`
（此时 server / web 会因 `RoomView` 缺字段而类型报错，属预期，阶段 2 修复）

**审查点**：`sanitizeRoomName` 放在 shared 是否违反「无运行时」——
它是纯字符串函数，与既有的 `encode()` 同级。若 check 认为不妥，
备选是放 `apps/server` 并在 web 侧只做长度限制（代价：两边规则可能漂移）。

---

## 阶段 2｜Room 元数据（`apps/server/src/ws/room.ts`）

- [ ] 构造参数增 `name` / `visibility` / `creatorIp`；新增 `readonly createdAt`。
- [ ] 新增 getter：`playerCount` / `status` / `hostNickname`；新增 `summary()`。
- [ ] `roomView()` 带上 `name` / `visibility`。
- [ ] **不改任何状态迁移、不改任何定时器。**

**验证**：`pnpm --filter @scg/server test`（既有 49 个用例应仍全绿）

---

## 阶段 3｜Hub 房间注册表与列表推送（`apps/server/src/ws/hub.ts`）

- [ ] `Session` 增 `ip` / `listening`；`connect(socket, ip)` 改签名。
- [ ] `app.ts` 的 ws handler 改为 `(socket, req)`，传 `req.ip`。
- [ ] 新增 `bySeatToken: Map<string, Room>` 索引，`hello` 重连改为查索引而非全表扫；
      `join` 登记、`leave` / 房间销毁时清除。
- [ ] `createRoom` 处理 `name` / `visibility`，落 `sanitizeRoomName` 的结果，
      空名回落 `${nickname} 的房间`。
- [ ] 实现 `markListDirty()` + `flushList()`（250ms 合并、排序、截断 80、总数统计）。
- [ ] 处理 `{t:'rooms', subscribe}`；`createRoom` / `joinRoom` 成功后自动退订。
- [ ] `sweep()` 间隔 15s → 5s，并在其中做 summary 快照比对触发标脏。

**验证**：新增 `hub.test.ts`（或扩 `room.test.ts`）覆盖 AC1–AC4、AC8。

**回滚点**：此阶段结束时功能已可用但无防护。**不要在这里停下来部署到公网**——
D1 决定了反滥用是同批交付的硬性要求。

---

## 阶段 4｜反滥用（`apps/server/src/ws/quota.ts` + `config.ts`）

- [ ] 新建 `quota.ts`：`IpQuota` 滑动窗口计数器 + 单测。
- [ ] `config.ts`：新增 5 个环境变量（见 `design.md` 第 4 节）。
- [ ] `hub.ts` 的 `createRoom` 按 `design.md` 的 5 步顺序做检查。
- [ ] `hub.ts` 的 `joinRoom` 失败计数与限流；成功不计数。
- [ ] `sweep()` 增加 `WAITING_TTL_MS` 到期的等待中房间回收 + 通知房主。

**验证**：新增测试覆盖 AC5–AC7；`MAX_ROOMS=0` 时建房返回 `server_busy`。

**风险文件**：`hub.ts` 的 `handle()` 分支顺序。`createRoom` / `joinRoom` 在
`hub.ts:207` 的「以下都要求已入座」守卫**之前**处理，加新分支时别把它们挪到守卫后面。

---

## 阶段 5｜前端（`apps/web`）

前端每一步都走 impeccable，按顺序：

- [ ] **`/impeccable shape 联机大厅的房间列表`** —— 在写组件之前先定信息架构：
      列表 / 创建入口 / 房间码入口三者的层级关系、空态、`full`/`playing` 的表达方式。
      产出的方案要与 `prd.md` 的 R4 对齐。
- [ ] 按 shape 的方案实现：
  - `src/components/RoomCard.tsx`（新建）
  - `src/screens/Lobby.tsx`（重写为纯大厅）
  - `src/screens/Room.tsx`（从旧 `Lobby.tsx:90-152` 抽出）
  - `src/App.tsx`（新增 `room` 屏；离开房间回大厅；放宽 `room` 消息的屏幕守卫）
  - 昵称 localStorage 持久化
  - 删掉「同一局域网直接输入即可加入」文案（AC15）
- [ ] **`/impeccable harden src/screens/Lobby.tsx`** —— 错误态、空态、
      断线时列表怎么显示、房间名超长/含特殊字符的渲染、加入失败的反馈。
- [ ] **`/impeccable audit src/screens/Lobby.tsx`** —— a11y（列表项键盘可达、
      disabled 语义、状态不只靠颜色）与响应式。
- [ ] **`/impeccable polish`** —— 上线前收尾。

**验证**：`pnpm --filter @scg/web typecheck && pnpm --filter @scg/web test`；
本地起两个浏览器窗口人工过 AC10–AC15。

**禁区提醒**：`src/net/ws.ts` / `audio.ts` / `api.ts` / `features/*` 一行都不要改。
新消息通过既有的 `socket.send` / `socket.on` 透传即可。

---

## 阶段 6｜文档

- [ ] `DEPLOY.md`：新增「开放公网部署」小节 —— 5 个新环境变量、
      `TRUST_PROXY` 与按 IP 限流的依赖（不开时所有连接共享一个 IP 桶）、
      `MAX_ROOMS=0` 应急关停、D1 的版权风险已知情接受。
- [ ] `PROGRESS.md` / `PRODUCT.md`：记录房间列表能力。
- [ ] Phase 3 的 spec 更新：`.trellis/spec/server/backend/realtime-guidelines.md`
      （Hub 的列表推送与配额）、`.trellis/spec/shared/backend/protocol-and-contracts.md`
      （新消息与 `RoomSummary`）。

---

## 全量验证命令

```bash
pnpm -r typecheck
pnpm -r test
pnpm --filter @scg/web build     # 前端产物能构建，单进程模式才托管得起来
```

## 风险文件与回滚点

| 文件 | 风险 | 回滚 |
|---|---|---|
| `apps/server/src/ws/hub.ts` | 改动最大；`handle()` 分支顺序、sweeper 间隔、重连索引三处都可能出隐性 bug | 阶段 3 / 4 各自是独立提交 |
| `apps/server/src/ws/room.ts` | 只加只读字段，风险低；但 `roomView()` 变更会影响既有测试断言 | 单独提交 |
| `apps/web/src/App.tsx` | 屏幕状态机改动，牵扯重连恢复路径（`App.tsx:79-88` 的守卫） | 单独提交，人工验刷新恢复 |
| `packages/shared/src/protocol.ts` | 四个包共同依赖，改错全线红 | 阶段 1 单独提交 |

## `task.py start` 之前的最后检查

- [ ] `implement.jsonl` / `check.jsonl` 已填入真实 spec 条目
- [ ] `prd.md` 无遗留 Open Questions
- [ ] 用户已明确批准最终规划摘要
