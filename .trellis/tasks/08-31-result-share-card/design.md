# Design — 结算页导出战报图片

## 1. 分层与文件落点

`.trellis/spec/web/frontend/directory-structure.md` 定了四层，`features/` 是「game logic, **no React**」、
「pure functions… touch no DOM」，且只许 import `@scg/shared`。Canvas 绘制天然要碰 DOM，
直接往 `features/` 塞一个 `draw(ctx)` 就是在破这条规矩。

所以按「算什么」与「画什么」切开：

```
features/grade.ts          段位表 + 分段函数 + 表情占位 SVG 字符串   纯，有测试
features/shareCard.ts      结算数据 → 显示列表 DrawOp[]              纯，有测试
ui/ticketPainter.ts        DrawOp[] → CanvasRenderingContext2D      DOM，无游戏知识
ui/ShareDialog.tsx         导出对话框：ID 输入、预览、下载/分享
ui/GradeBadge.tsx          网页上的段位展示：表情 + 称号 + 评价
screens/Result.tsx         加导出入口，段位替换 verdictLine
screens/Karuta.tsx         加导出入口，段位加在胜负字样下
```

排版计算（截断、换行、对齐、溢出）是这类功能里 bug 最集中的地方。做成显示列表之后，
它在 vitest 里就是一个数组断言，不需要 canvas、不需要浏览器。`ticketPainter` 退化成一个
不做判断的画笔，游戏知识为零，符合 `ui/` 的定位。

### 1.1 features 不能 import `api.ts` 的处理

`Summary` 定义在 `src/api.ts`，而 `features/` 只许 import `@scg/shared`；PRD R6.2 又不许改 `api.ts`。
因此 `features/shareCard.ts` **自己声明输入形状**（`SoloReportInput` / `VersusReportInput`），
字段与 `Summary` / `MatchStats` 结构兼容。screens 直接把 `Summary` 传进去，TypeScript 的结构化类型
会接受，不需要写任何映射代码，也不产生跨层 import。

`DIFFICULTY_PRESETS`、`MatchStats`、`PlayerId` 来自 `@scg/shared`，允许直接 import。

### 1.2 文本量测：让纯函数也能算得准

截断要准就得知道文字实际宽度，而 `ctx.measureText` 是 DOM。做法是把量测**注入**：

```ts
export type Measure = (text: string, font: string) => number
export function buildSoloTicket(input: SoloReportInput, m: Measure): DrawOp[]
```

生产环境传真的 `ctx.measureText`；测试传一个「每个字符固定宽度」的假量测，
于是截断逻辑（第几个字符开始换成省略号）完全可断言。

---

## 2. 显示列表 DrawOp

一组封闭的绘制原语，全部是纯数据：

```ts
type DrawOp =
  | { k: 'paper';   w: number; h: number; fill: string }       // 底色 + 纸纹噪点
  | { k: 'rect';    x,y,w,h: number; fill?: string; stroke?: string; lw?: number }
  | { k: 'rule';    x1,y1,x2,y2: number; color: string; lw: number; dash?: number[] }
  | { k: 'text';    x,y: number; text: string; font: string; color: string
                    align?: 'left'|'center'|'right'; tracking?: number }
  | { k: 'vtext';   x,y: number; text: string; font: string; color: string; step: number }
  | { k: 'image';   x,y,w,h: number; src: string; fit: 'cover'|'contain' }
  | { k: 'hole';    cx,cy,r: number; fill: string }
  | { k: 'stamp';   cx,cy,r: number; main: string; ring: string; color: string; rotate: number }
  | { k: 'barcode'; x,y,w,h: number; seed: number; color: string }
  | { k: 'tick';    x,y,size: number; state: 'ok'|'miss'|'skip'; ink: string; accent: string }
```

`tracking`（字距）单列出来，是因为票根风大量用到字距拉开的小标签，而 Canvas 没有
`letter-spacing`，得逐字绘制 —— 这个细节归画笔，不归布局。

---

## 3. 票根视觉规格

对着 `research/style/style-3-ticket.png` 还原。画布 **720 × 1080** 逻辑像素，
`scale(2)` → 输出 1440 × 2160 PNG（PRD R5.1）。

### 3.1 双色

