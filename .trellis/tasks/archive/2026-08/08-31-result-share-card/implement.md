# Implement — 结算页导出战报图片

顺序是「纯逻辑 → 画笔 → 对话框 → 接入」。前两步做完就能在测试里验证排版，
不必等 UI 拼好才发现文字溢出。

## 步骤

### S1 段位体系 `features/grade.ts`

- [ ] 定义 `Tier { id, title, blurb, emote, }`，导出 `SOLO_TIERS` / `VERSUS_TIERS`（design §4.1 / §4.2）
- [ ] `soloTier(score, maxScore): Tier` —— `maxScore <= 0` 时按 `r = 0`
- [ ] `versusTier({ outcome, otetsuki, margin }): Tier`
- [ ] `emoteAssetUrl(emoteId)` → `/emote/<id>.webp`
- [ ] `emotePlaceholderSvg(emoteId)` → `data:image/svg+xml,...`，六个简笔表情
- [ ] `features/grade.test.ts`：每段的**上下边界值**各一条（0.95 / 0.9499… / 0.85 …），
      `maxScore = 0`，联机七条规则各一条，以及规则优先级（胜+零误札+大比分只能是 `perfect`）

### S2 显示列表 `features/shareCard.ts`

- [ ] `DrawOp` 联合类型（design §2）
- [ ] `SoloReportInput` / `VersusReportInput` —— 自己声明，结构兼容 `Summary` / `MatchStats`，
      **不 import `api.ts`**
- [ ] 票根骨架 `pushFrame(ops, ctx)`：纸底、双线边框、齿孔虚线与圆孔、存根竖排标题、日期、底栏
- [ ] `buildSoloTicket(input, measure): DrawOp[]`（design §6.1）
- [ ] `buildVersusTicket(input, measure): DrawOp[]`（design §6.2）
- [ ] `barcodeSeed(parts: string[]): number` —— 稳定 hash
- [ ] `truncate(text, maxWidth, font, measure)` —— 超宽换省略号
- [ ] `features/shareCard.test.ts`：
      - 曲目 12 首时只产出 5 条曲目 + 一条「他 7 曲」
      - 超长曲名在给定假量测下的截断位置
      - 联机票里**不存在** `tick` 与曲目 `image` op
      - 同一输入两次 `barcodeSeed` 相同、换 ID 后不同
      - 逐题三态各自映射到 `tick.state` 的 `ok/miss/skip`

### S3 画笔 `ui/ticketPainter.ts`

- [ ] `paintTicket(ctx, ops, images)` —— 逐 op 分派，无任何游戏判断
- [ ] 字距：`tracking` 时逐字绘制并按 `measureText` 累加推进
- [ ] `vtext`：逐字居中、按 `step` 递增 y
- [ ] `stamp`：双环 + 环形排布小字 + 中央字，旋转，`multiply`
- [ ] `barcode`：由 seed 起的线性同余序列生成条宽
- [ ] `paper`：噪点 `ImageData` **模块级缓存**，按尺寸只生成一次（design §3.2）
- [ ] 错版重影：粉色 op 偏移再画一层低 alpha
- [ ] `ensureFonts()`（design §5.1）与 `loadImages(srcs)`（失败记 null，不抛）

### S4 对话框 `ui/ShareDialog.tsx`

- [ ] props：`ops` 构建函数、预填 ID、标题
- [ ] ID `<Field>`：`maxLength=16`、trim、留空时图上走占位文案
- [ ] `localStorage` 读写（key 定为 `scg.shareId`）
- [ ] 挂载时 `ensureFonts` + `loadImages`，就绪后首绘；改 ID 只重跑 build + paint
- [ ] canvas 等比缩放预览
- [ ] 下载：`toBlob` → `navigator.canShare({files})` 则 `share`，否则 `a[download]`
- [ ] 文件名：`战报-<sanitized id>-<YYYYMMDD-HHmm>.png`
- [ ] 失败时可见提示，且预览图保留供长按保存（R5.5）
- [ ] 复用现有 `Overlay` 的焦点管理与 Esc 关闭；不要另写一套

### S5 网页段位展示 `ui/GradeBadge.tsx`

- [ ] 表情 `<img>`，`onError` 切到占位 SVG data URI
- [ ] 称号 + 评价排版，跟随现有 `sc-*` 字号与 `jp-wrap`

### S6 接入 `screens/Result.tsx`

- [ ] 删除 `verdictLine()`，原位置换成 `<GradeBadge tier={soloTier(data.score, data.maxScore)} />`
- [ ] 底部按钮区加「导出战报」，沿用 §窄屏两个按钮各占半行的既有处理（该处注释解释了为什么）
- [ ] `Summary` 直接传给 `buildSoloTicket`

### S7 接入 `screens/Karuta.tsx`

- [ ] 胜负字样下加 `<GradeBadge tier={versusTier(...)} />`
- [ ] 按钮区加「导出战报」，**不发任何 socket 消息**
- [ ] 预填 ID：`localStorage` 优先，空则用 `match.players[me].nickname`
- [ ] 组装 `VersusReportInput`（含 `clamped`，供 R4.5）

### S8 占位资源与收尾

- [ ] `apps/web/public/emote/` 留 `.gitkeep` 与一行说明，讲清放什么、叫什么名字
- [ ] 检查生成图无版权字样（R6.5）

## 验证

```bash
pnpm -r typecheck
pnpm -r test
pnpm --filter @scg/web dev     # 人工过一遍两条路径
```

人工验收对着 `prd.md` 的 Acceptance Criteria 逐条走，重点是这几条**不会被单测覆盖**的：

1. 字体没加载完就点导出 —— 用 DevTools 把网络限速到 Slow 3G 复现
2. 封面出现在图里且 `toBlob` 不抛 `SecurityError`
3. `/emote/*.webp` 404 时网页与战报都正常
4. 联机开关一次导出框后再战投票状态不变
5. 窄屏（375）按钮区不换行破版 —— 这条现有代码栽过，注释在 `Result.tsx:205`

## 回滚点

- S1–S3 全是新增文件，可独立留下
- S6 的 `verdictLine` 替换是唯一行为变更，单独一个 commit，便于只回退它
