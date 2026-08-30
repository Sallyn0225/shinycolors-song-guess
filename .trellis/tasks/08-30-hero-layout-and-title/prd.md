# 首页与联机大厅的 Hero 布局与标题重构

## 背景

用户反馈两条：

1. 首页与「1v1 对战」页的 Hero「被放在了左上角，没有居中」。
2. 首页标题没有体现出这个网站是干什么的。

## 实测诊断（1440×900 与 390×844，dev server 实拍 + getBoundingClientRect）

### D1 — PrismRail 在 `spectrum={false}` 时预留了 112u 的死带

`PrismRail` 无条件把自身高度设为 `calc(112 * var(--u))`（mirror 模式 120u），
而光带线本身是 `bottom: 0`。这 112u 是留给频谱柱向上生长的空间。

Start 与 Lobby 都传 `spectrum={false} mode="idle"`——频谱永远不会画，
于是光带上方凭空多出一条 **112px 的空白**。实测：

- Start：段落底边 y=231，光带线 y≈370，中间 139px 全空。
- Lobby（390×844）：同样约 130px 空白，占首屏 15%。

这是「Hero 浮在左上角、下面一大片空」这一观感的**主要成因**。

### D2 — 整宽 Hero 行里内容只占左侧三分之一

`main` 是 `mx-auto`、宽 1300u，**容器本身是居中的**（实测 x=65，1440 宽下两侧各 65px）。
问题在 Hero 内部：`header` 占满 1220px，但其中

- 角标标题框实宽 446px
- 说明段落实宽 383px（`maxWidth: '46ch'`）

右侧 **774px 完全是空的**，且没有任何第二列去平衡它。
squint test 下这一行读作「左上角一小团」，而不是一个 Hero。

### D3 — 首屏溢出，`justify-center` 是空操作

Start 的 `main` 写了 `min-h-dvh ... justify-center`，但实测 `scrollHeight = 1010 > innerHeight = 900`。
内容比视口高，`justify-center` 不产生任何效果，垂直方向也不居中。

### D4 — 标题不说明产品是什么

首页 H1 是 `ソングゲス / SONG GUESS`。既没有「闪耀色彩」，也没有「无人声伴奏」——
而后者恰是 PRODUCT.md 里写明的核心差异点（同类产品猜带人声原曲，这里猜 off vocal 伴奏）。
唯一说清这件事的那句话在 body 层级（15u、`ink-sub`），squint test 下读不到。

### D5 — 曲库数字已经过期

`Start.tsx` 写死「曲库收录 234 首」。核对当前构建产物：

- `assets/manifest.public.json` → `songs.length = 233`
- `assets/slices/**/*.opus` → `1398` 个文件

上一个提交（a02a215 移除误入曲库的人声版 リフレクトサイン）之后没有同步这个数字。

## 目标

- **G1** 消除 D1 的 112u 死带，让光带在没有频谱时只占它自己的高度。
- **G2** Hero 改为居中对称构图（用户已选定），首页与大厅共用同一套。
- **G3** 首页标题改为「闪彩猜歌」作主标题，`SHINY SONG GUESS` 降为小号品牌标（用户已选定）。
- **G4** Hero 里补一组曲库数据，使右侧不再是空区，同时让「无人声」这个卖点进入视觉层级。
- **G5** 修正过期的曲库数字，并把它收敛到单一来源、注明如何重新求值。

## 非目标

- 不改 `audio.ts` / `net/ws.ts` / `api.ts` / `features/*`（PRODUCT.md 明令的非 UI 代码禁区）。
- 不改 Play / Result / Room / Karuta 四个界面的布局。
- 不改服务端，不为 Hero 数据新增网络请求。
- 不引入新的视觉世界：DESIGN.md 的白底 / 玻璃面 / clip-path 斜切 / 零圆角 / 紫影一律保留。
- 不改动 Lobby 的任何功能、文案含义与交互流程（仅重排与分组）。