| 角色 | 值 | 来源 |
|---|---|---|
| 纸 `paper` | `#f5f2ea` | 风格稿 |
| 靛蓝 `ink` | `#2b2c5e` | 由 `crystal-violet-deep #4b4977` 压暗提蓝而来 |
| 荧光粉 `accent` | `#e2669b` | 直接用设计系统的 `sub-rose` |

两个主色都与 `DESIGN.md` 有血缘，导出图不会看着像另一个产品的东西。

### 3.2 纸质与错版

- **纸纹**：`ImageData` 一次性生成的随机噪点，alpha 3–6%，铺满后 `multiply` 叠在最底层。
  只生成一次并缓存 —— 每次导出重算 1440×2160 的噪点会有肉眼可见的卡顿。
- **错版**：粉色图层整体偏移 `(+1.5, -1)` 再画一遍低透明度重影。这是双色丝网印最典型的
  套印不准，也是这个风格的辨识点。
- 不做墨点飞白、不做粗糙边 —— 成本高，缩小后看不见。

### 3.3 分区

```
┌──────────────────────────────┬───┐
│ 主票  0 – 548                │存根│   齿孔线在 x = 548
│                              │552│   圆孔 r=5，纵向每 34 一个
│                              │–  │
│                              │720│
└──────────────────────────────┴───┘
```

存根内容两种战报共用：竖排「バトルリポート」、日期、局号、wordmark。

### 3.4 印章

圆形双环 + 环形排布小字 + 中央 2 字，旋转 −8°，`multiply` 叠加，alpha 0.85。
中央字取自段位表（见 §4），不再单独定一套判定文案 —— 两套文案会立刻走形。

### 3.5 条码

伪随机等宽条纹。种子由 `hash(id + 日期 + 主数值)` 得到，因此**同一局导出两次条码相同**，
换一局才会变。纯函数，可测。

---

## 4. 段位体系

### 4.1 单机 —— 按得分率 `r = score / maxScore`

用得分率而不是正确率：得分里已经含了速度奖励与重听扣分，更能代表这一局的真实表现。
`maxScore === 0` 时 `r` 记为 0。从高到低取第一个 `r >= min` 的段。

| id | min | 称号 | 评价 | 表情 |
|---|---|---|---|---|
| `omniscient` | 0.95 | 全知全能P | 前奏的呼吸你都记得 | `starry` |
| `ace` | 0.85 | 首席担当 | 几乎没有你听不出的曲子 | `grin` |
| `veteran` | 0.70 | 资深P | 熟得很，只在冷门曲上栽跟头 | `smile` |
| `apprentice` | 0.50 | 见习P | 主打曲稳，深挖曲还差点火候 | `neutral` |
| `rookie` | 0.25 | 新人P | 听过，但名字对不上号 | `sweat` |
| `newcomer` | 0 | 初见P | 从今天开始认识她们 | `blank` |

这套取代 `Result.tsx` 现有的 `verdictLine()`（5 档裸文案），函数一并删除。

### 4.2 联机 —— 胜负为主轴，表现细分

`margin = |left[foe] − left[me]|`（剩余自陣差），`ote = otetsuki[me]`。自上而下第一个命中：

| id | 条件 | 称号 | 评价 | 表情 |
|---|---|---|---|---|
| `perfect` | 胜 && `ote === 0` && `margin >= 5` | 完全制圧 | 零误札，对面全程没摸到节奏 | `starry` |
| `clean` | 胜 && `ote === 0` | 无瑕担当 | 一次误札都没有，干净 | `grin` |
| `dominant` | 胜 && `margin >= 5` | 压倒性胜利 | 对面还没进入状态就结束了 | `grin` |
| `narrow` | 胜 | 险胜 | 就差那半张札，赢了就是赢了 | `smile` |
| `drawn` | 平 | 平分秋色 | 再来一局才知道谁更强 | `neutral` |
| `close` | 负 && `margin <= 2` | 惜败 | 只差一点点，别急着走 | `sweat` |
| `defeat` | 负 | 修行中 | 记牌的时间还不够长 | `blank` |

联机不套用「P 梯子」的身份称号 —— 那是「你有多熟这个曲库」的纵向成长，
而联机描述的是「这一局打成什么样」，两者混用会让称号失去含义。表情资源两套共用。

段位表是唯一数据源（PRD R7.4）：网页的 `GradeBadge` 与战报的 `buildTicket` 都从
`features/grade.ts` 读，不存在两份文案。

### 4.3 表情图：占位与替换

