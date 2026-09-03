# 执行计划 — 断线重连找回与放弃重连

先读 `prd.md` → `design.md`。

**本任务允许改 `apps/web/src/net/ws.ts`**（它是 UI 工作的禁区文件，但本任务不是 UI 工作，
凭证存储就住在那里）。仍然禁止碰的：`audio.ts`、`api.ts`、`src/features/*`，
以及 `ws.ts` 里凭证读写以外的任何部分 —— 重连退避、时钟同步、心跳一行都不要动。

## 步骤 1 — 协议

- [ ] `packages/shared/src/protocol.ts`：`clientMsgSchema` 的 `hello` 加
      `claim: z.boolean().optional()`（**不写 `.default()`**，让"缺省"与"显式 true"
      在服务端读起来一样，避免 `z.input`/`z.infer` 的可选性分歧）。
- [ ] `ServerMsg` 联合新增 `seatOffer` 变体，字段见 design.md「协议」节。
- [ ] 注释写清 `claim` 默认为真的理由（默认值落在"不改变既有行为"那一侧）。

验证：`pnpm --filter @scg/shared typecheck && pnpm --filter @scg/shared test`

## 步骤 2 — 服务端

- [ ] `room.ts` 加一个只读访问器判断某座位当前是否持有活连接。**不要**暴露 `seats`。
- [ ] `hub.ts` 的 `hello` 分支加一条前置支路：`claim === false` 时查 `bySeatToken`，
      回 `seatOffer` 后直接 `return`。
- [ ] **零副作用**是这条支路的硬要求：不 `reattach`、不写 `s.room`/`s.playerId`、
      不改 `s.listening`、不广播 `peer`、不 `markListDirty`。
- [ ] `reattach()` / `detach()` / `releaseSeatPointers()` / `forfeitIfAbandoned()` /
      `dropIfDeserted()` / `leaveRoom` 分支 **一行都不要动**。

验证：`pnpm --filter @scg/server typecheck`

## 步骤 3 — 服务端测试

- [ ] **探测零副作用**（地基，必须先写）：A 断线 → 新连接发 `hello{claim:false}` →
      B **没有**收到 `peer{online:true}`，A 的座位仍是断线态，探测方未被 seat 上。
- [ ] `reason` 三态：宽限内离线 → `ok`（且 `roomCode`/`opponent`/`inMatch` 正确）；
      座位仍在线 → `busy`；宽限过后或房间已散 → `gone`。
- [ ] **放弃重连**：探测 → `hello{claim:true}` 认领 → `leaveRoom` →
      B 收到 `peerLeft`，房间 `status` 回 `waiting` 且重回大厅列表。
- [ ] **回归护栏**：不带 `claim` 的 `hello{resumeToken}` 与今天逐字一致
      （`welcome{resumed:true}` + `room` + `syncMessage`）。
- [ ] 既有的两条「半开连接」用例必须仍然通过 —— 它们是 design.md 那条取舍的直接依据，
      跑挂了就说明守卫又被塞进 `reattach()` 了。

验证：`pnpm --filter @scg/server test`

## 步骤 4 — 凭证存储（禁区文件，改动最小）

- [ ] `net/ws.ts`：`sessionStorage` → `localStorage`，存 `{token, exp}`，
      读取时过期即丢弃并清除。保留现有的 try/catch（无痕模式会抛）。
- [ ] 加一个 `sessionStorage` 标记位区分"本标签页持有过这个座位"，
      供 `App.tsx` 判断走自动认领还是探测。
- [ ] 补 `leaveRoom` 后的凭证清理（`prd.md` F8）。
- [ ] 修正 `ws.ts:8` 那句错误注释（`prd.md` F9）。
- [ ] **自查**：`git diff apps/web/src/net/ws.ts` 里不得出现 `connect()`、
      `scheduleReconnect`、`startSync`、`notePong` 的任何改动。

验证：`pnpm --filter @scg/web typecheck`

## 步骤 5 — 启动流程与选择界面

- [ ] `App.tsx`：把 `hasResumeToken` 一票否决改成 design.md 的三岔。
      **同标签页那条分支的代码路径要保持原样**，新逻辑只加在"新标签页"这一支。
- [ ] 接 `seatOffer`：`gone` 不提示、`busy` 显示占用中并自动重试、`ok` 摆出两个按钮。
- [ ] `Splash.tsx`：在现有 `resume` 支线上加选择态。两个按钮必须落进它已有的
      Tab 圈闭里（`Splash.tsx:155-172`），不要另起遮罩。
- [ ] 「找回」走现有认领路径；「放弃」= 认领 → `leaveRoom` → 清凭证 → 落首页。
- [ ] `busy` 窗口里选「放弃」退化为纯本地放弃（`prd.md` R7），不要为它加协议。

验证：`pnpm --filter @scg/web typecheck && pnpm --filter @scg/web test`

## 步骤 6 — 全量校验

- [ ] `pnpm -r typecheck`
- [ ] `pnpm -r test`
- [ ] 手动走查（见下）

### 手动走查清单

1. A 对局中**关标签页** → 新标签页开链接 → 看到「找回对局 / 放弃重连」。
2. 选「找回」→ 回到牌面，记忆倒计时/回合截止与断线前一致；B 侧红色横幅消失。
3. 重来，选「放弃」→ B 侧出现「已退出房间」横幅并 10s 后落 Room 屏；
   A 落首页；A 再开标签页**不再提示**。
4. 等满 60s 之后再开链接 → **不提示**，与首次访问一致。
5. **同标签页刷新（F5）** → 静默自动恢复，不弹选择框（回归）。
6. 两个标签页同时开着：第二个不应提示找回，第一个不掉线（防抢座）。
7. 主动退出（不是掉线）后新开标签页 → 不提示找回。

## 复查门（提交前）

- [ ] `reattach()` / `detach()` / `releaseSeatPointers()` / `forfeitIfAbandoned()` 的 diff 为空。
- [ ] `ws.ts` 的 diff 只含凭证读写，不含连接/同步/心跳。
- [ ] `audio.ts`、`api.ts`、`features/*` 的 diff 为空。
- [ ] 既有「半开连接」两条用例仍绿。
- [ ] `hello` 不带 `claim` 时的服务端行为与 HEAD 逐字一致。

## 回滚点

步骤 1–3（协议 + 服务端 + 测试）是一个独立提交点，此时前端尚未改动，
线上行为完全不变 —— 这是一个安全的中途停靠站。步骤 4–5 是第二个提交点。
整体回滚 = 还原 6 个文件的 diff。无持久化、无迁移、无部署侧配置。