## 需求

### R1 光带高度随频谱开关变化

`PrismRail` 在 `spectrum === false` 且非 mirror 模式时，自身高度收到光带线本身的高度。
mirror 模式（牌场中线）与 `spectrum === true`（Play、Karuta）的高度**一律不变**。

### R2 Hero 居中对称

Start 与 Lobby 的 Hero 区（标题 + 说明 + 数据）水平居中，光带贯穿容器全宽。
入口条 / 表单区维持左对齐的既有排布，不跟着居中。

### R3 首页标题

```
◤   SHINY SONG GUESS   ◥      ← 小号 Jost 大写、宽字距、primary（品牌标）
      闪 彩 猜 歌               ← 大号中文，页面唯一的 H1
◣                      ◢
```

四角角标结构照 DESIGN.md 的 Kana-Over-Latin Rule 保留（实心深紫直角三角 + 平行浅紫窄带）。
大厅同构：品牌标 `VERSUS`，主标题 `1v1 空札領地戦`。

### R4 Hero 数据组

首页 Hero 在说明句下方给三项：`233 曲` / `1398 片段` / `0 人声`，
各带一行片假名或拉丁小标，水平居中排列。

### R5 曲库数字单一来源

`233` 与 `1398` 收敛为 `Start.tsx` 顶部的具名常量，注释写明来源文件与重新求值的命令。

### R6 大厅纵向节奏

回收 D1 的死带之后，重新分配 Lobby 的纵向间距，使 1440×900 首屏能看到房间列表的表头，
390×844 首屏能看到「创建房间」与「房间码 / 加入」两条路径。

## 验收标准

| # | 判据 | 验证方式 |
|---|---|---|
| A1 | Start 与 Lobby 中光带线上方没有 100px 以上的空白 | 实拍 + `getBoundingClientRect` 量光带容器高度 |
| A2 | Play 的频谱带高度、Karuta 的中线位置与改动前一致 | 量 `PrismRail` 容器高度：Play 仍 112u，Karuta 仍 120u |
| A3 | Hero 内容块的水平中心与 `main` 的水平中心重合（±2px） | `getBoundingClientRect` 对比 |
| A4 | 首页 H1 的文本包含「闪彩猜歌」，且是页面上唯一的 `<h1>` | DOM 查询 |
| A5 | 1440×900 首屏内可见：标题、说明、数据组、光带、至少两条入口 | 视口截图 |
| A6 | 390×844 首屏内可见：标题、说明、光带、至少一条入口 | 视口截图 |
| A7 | Lobby 1440×900 首屏可见到「ルーム / ROOMS」表头 | 视口截图 |
| A8 | 页面数字与 `manifest.public.json` / `assets/slices` 实际值一致 | 重新计数比对 |
| A9 | 横向不溢出：390 / 768 / 1440 / 2560 四档 `scrollWidth <= clientWidth` | `getBoundingClientRect` |
| A10 | 键盘 Tab 顺序与视觉顺序一致，焦点环可见 | 逐项 Tab |
| A11 | `prefers-reduced-motion: reduce` 下入场动画关闭 | 模拟该媒体查询 |
| A12 | `pnpm --filter @scg/web typecheck` 与 `pnpm -r test` 通过 | 命令输出 |
| A13 | impeccable 机械检测器在改动文件上无未解释发现 | `detect.mjs --json` |

## 约束

- 遵守 DESIGN.md 全部 Named Rules，尤其：No-Radius、Surface-Not-Text、Floor Rule、
  Wide-Tracking Cap、Lifted-Outline（新的可交互斜切元素必须套 `.cut-shadow*`）。
- 文案语言：中文正文 + 日文术语，不统一成单一语言。
- 触摸热区 44px 地板、功能性文字 11px 地板、正文 12px 地板不得突破。
- 正文与状态色对比度达标；亮色只作面色不作字色。