约定正式资源路径 `/emote/<emoteId>.webp`（`starry` / `grin` / `smile` / `neutral` / `sweat` / `blank`）。
加载顺序：

1. 试 `/emote/<id>.webp`
2. 失败 → 回退到 `features/grade.ts` 里内置的简笔 SVG，走 `data:image/svg+xml` data URI

于是「把图放进 `apps/web/public/emote/` 就自动生效，不动代码」（R7.7），
而现在没有图也不会出破图或塌布局（R7.8）。占位 SVG 是纯字符串生成，留在 `features/` 合规。

---

## 5. 渲染与导出流程

```
打开对话框
  → 读 localStorage 预填 ID（联机兜底用房间昵称）
  → await ensureFonts()            见 §5.1
  → await loadImages(srcs)         封面缩略图 + 表情图，失败的记为 null
  → buildTicket(input, measure)    纯，产出 DrawOp[]
  → paint(ctx, ops, images)        画到离屏 canvas
  → canvas 直接作为预览显示（CSS 等比缩小）
改 ID → 只重跑 build + paint，图片不重新加载
点下载 → toBlob → navigator.share（若 canShare files）否则 a[download]
```

### 5.1 字体必须等

Jost / Noto Sans JP 走 Google Fonts。`ctx.font` 在字体没加载完时会**静默回退**到
默认字体并按回退字体的宽度排版 —— 结果是一张字距全错、还不会报错的图（PRD 验收项之一）。
所以绘制前：

```ts
await Promise.all([
  document.fonts.load('700 96px Jost'),
  document.fonts.load('600 15px Jost'),
  document.fonts.load('700 28px "Noto Sans JP"'),
  document.fonts.load('400 15px "Noto Sans JP"'),
])
```

`document.fonts.load` 对已加载字体是即时 resolve，不构成额外等待。加载失败不阻塞导出，
按回退字体出图总好过卡在对话框里。

### 5.2 canvas 不会被污染

封面走 `/thumb/<id>.webp`，由 `apps/server` 的静态路由提供，dev 下 `vite.config.ts` 有
`/thumb` 代理 —— **同源**，因此 `toBlob()` 不会抛 `SecurityError`。
表情图同样是同源或 data URI。不需要 `crossOrigin`，也不需要后端改 CORS。

---

## 6. 两套战报的内容差异

### 6.1 单机主票

头栏 `RESULT / リザルト` + 日期 → `PLAYER @ID` → 段位块（表情 + 称号 + 评价）→
巨大得分 `1420 /2000` → 逐题 tick 行（对/错/未答三态）→
统计表（难度、正答、正答率、平均用时、片段长度，leader dots 对齐）→
曲目清单（封面、曲名、正解与否、用时；答错显示「你选了：X」）→ 印章 → 底栏 wordmark + 条码

曲目清单最多 **5 首**，超出显示「他 N 曲」。理由：再多字号就要压到 10px 以下，
在聊天软件里二次压缩之后不可读。

### 6.2 联机主票

头栏同上 → `@ID vs 对手昵称` → 巨大 `勝 / 負 / 分` + 胜因一行 → 段位块 →
回合数 → 对比表（三列：项目 / 你 / 对手；剩余自陣、取牌、お手つき、平均反应）→
校正提示（仅当任一方 `clamped > 0`）→ 印章 → 底栏

**不含**曲目清单与逐题条 —— 联机端没有这两项数据（PRD R4.7）。腾出的纵向空间给对比表。

---

## 7. 影响面与兼容

- 不新增运行时依赖（R6.1）；不改 `audio.ts` / `net/ws.ts` / `api.ts` / `features/` 既有文件（R6.2）。
- 不新增后端接口（R6.3）；ID 只写 `localStorage`，不出浏览器（R6.4）。
- 生成图不出现 `THE IDOLM@STER` / `283 PRODUCTION`（R6.5）—— 风格稿里那些是模型自己加的。
- `Result.tsx` 的 `verdictLine` 被段位取代，是本任务里唯一的行为变更（其余都是新增）。
- 联机导出对话框是纯本地渲染，不发任何 socket 消息，因此不影响再战投票状态（R1.2）。

## 8. 回滚

三个新文件 + 两处 screen 改动，互相独立。出问题时按「先摘入口按钮，再回退段位替换」
两步走即可，`features/grade.ts` 与 `features/shareCard.ts` 留着不影响任何现有路径。
