# 执行计划

comp-led 构建。**批准的 comp 是 `.impeccable/mocks/decision/running-light.png`，comp 即法。**
Impeccable 的构建纪律：先复现（phase 1），复现站住了才做动效与响应式（phase 2）。

## 阶段 0 · 起点保护

- [x] `git status` 干净后再动手（当前已干净）
- [x] 记下保留层基线：`git rev-parse HEAD`，收尾时用它验证保留层零改动

## 阶段 1 · 地基（token 与原语）

顺序有依赖，逐条做完再往下。

1. [x] `apps/web/index.html`
   - `<body>` 首个子节点写入方向契约 HTML 注释（含 seed key `dfab6df5`）
   - 换字体 `<link>`：`Noto Sans JP` (400/600/700) + `Jost` (400/600/700)，带 `preconnect`
2. [x] `src/index.css` 全量重写
   - `--u` 钳制单位与 767px 断点
   - `@theme`：`--spacing` 接 `--u`、字号阶、色彩、字体、字距
   - `:root`：渐变、紫调 drop-shadow、缓动、`--cut-sm/lg`
   - 形状原语 `.cut-slant / .cut-card / .cut-hex / .cut-bar` + `.cut-shadow`
   - 焦点环上提 `:has(:focus-visible)`
   - `@keyframes sc-appear / sc-shudder / sc-halo` + reduced-motion 收口
   - base：`body` 明底、`::selection`、`palt`、`jp-wrap`
3. [x] `src/ui/Backdrop.tsx` —— 三层程序化背景
4. [x] `src/ui/Cut.tsx`、`Button.tsx`、`Field.tsx`、`SectionTitle.tsx`、`Stat.tsx`、`Overlay.tsx`
5. [x] **门禁**：起 dev server，做一个临时的原语陈列页，肉眼确认
   斜切、紫阴影没被裁、焦点环可见、背景虹彩出得来。过不了不往下走。

## 阶段 2 · 签名组件

6. [x] `src/ui/PrismRail.tsx`
   - 单 rAF 循环：`clipPath` 收缩 + canvas 频谱 + 秒数 `textContent`
   - `mode: 'top' | 'mirror' | 'idle'`，`creases` 折痕
   - **自检**：无 `setState` 于 rAF 内；`clipPath` 无 `transition`；窄屏不换行
7. [x] 删除 `src/components/Stage.tsx`

## 阶段 3 · 复现 comp（phase 1，最高优先）

8. [x] `src/components/OptionBar.tsx`
9. [x] `src/screens/Play.tsx` —— 严格照 comp 复现
10. [x] **门禁（Impeccable hero 检查点）**：dev server 跑 Play 的 answering 态，
    在 comp 自身像素尺寸（1536×1024）截图，存 `.impeccable/review/hero-repro.png`，
    与 comp 并排对比。结构、密度、比例不符就回到第 9 步重做，**不往下建其他屏**。

## 阶段 4 · 其余界面

11. [x] `src/screens/Start.tsx`
12. [x] `src/screens/Result.tsx`
13. [x] `src/screens/Lobby.tsx`
14. [x] `src/components/KarutaTile.tsx` + `src/components/Toast.tsx`
15. [x] `src/screens/Karuta.tsx` —— 六阶段 + 三遮罩 + 结算表；
    `PrismRail mode="mirror"` 作两阵界线；两块整片色场
16. [x] `src/App.tsx` —— 壳、路由、恢复态、座位丢失
17. [x] 删除 `src/components/OptionCard.tsx`、`src/components/KarutaCard.tsx`

## 阶段 5 · 验证

18. [x] `pnpm --filter @scg/web typecheck`
19. [x] `pnpm --filter @scg/web test`（既有 21 个测试不改一行）
20. [x] `pnpm --filter @scg/web build`
21. [x] `git diff --exit-code -- src/api.ts src/audio.ts src/net src/features`
    （在 `apps/web` 下跑，必须为空）
22. [x] `grep dfab6df5 apps/web/dist/index.html`
23. [x] 无障碍手测：
    - [~] 只用键盘走完单机一局（`1`–`4` / `R` / `Enter`）
      —— 处理器已静态核对（`Play.tsx:185-194`），未做人工整局走查
    - [x] `prefers-reduced-motion: reduce` 下动画停但计时收缩仍在
      —— `index.css:517` 只关三条 `@keyframes` 与 transition；PrismRail 零 `useState`、
      rAF 直写 `clip-path` 且无 transition，故收缩不受影响
    - [x] Tab 遍历，焦点环处处可见且未被裁
      —— probe 实测：被裁元素自身 `outline: none`，环由包装层承担 `solid 2px rgb(0,119,168)`
    - [x] 正文与状态色对比度 —— `px-contrast.mjs` DPR4 实测，最低 4.85:1（「空札」）
