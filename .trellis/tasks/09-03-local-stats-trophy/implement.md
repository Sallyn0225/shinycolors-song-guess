# 执行计划｜本地战绩统计与奖杯面板

自底向上：基线 → 纯数据 → 纯逻辑（测试先绿）→ 存储 → 接线 → 屏 → 打磨 → 验收。
**在纯逻辑那一层的测试变绿之前，不许开始画屏。** 这一屏的价值全在数字对不对，
先画图后补逻辑会让「数字看起来合理」冒充「数字是对的」。

---

## 阶段 0｜基线

- [x] `pnpm -r typecheck && pnpm -r lint && pnpm -r test`，记录 `@scg/web` 的用例数（spec 说 21，以实际为准）。
- [x] 读一遍 `.trellis/spec/web/frontend/index.md` 的「The one rule that overrides taste」——
      确认本任务只**新增** `features/` 文件，不改既有的。

---

## 阶段 1｜`features/units.ts`（纯数据）

- [x] 从 `assets/manifest.public.json` 取 `kind !== 'shuffle'` 的 9 条，写成 `COUNTED_UNITS`。
      注释按 design §5 写全，含重新求值的 `node -e` 命令与「为什么 shuffle / null 不在这里」。
- [x] `isCountedUnit()` / `unitName()` / `unitColor()`。
- [x] `features/units.test.ts`：9 个 id 在 manifest 里都存在且 `kind !== 'shuffle'`；
      manifest 里所有 `kind !== 'shuffle'` 的 unit 都在表里（**双向**，漏掉哪边都会静默少统计一个组合）。
      读 manifest 的写法照抄 `features/opening.test.ts`。

**验证**：`pnpm --filter @scg/web test -- units`

---

## 阶段 2｜`features/records.ts`（纯逻辑，测试先行）

- [x] 先写 `features/records.test.ts` 的九条用例骨架（design §10 的表格），全部 `expect` 写死预期。
- [x] 再写类型、常量、`emptyRecords()`、`record()`、`modeView()` / `unitRanking()` / `weakestSongs()`。
- [x] 两个口径的注释各写一句（design §3）：模式总正确率含未作答题、组合/单曲榜不含。
      **这两句注释是本任务最重要的两行文字**，下一个人一定会想统一它们。
- [x] 首局 `worstScore` 的处理方式定死并测到。

**验证**：`pnpm --filter @scg/web test -- records`（九条全绿）+ `typecheck`

---

## 阶段 3｜`records.ts`（存储门面）

- [x] `loadRecords()` / `saveRecords()` / `recordSolo(sessionId, summary)` / `clearRecords()`。
- [x] 每个出入口包 `try/catch`，回落链按 design §9。**照着 `prefs.ts` 写**，
      连注释的口吻一起——那份文件已经把「为什么必须 try/catch」讲清楚了，别再讲一遍新的。
- [x] 版本不认识 → 回落到空，不迁移。

**验证**：`typecheck`；浏览器控制台手工塞坏数据验一次回落（AC8 的预演）

---

## 阶段 4｜接线（四处小改动）

- [x] `ui/Icon.tsx`：新增 `trophy` 的 24 网格描边路径，`StrokeIconName` 加名字。
      **自己画**，不许从图标库粘（`ui/IconButton.tsx` 顶部的硬约束）。
- [x] `App.tsx`：`Screen` 联合加 `{ name: 'records' }`（`App.tsx:18-24`）；`case 'records'` 渲染；
      `App.tsx:223` 的 `const bgm = video || screen.name === 'result'` 补上 `|| screen.name === 'records'`。
      **`video` 那一侧一行不改**——奖杯屏不要背景视频。
- [x] `screens/Start.tsx`：`ToolRail` 里加奖杯 `IconButton`（在 GitHub 之前），
      `Props` 加 `onRecords`。
- [x] `screens/Result.tsx`：`api.result(...).then` 里补一行 `recordSolo(sessionId, d)`。
      **除此之外结算页一行不改。**

**验证**：`pnpm --filter @scg/web typecheck && lint`；跑起来点一遍，
奖杯屏此刻可以只是一块占位。

**前置已就绪**：`09-03-result-bgm-continuity` 已完成并归档，
BGM 与视频的判断已经是两个独立表达式，本阶段只改 `bgm` 那一行。

---

## 阶段 5｜`screens/Records.tsx`

按 design §8 的四块，从上到下逐块做，每做完一块跑一次页面：

- [x] 骨架：`main` + `HeroTitle`/`SectionTitle` + 返回入口 + 简单/困难分段切换
      （tab 语义，键盘可达）。
- [x] 数字块（`ui/Stat` × 4）。
- [x] 走势带（复用结算页折痕带的语汇，`flex-nowrap`）。
- [x] 组合榜（横条 + 组合代表色 + 描边；最高/最低的标记不靠颜色）。
- [x] 易错榜（复用结算页列表行 + `/thumb/<id>.webp`）。
- [x] 三级空态（design §8 末）。
- [x] 「清除本地战绩」+ 二次确认（可复用 `ui/Overlay`）。

**验证**：每块都给 `role="img"` + `aria-label` 或等价文本；`lint` 保持绿。

---

## 阶段 6｜视觉打磨

- [ ] 调用 `/impeccable` 做一轮：层级、留白、空态、动效、窄屏。
      **约束写进提示词**：必须使用 `index.css` 既有 token 与 `.cut-*` 形状原语，
      不许引入新调色板 / 圆角 / 字体尺度；组合色只作图形不作文字。
- [ ] 图表口径可参考 dataviz 的规范（对比度、标签、不用颜色单独编码信息），
      但配色取站内 token。
- [ ] 复核：这一屏放到首页旁边，看起来是同一个 app 吗？

---

## 阶段 7｜验收

- [ ] PRD 的 AC1–AC13 逐条走。
- [ ] **AC10 的六档视口必须真量**：1366×678 / 1440×810 / 1536×774 / 1920×990 / 390×844 / 375×667，
      记录首页 `document.scrollHeight` 与 `innerHeight`，与 `screens/Start.tsx` 注释里那张表对照；
      确认 `ToolRail` 五枚按钮在 375 宽下不换行。
- [ ] AC9 用无痕窗口验一次。
- [x] `pnpm -r typecheck && pnpm -r lint && pnpm -r test` 全绿，web 用例数 = 阶段 0 + 新增。

---

## 阶段 8｜spec 更新

- [x] `.trellis/spec/web/frontend/index.md`：目录清单里补 `records.ts`、`features/records.ts`、
      `features/units.ts`、`screens/Records.tsx`。现有 7 个屏
      （Splash / Start / Play / Result / Lobby / Room / Karuta），`Records` 是**第八个**，
      与它们同为互斥屏。
- [x] `.trellis/spec/web/frontend/state-management.md`：补一条「本地统计的真相在 localStorage，
      屏挂载时读一次进 state，写只发生在结算页」的口径。
- [x] 若 `PROGRESS.md` 有功能清单，同步一行。

---

## 回滚点

- 阶段 2 结束：纯逻辑 + 测试，可独立提交（没有任何调用点，零风险）。
- 阶段 4 结束：功能可见但屏是占位，仍可独立提交。
- 阶段 5 结束：完整功能。
- 建议按这三段分三个提交。
