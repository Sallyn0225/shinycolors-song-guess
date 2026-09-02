# 执行计划｜公开/私人房上限配置与大厅房间数展示

自底向上：基线 → 配置 → 协议 → Hub → 测试 → 前端 → 文档 → spec。
每个阶段结束都有可运行的验证，前一阶段不绿不进下一阶段。

---

## 阶段 0｜基线

- [ ] `pnpm -r typecheck && pnpm -r lint && pnpm -r test`，**记录 server 的用例数**
      （spec 记的是 72，以实际输出为准）。在改任何代码之前跑 —— 否则后面分不清
      是新代码坏了还是本来就红。

---

## 阶段 1｜配置层（`apps/server/src/config.ts`）

- [ ] 把 `MAX_ROOMS` 的读取提到 `SERVER_CONFIG` 之前，成为一个模块级 const，
      注释写明「分类上限要跟随它的实际取值，不是字面量 200」。
- [ ] `RoomQuotas` 增 `publicMax` / `privateMax` / `allowPrivate` 三个字段，各带注释。
- [ ] `SERVER_CONFIG.rooms` 增三项：`count('MAX_PUBLIC_ROOMS', MAX_ROOMS)` /
      `count('MAX_PRIVATE_ROOMS', MAX_ROOMS)` / `bool('ALLOW_PRIVATE_ROOMS', true)`。
      **必须用 `count` 不是 `num`** —— 分类上限要能设成 0。

**验证**：`pnpm --filter @scg/server typecheck`

---

## 阶段 2｜协议（`packages/shared`）

- [ ] `protocol.ts` 新增 `LobbyLimits` 接口（含 §2 的注释：这些数只是 UX 输入）。
- [ ] `roomList` 消息增 `privateTotal: number` 与 `limits: LobbyLimits`，
      并**改写它上方那段注释**里「私人房间不计入两个总数」的表述 ——
      注释是这份契约的正文，留着旧话比不写更坏。
- [ ] 同步 `RoomSummary` 上方注释里那句「也不计入 `roomList` 的两个总数」。
- [ ] 从 `index.ts` 导出 `LobbyLimits`（确认 `packages/shared/src/index.ts` 的导出方式）。
- [ ] **不新增** `publicTotal`：`waitingTotal + busyTotal` 已是它。

**验证**：`pnpm --filter @scg/shared typecheck && pnpm --filter @scg/shared test`

---

## 阶段 3｜Hub 准入与列表（`apps/server/src/ws/hub.ts`）

- [ ] 新增 `counts()`、`privateAllowed` getter、`lobbyLimits()`（见 design §3）。
- [ ] `buildList()` 返回值加 `privateTotal` 与 `limits`。
- [ ] `createRoom` 分支按 design §3 的六步顺序插入第 3、4 步：
      - 私人房未开放 → `{ code: 'bad_state', message: '本站未开放私人房间' }`
      - 公开房已满 → `{ code: 'server_busy', message: '公开房间已满，可以创建私人房间' }`
        （私人房也关着时不要许这句，文案要分支）
      - 私人房已满 → `{ code: 'server_busy', message: '私人房间已满，稍后再试' }`
- [ ] **不动**第 2 步的总闸判断与第 5、6 步的按 IP 配额，顺序不变。

**审查点**：`allowPrivate` 放进 `RoomQuotas`（一个叫「配额」的类型）是否合适。
备选是单独放 `SERVER_CONFIG.rooms.allowPrivate` 之外的顶层字段，代价是 Hub 要读两个
配置源、测试要多一条注入路径。若 check 认为不妥再改，不要在实现中途摇摆。

**验证**：`pnpm --filter @scg/server typecheck`

---

## 阶段 4｜服务端测试（`apps/server/src/ws/lobby.test.ts`）

照现有 `makeApp({ rooms })` 的写法加一组用例：

- [ ] `MAX_PUBLIC_ROOMS=1`：建第 2 个公开房被拒（`server_busy`），同一时刻私人房仍能建。
- [ ] `MAX_PRIVATE_ROOMS=1`：建第 2 个私人房被拒，同一时刻公开房仍能建。
- [ ] `allowPrivate: false`：`visibility:'private'` 被拒且 `code === 'bad_state'`；
      公开房不受影响。
