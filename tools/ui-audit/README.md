# ui-audit

前端取证脚本。**不是测试**，也不进 CI —— 它们回答的是「这一版在真浏览器里，量出来是多少」，
用来给复审提供数字而不是印象。

不是 workspace 包（没有 `package.json`），依赖也不进任何 workspace，
因为它们和产物无关，装进去只会让每个人的 `pnpm install` 多拉一个浏览器。

## 装依赖

```bash
# puppeteer 在 Windows 上会优先用系统安装的 Chrome，可以跳过自带浏览器的下载
PUPPETEER_SKIP_DOWNLOAD=true npm install --prefix tools/ui-audit puppeteer pngjs
```

已经装过 Impeccable skill 的机器上，`deps.mjs` 会自动用它自带的那份，这一步可以跳过。

## 用

三个脚本都要求 dev server 已经起着：

```bash
pnpm --filter @scg/server dev
pnpm --filter @scg/web dev
```

### `probe.mjs` — 两个 page 真打一局 1v1

```bash
node tools/ui-audit/probe.mjs                              # 1536x1024
node tools/ui-audit/probe.mjs --mobile                     # 390x844
node tools/ui-audit/probe.mjs --mobile --shot /tmp/shots   # 顺便截图
```

走完 首页 → 大厅 → 建房/加入 → 双方准备 → 记忆 → 听取 → 抢跑触发 お手つき，
每一屏量：横向溢出、文本截断、触摸热区、牌面几何、纵向能否一屏装下、
光带是否落在场区几何中线上、Tab 焦点环落在被裁元素上还是包装层上。

这些都是**截图看不出来的**。2026-08-30 那轮复审里 6 个真问题有 4 个是它抓出来的，
包括「记忆阶段自陣 12 张牌全部掉到折线以下」——截图上看只是「有点长要滚一下」。

一个已知限制：判定回传的时机抓不稳，`reveal` 那一帧常常采样不到。
真浏览器里点一下就有，所以这一帧留给人工。

### `px-contrast.mjs` — 用像素复核对比度

```bash
node tools/ui-audit/px-contrast.mjs
```

detector 遇到 `filter` / `backdrop-filter` 祖先时算不出背景，会退化成逐像素测量，
而小字的抗锯齿让多数像素只是部分覆盖 —— 它把真值 16.77:1 的 `--color-ink`
报成 median 4.2~7.2。这个脚本在 DPR 4 下重测，给出可以拿去对账的数。

### `detect-report.mjs` — 把 detector 的 JSON 按规则分组

```bash
node .claude/skills/impeccable/scripts/detect.mjs http://localhost:5173/ \
  --viewport 390x844 --json > /tmp/out.json
node tools/ui-audit/detect-report.mjs /tmp/out.json
```
