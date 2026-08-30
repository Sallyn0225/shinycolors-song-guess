# 执行计划

comp-led 构建。**批准的 comp 是 `.impeccable/mocks/decision/running-light.png`，comp 即法。**
Impeccable 的构建纪律：先复现（phase 1），复现站住了才做动效与响应式（phase 2）。

## 阶段 0 · 起点保护

- [ ] `git status` 干净后再动手（当前已干净）
- [ ] 记下保留层基线：`git rev-parse HEAD`，收尾时用它验证保留层零改动

## 阶段 1 · 地基（token 与原语）

顺序有依赖，逐条做完再往下。

1. [ ] `apps/web/index.html`
   - `<body>` 首个子节点写入方向契约 HTML 注释（含 seed key `dfab6df5`）
   - 换字体 `<link>`：`Noto Sans JP` (400/600/700) + `Jost` (400/600/700)，带 `preconnect`
2. [ ] `src/index.css` 全量重写
   - `--u` 钳制单位与 767px 断点
   - `@theme`：`--spacing` 接 `--u`、字号阶、色彩、字体、字距
   - `:root`：渐变、紫调 drop-shadow、缓动、`--cut-sm/lg`
   - 形状原语 `.cut-slant / .cut-card / .cut-hex / .cut-bar` + `.cut-shadow`
   - 焦点环上提 `:has(:focus-visible)`
   - `@keyframes sc-appear / sc-shudder / sc-halo` + reduced-motion 收口
   - base：`body` 明底、`::selection`、`palt`、`jp-wrap`
3. [ ] `src/ui/Backdrop.tsx` —— 三层程序化背景
4. [ ] `src/ui/Cut.tsx`、`Button.tsx`、`Field.tsx`、`SectionTitle.tsx`、`Stat.tsx`、`Overlay.tsx`
5. [ ] **门禁**：起 dev server，做一个临时的原语陈列页，肉眼确认
   斜切、紫阴影没被裁、焦点环可见、背景虹彩出得来。过不了不往下走。

## 阶段 2 · 签名组件

6. [ ] `src/ui/PrismRail.tsx`
   - 单 rAF 循环：`clipPath` 收缩 + canvas 频谱 + 秒数 `textContent`
   - `mode: 'top' | 'mirror' | 'idle'`，`creases` 折痕
   - **自检**：无 `setState` 于 rAF 内；`clipPath` 无 `transition`；窄屏不换行
7. [ ] 删除 `src/components/Stage.tsx`

## 阶段 3 · 复现 comp（phase 1，最高优先）

8. [ ] `src/components/OptionBar.tsx`
9. [ ] `src/screens/Play.tsx` —— 严格照 comp 复现
10. [ ] **门禁（Impeccable hero 检查点）**：dev server 跑 Play 的 answering 态，
    在 comp 自身像素尺寸（1536×1024）截图，存 `.impeccable/review/hero-repro.png`，
    与 comp 并排对比。结构、密度、比例不符就回到第 9 步重做，**不往下建其他屏**。

## 阶段 4 · 其余界面

11. [ ] `src/screens/Start.tsx`
12. [ ] `src/screens/Result.tsx`
13. [ ] `src/screens/Lobby.tsx`
14. [ ] `src/components/KarutaTile.tsx` + `src/components/Toast.tsx`
15. [ ] `src/screens/Karuta.tsx` —— 六阶段 + 三遮罩 + 结算表；
    `PrismRail mode="mirror"` 作两阵界线；两块整片色场
16. [ ] `src/App.tsx` —— 壳、路由、恢复态、座位丢失
17. [ ] 删除 `src/components/OptionCard.tsx`、`src/components/KarutaCard.tsx`

## 阶段 5 · 验证

18. [ ] `pnpm --filter @scg/web typecheck`
19. [ ] `pnpm --filter @scg/web test`（既有 21 个测试不改一行）
20. [ ] `pnpm --filter @scg/web build`
21. [ ] `git diff --exit-code -- src/api.ts src/audio.ts src/net src/features`
    （在 `apps/web` 下跑，必须为空）
22. [ ] `grep dfab6df5 apps/web/dist/index.html`
23. [ ] 无障碍手测：
    - 只用键盘走完单机一局（`1`–`4` / `R` / `Enter`）
    - DevTools 开 `prefers-reduced-motion: reduce`，确认动画停但计时收缩仍在
    - Tab 遍历，焦点环处处可见且未被裁
    - 取色器抽查正文与状态色对比度
24. [ ] 功能手测（服务端需先起）：单机一局到结算；1v1 建房 + 加入 + 记忆 + 抢牌 +
    送り札 + 结算 + 再战；刷新页面确认手势遮罩；断网 10 秒确认断线遮罩与重连

## 阶段 6 · Impeccable 收尾（不可省）

25. [ ] 批量截图一轮：desktop（1536×1024）+ mobile（390×844），存 `.impeccable/review/`
    - 截图前先settle入场动画，逐张打开确认没有空白/半加载
26. [ ] `node .claude/skills/impeccable/scripts/detect.mjs --json <改动的文件>`，机械项当场修
27. [ ] 派 `impeccable-finish-reviewer`（干净上下文，不继承本线程），
    输入包：原始请求、确认过的回答、artifact 路径、截图路径、方向契约、
    detect 剩余项、批准的 comp 路径、craft-floor 参考路径
28. [ ] 按 disposition 处置：`ship` → 下一步；`fix` → 一批修完重截图送回评分；
    `rebuild` → 立即重做被点名的区域再走完整复审；`recapture` → 重截
29. [ ] 派 `impeccable-documenter` 生成 `DESIGN.md`（从**建成的**世界写，不是从计划写）

## 阶段 7 · Trellis 收尾

30. [ ] 更新 `.trellis/spec/web/frontend/` 里学到的可复用约定
    （clip-path 的阴影/焦点环两坑、`--u` 体系、rAF 直写规则）
31. [ ] `PROGRESS.md` 的「前端」小节按新实现更新
32. [ ] 提交

## 回滚点

- 阶段 1~2 之间、阶段 3 门禁之后、阶段 4 结束后各留一个 commit（或 stash 标记）。
- 任何一步发现需要改保留层：**停下**，把理由写进 `prd.md` 的 Constraints，回到规划。
- comp 复现在阶段 3 门禁连续两次不过：停下来找用户，不要自行降级 comp 的权威。

## 验证命令速查

```bash
pnpm --filter @scg/web typecheck
pnpm --filter @scg/web test
pnpm --filter @scg/web build
pnpm --filter @scg/web dev            # :5173
pnpm --filter @scg/server start       # :5179，功能手测要它
```