- [ ] `privateMax: 0`：与上一条同样的拒绝路径（两条配置路合并的证据）。
- [ ] `max: 0`（既有用例）仍返回 `server_busy` 且**不是**分类满的文案 —— 顺序的回归锁。
- [ ] `roomList` 断言：建 1 公开 + 1 私人后，`rooms.length === 1`、
      `waitingTotal === 1`、`privateTotal === 1`、`limits` 三字段正确。
- [ ] **保密回归**：把收到的 `roomList` 原始 JSON 字符串断言**不包含**私人房的 code 与 name。
      这条比逐字段断言强 —— 将来有人新加字段泄露了也会被它抓到。
- [ ] `lobbyLimits` 的 `min` 行为：`max: 2, publicMax: 10` 时下发的 `publicMax === 2`。

**验证**：`pnpm --filter @scg/server test`

---

## 阶段 5｜前端（`apps/web/src/screens/Lobby.tsx`）

- [ ] 新增 `privateTotal` / `limits` 两个 state，在 `roomList` 分支里赋值。
- [ ] 计数行改成两行（见 design §4）：上行公开/私人占用，下行保留「等人 · 进行中」。
      `limits === null` 时只渲染下行 —— 首帧不要闪一个假分母。
- [ ] 私人房关闭时上行显示 `私人 已关闭`。
- [ ] 更新 `sr-only` 的 `role="status"` 摘要文案，带上上限。
      **不要**把计数行本身变成 live region（见文件里那段注释的理由）。
- [ ] `VisibilityChoice` 增 `allowPrivate` prop：私人项 `disabled`、
      hint 换成「本站已关闭私人房间」、去掉 `cursor-pointer`、降不透明度。
- [ ] `CreateDialog` 透传 `allowPrivate`；`create()` 与 `checked` 都用
      `effectiveVisibility`，不要新增第二个 state 去镜像它。
- [ ] 样式沿用文件内既有的 `cut-ring` / CSS 变量写法，**不引入新的颜色字面量**。

**验证**：`pnpm --filter @scg/web typecheck && pnpm --filter @scg/web lint`

**人工确认**（`pnpm dev`）：
- 默认配置：计数行显示 `公开 0/200 · 私人 0/200`，私人选项可选。
- `ALLOW_PRIVATE_ROOMS=0` 重启：私人项置灰、有说明，建公开房正常。
- 建一个私人房后回大厅（另一个标签页）：私人计数 +1，列表里看不到它。

---

## 阶段 6｜文档

- [ ] `DEPLOY.md` 环境变量表增三行；「房间配额」一节补一段
      **建议 `MAX_ROOMS >= MAX_PUBLIC_ROOMS + MAX_PRIVATE_ROOMS`** 的说明与不满足时的表现。
- [ ] `.env.example` 增三段注释掉的变量，风格照既有条目（先说用途，再说副作用）。
- [ ] `PROGRESS.md` 若列了配额旋钮清单，同步；没列就不动。

---

## 阶段 7｜spec 更新（3.3）

- [ ] `.trellis/spec/shared/backend/protocol-and-contracts.md`：修订「私人房间不计入
      roomList 总数」的契约表述为「不下发任何可定位字段，只下发聚合数量」。
- [ ] `.trellis/spec/server/backend/index.md`：`config.ts` 旋钮清单补三项。
- [ ] `.trellis/spec/server/backend/secrecy-and-anticheat.md`：如有复述，同步收窄。
- [ ] `.trellis/spec/shared/backend/tuning-constants.md`：如列了 `MAX_ROOMS`，补分类上限
      与「默认跟随总闸」这条规则。

---

## 全量验证（收尾）

- [ ] `pnpm -r typecheck && pnpm -r lint && pnpm -r test`
- [ ] server 用例数 > 阶段 0 记录的基线。
- [ ] 逐条对照 `prd.md` 的 Acceptance Criteria 打勾。

---

## 回滚点

| 做完哪个阶段出事 | 怎么退 |
|---|---|
| 阶段 1–2 | 纯加法，`git checkout` 两个文件即可 |
| 阶段 3–4 | 撤销 `hub.ts` 的三个新方法与两条分支，`buildList` 去掉两字段 |
| 阶段 5 | 前端是纯展示，单独回退不影响联机 |
| 已上线 | 不用改镜像：从 `.env` 删掉三个新变量即回到今天的行为 |