24. [x] 功能手测（服务端需先起）：单机一局到结算；1v1 建房 + 加入 + 记忆 + 抢牌 +
    送り札 + 结算 + 再战；刷新页面确认手势遮罩；断网 10 秒确认断线遮罩与重连
    —— 1v1 全链路由 `probe.mjs` 双 page 实打，桌面与 390x844 各一遍；
    单机结算、手势遮罩、断线遮罩在 2026-08-30 复审轮已覆盖

## 阶段 6 · Impeccable 收尾（不可省）

25. [x] 批量截图一轮：desktop（1536×1024）+ mobile（390×844），存 `.impeccable/review/`
    - 截图前先settle入场动画，逐张打开确认没有空白/半加载
26. [x] `node .claude/skills/impeccable/scripts/detect.mjs --json <改动的文件>`，机械项当场修
27. [x] 派 `impeccable-finish-reviewer`（干净上下文，不继承本线程），
    输入包：原始请求、确认过的回答、artifact 路径、截图路径、方向契约、
    detect 剩余项、批准的 comp 路径、craft-floor 参考路径
28. [x] 按 disposition 处置：`ship` → 下一步；`fix` → 一批修完重截图送回评分；
    `rebuild` → 立即重做被点名的区域再走完整复审；`recapture` → 重截
29. [x] 派 `impeccable-documenter` 生成 `DESIGN.md`（从**建成的**世界写，不是从计划写）

## 阶段 7 · Trellis 收尾

30. [x] 更新 `.trellis/spec/web/frontend/` 里学到的可复用约定
    （clip-path 的阴影/焦点环两坑、`--u` 体系、rAF 直写规则）
31. [x] `PROGRESS.md` 的「前端」小节按新实现更新
32. [x] 提交

## 回滚点

- 阶段 1~2 之间、阶段 3 门禁之后、阶段 4 结束后各留一个 commit（或 stash 标记）。
- 任何一步发现需要改保留层：**停下**，把理由写进 `prd.md` 的 Constraints，回到规划。
- comp 复现在阶段 3 门禁连续两次不过：停下来找用户，不要自行降级 comp 的权威。

## 复验记录 · 2026-08-30 收尾轮

在干净工作区（HEAD `6139758`）上重跑，全部通过：

| 项 | 结果 |
|---|---|
| typecheck | 干净 |
| test | 21/21 |
| build | 成功，`dist/index.html` 3.11 kB，seed `dfab6df5` 在 |
| 保留层 diff（自 `6650bfe~1`） | 空 |
| `detect.mjs --json`（8 个改动文件） | `[]` |
| `probe.mjs` 桌面 1536x1024 | 六屏无结构问题；光带偏离中线 0；自陣越过折线 0；`doc == vp == 1024` |
| `probe.mjs` 移动 390x844 | 六屏无结构问题；无横向溢出；曲名被裁 0；牌 109x64（≥44）|
| `px-contrast.mjs` DPR4 | 全部 ≥ 4.5:1，最低 4.85:1 |
| `border-radius` / 黑色 `box-shadow` | 全站零 radius；`box-shadow` 仅 Field 的 inset 描边，取自 `--color-primary`（靛紫），非黑 |

**已知并接受**：390x844 上牌场纵向 `doc` 超出 `vp` 21px（记忆）/ 53px（听取），
自陣末行需下滑约 36px 才完整可见。原因是 12+12 张牌各占 333px、场区最小 141~173px，
在 844 高度内无法同时容纳而不压缩牌高（现 64px，压缩会挤掉 3 行曲名）。
折线以下的牌为 0——这与上一轮修掉的「12 张全部掉到折线以下」是两回事。
要消除这段滚动只能改牌面密度，属于设计取舍，未自行改动。

## 验证命令速查

```bash
pnpm --filter @scg/web typecheck
pnpm --filter @scg/web test
pnpm --filter @scg/web build
pnpm --filter @scg/web dev            # :5173
pnpm --filter @scg/server start       # :5179，功能手测要它
```
