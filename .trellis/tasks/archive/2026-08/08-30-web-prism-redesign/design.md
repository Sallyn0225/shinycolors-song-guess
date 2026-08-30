# 技术设计：前端视觉层重构

## 1. 边界与契约

### 保留层（只读）

```
src/api.ts          api.createSession/question/begin/answer/replay/result, clipUrl, clipFallbackUrl
src/audio.ts        audio.unlock/prefetch/play/stop/spectrum/reactionMsSince/ctxTimeFor
                    audio.isPlaying / audio.unlocked
src/net/ws.ts       socket.connect/close/send/on/onStatus/toLocalTime
                    socket.connected / socket.hasResumeToken / socket.clock.rttMs
src/features/kimariji.ts     computeKimariji(titles) -> Map<string, number>
src/features/karutaBoard.ts  SlotMap(size, order) { view, order, sync(), swap() }
src/features/narrate.ts      narrateRound(result, names, me) -> { headline, detail, tone }
```

视觉层只消费这些签名。**任何一处想改签名都必须先停下来记入 prd.md**，不得顺手改。

### 重写层（全部推倒）

```
src/index.css     src/App.tsx     src/main.tsx（仅确认 import 路径）
src/screens/*     src/components/*
```

删除：`components/Stage.tsx`、`components/OptionCard.tsx`、`components/KarutaCard.tsx`。
它们的职责由新的 `ui/PrismRail.tsx`、`components/OptionBar.tsx`、`components/KarutaTile.tsx` 接管。

## 2. 目标文件布局

```
apps/web/
  index.html                 ← 加方向契约 HTML 注释（body 首个子节点）+ 字体 preconnect
  src/
    index.css                ← 全量重写：@theme token / 形状原语 / 背景层 / 动效 / base
    main.tsx                 ← 不变
    App.tsx                  ← 重写：壳 + 路由 + 恢复态
    ui/                      ← 新增：设计系统原语
      Backdrop.tsx           ← 三层程序化背景（虹彩膜 / 晶体碎片 / 前景碎片）
      PrismRail.tsx          ← 签名组件：计时 + 频谱 + 进度折痕 + 界线
      Cut.tsx                ← clip-path 容器（解决阴影与焦点环被裁的问题）
      SectionTitle.tsx       ← 片假名小标 + Jost 大标 + 》《 角括号
      Button.tsx             ← 平行四边形按钮（primary / ghost / danger）
      Field.tsx              ← 斜切输入框
      Overlay.tsx            ← 全屏遮罩（断线 / 手势 / 结算）
      Stat.tsx               ← 小标 + 大数字的统计单元
    components/
      OptionBar.tsx          ← 单机四选一的选项条
      KarutaTile.tsx         ← 牌场的一张牌
      Toast.tsx
    screens/
      Start.tsx  Play.tsx  Result.tsx  Lobby.tsx  Karuta.tsx
    （其余保留层原样不动）
```

## 3. Token 体系

### 3.1 尺寸：官网的比例体系，加超宽钳制

官网全站不用 px，只用 vw，单一断点 767px（PC 稿宽 1440 → `1px = 0.0694vw`，
SP 稿宽 375 → `1px = 0.2667vw`）。直接照搬会让 2560 宽的屏上一切巨大化，
所以引入一个**被钳制的设计单位** `--u`：

```css
:root { --u: clamp(0.78px, 0.0694444444vw, 1.16px); }          /* PC：1440 处恰为 1px */
@media (max-width: 767px) { :root { --u: clamp(0.82px, 0.2666666667vw, 1.28px); } }
```

再把 Tailwind v4 的间距基数接到它上面，整套 Tailwind 间距/字号工具类就自动随视口缩放：

```css
@theme {
  --spacing: calc(4 * var(--u));   /* p-4 = calc(var(--spacing) * 4) = 16 设计 px */
  --text-xs:  calc(11 * var(--u));
  --text-sm:  calc(13 * var(--u));
  --text-base:calc(15 * var(--u));
  --text-lg:  calc(18 * var(--u));
  --text-xl:  calc(22 * var(--u));
  --text-2xl: calc(28 * var(--u));
  --text-3xl: calc(36 * var(--u));
  --text-4xl: calc(48 * var(--u));
}
```

> **例外**：触摸目标与描边不走 `--u`。牌、按钮的最小高度用真实 `px`（`min-height: 44px`），
> 否则窄屏钳制下会掉到 44 以下，违反验收标准。hairline 一律 `1px`。

### 3.2 色彩

```css
@theme {
  /* 场地 */
  --color-ground:      #f7f6fb;
  --color-surface:     rgb(255 255 255 / 0.62);
  --color-surface-lit: rgb(255 255 255 / 0.86);
  --color-shard:       rgb(97 95 144 / 0.03);
  --color-divider:     #dbdbdb;

  /* 品牌（结构色，不作正文） */
  --color-primary:     #615f90;
  --color-primary-lt:  #a2a2c0;
  --color-accent:      #5ee2ff;
  --color-accent-deep: #00b4f0;
  --color-sub-pink:    #ffbad6;

  /* 文字：官网的淡紫在白底上不达标，正文一律压到近黑 */
  --color-ink:         #191922;   /* 正文 */
  --color-ink-sub:     #55555f;   /* 次要 */
  --color-ink-faint:   #8a8a96;   /* 三级，只用于 ≥13px */

  /* 判定：白底可用的深色版本，不沿用暗色主题的亮绿亮红 */
  --color-correct:     #0f9d76;
  --color-wrong:       #d61f4e;
}
```

**组合代表色（`unitColor`）是数据，不是 token。** 它们只允许作为
①实心斜切色帽 ②容器边缘的一段着色 ③缩略图描边。
**绝不作为白底上的文字色**——`イルミネーションスターズ` 的 `#fff68d` 在白底上不可见。
色帽内若要放字，字为白色并给色帽加 `rgb(0 0 0 / .12)` 的 1px 内描边保底。

### 3.3 渐变、阴影、字体、动效

```css
:root {
  --grad-brand: linear-gradient(180deg, #615f90 0%, #a2a2c0 100%);
  --grad-cta:   linear-gradient(90deg, #00b4f0 0%, #1fe0d7 100%);
  --grad-prism: linear-gradient(90deg, #f8f 0%, #7ff 35%, #fff352 70%, #ff7070 100%);

  --shadow-sm: drop-shadow(0 calc(1 * var(--u)) calc(2 * var(--u)) rgb(71 68 150 / 0.20));
  --shadow-md: drop-shadow(0 calc(4 * var(--u)) calc(8 * var(--u)) rgb(71 68 150 / 0.20));
  --shadow-lg: drop-shadow(0 calc(6 * var(--u)) calc(8 * var(--u)) rgb(71 68 150 / 0.25));

  --ease: cubic-bezier(0.075, 0.82, 0.165, 1);
  --dur-fast: 0.3s;  --dur-base: 0.4s;  --dur-slow: 0.6s;

  --cut-sm: calc(12 * var(--u));   /* 平行四边形削角 */
  --cut-lg: calc(40 * var(--u));   /* 内容卡削角 */
}
@theme {
  --font-jp:    'Noto Sans JP', 'PingFang SC', sans-serif;
  --font-latin: 'Jost', sans-serif;
  --tracking-tight: 0.08em;  --tracking-base: 0.1em;
  --tracking-wide:  0.2em;   --tracking-title: 0.3em;
}
```

字重只有 400 / 600 / 700 三档。数字用 Jost + `font-variant-numeric: tabular-nums`
（原来的 DM Mono 移除；官网没有 mono 家族，计时读数就是 Jost）。

## 4. 形状原语与两个必须绕开的坑

### 4.1 坑一：`clip-path` 会把 `drop-shadow` 一起裁掉

`filter: drop-shadow()` 与 `clip-path` 同元素时，阴影落在裁剪区外的部分会被裁没。
官网的做法是**阴影在父、裁剪在子**。所有斜切容器一律走 `<Cut>`：

```tsx
// ui/Cut.tsx —— 外层只负责阴影，内层只负责裁剪
<span className="cut-shadow">        {/* filter: var(--shadow-md) */}
  <span className="cut-card">…</span> {/* clip-path: polygon(...) */}
</span>
```

### 4.2 坑二：`clip-path` 会把 `:focus-visible` 的 outline 裁掉

被裁的 `<button>` 上画 outline 等于没画——这条直接违反验收标准。
解法：焦点环画在**外层 wrapper** 上，用 `:has()` 上提：

```css
.cut-shadow:has(:focus-visible) { outline: 2px solid var(--color-accent-deep); outline-offset: 3px; }
.cut-card:focus-visible, .cut-slant:focus-visible { outline: none; }  /* 交给 wrapper */
```

`:has()` 在目标浏览器（本项目已依赖 `backdrop-filter`、`dvh`）都可用。
若某处结构不便，退路是在裁剪元素内部画一圈 `inset 0 0 0 2px` 的 `box-shadow` 内描边。

### 4.3 四个形状

```css
.cut-slant { clip-path: polygon(var(--cut-sm) 0, 100% 0, 100% 100%, 0 100%); }              /* 按钮/标签/选项条 */
.cut-card  { clip-path: polygon(var(--cut-lg) 0, 100% 0, 100% calc(100% - var(--cut-lg)),
                                calc(100% - var(--cut-lg)) 100%, 0 100%, 0 var(--cut-lg)); } /* 内容卡/模态 */
.cut-hex   { clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%); }        /* 缩略图 */
.cut-bar   { clip-path: polygon(var(--cut-sm) 0, calc(100% - var(--cut-sm)) 0, 100% 50%,
                                calc(100% - var(--cut-sm)) 100%, var(--cut-sm) 100%, 0 50%); } /* 两端尖角状态条 */
```

`backdrop-filter: blur(calc(10 * var(--u)))` 只加在 `.cut-card` 类容器上，
且**不能与 `filter` 同元素**（会创建两层合成上下文、移动端掉帧）——毛玻璃在内层，阴影在外层，正好分开。

## 5. 背景：三层程序化重建

`ui/Backdrop.tsx` 渲染三个 `position: fixed; inset: 0; pointer-events: none` 的层，
全部在 `#root` 之下（`z-index: 0`），`#root` 为 `z-index: 1`。

| 层 | 实现 | 说明 |
|---|---|---|
| ① 虹彩镭射膜 | `--color-ground` 打底，叠 5~6 个超大 `radial-gradient`（粉/薄荷/青/奶油黄，alpha 0.05~0.10）+ 一层低透明 `conic-gradient` 制造膜的方向感 | 全部 `background-attachment: fixed`，随滚动不动 |
| ② 晶体碎片 | 内联 `data:image/svg+xml` 的多边形图案，`fill: rgb(97 95 144 / 0.03)`，`background-size` 覆盖整屏 | 只提供质地，几乎看不见 |
| ③ 前景碎片 | 同一 SVG 的稀疏变体，alpha 提到 0.06，只出现在视口四角，`z-index: 2`（叠在内容之上） | 官网的 `bg_front`，做景深 |

碎片 SVG 手写为常量字符串，不落磁盘资源；`prefers-reduced-motion` 下第①层去掉任何缓慢位移。

## 6. 签名组件 PrismRail

```tsx
interface PrismRailProps {
  /** 剩余比例 0~1；rAF 每帧调用，不经过 React state */
  getRemaining?: () => number
  /** 频谱：不传则不画 */
  spectrum?: boolean
  /** 走过的折痕：已完成的刻度位置与判定 */
  creases?: Array<{ at: number; tone: 'good' | 'bad' | 'neutral' }>
  /** mirror: 频谱上下对称生长（牌场中央的界线用） */
  mode?: 'top' | 'mirror' | 'idle'
}
```

**结构**（自下而上）：

1. `<div class="rail-track">` —— 全宽，`background: var(--grad-prism)`，高 `2px`。
   剩余时间用 `clip-path: inset(0 X% 0 X%)` 从两端向中央收；`X = (1 - remaining) * 50`。
   未点亮的部分由底下一条 `--color-primary-lt` / 20% 的同宽轨道兜住。
2. `<canvas class="rail-spectrum">` —— 覆盖在 track 上方（`mirror` 时上下各一半）。
   每帧取 `audio.spectrum(Float32Array(72))`，按 i/72 在 prism 渐变上取色画竖条，
   条底贴 track 上缘。平滑系数沿用旧 `Stage.tsx` 的 `0.45 / 0.12` 不对称插值。
3. 折痕层 —— 绝对定位的小刻度，`left: at * 100%`，`good` 用 `--color-accent`，
   `bad` 用 `--color-primary-lt`，`neutral` 描边。**这是「答过的题留痕」这条 raise 的落点。**

**硬性实现约束（来自 raise 与 PROGRESS.md）：**

- 整个组件用**一个 rAF 循环直写 DOM**：`track.style.clipPath`、canvas 绘制、
  秒数 `textContent`。**任何一帧都不许 `setState`。**
- track 与 canvas 的宽度是 100%，**永不换行**；窄屏只是变短，不折成两行、不改为环形。
- 时间映射**严格线性**，`clipPath` 不加 `transition`——一加就是补间，就不锁时钟了。
- `prefers-reduced-motion` 下：频谱幅度降到 40%（沿用旧行为），折痕与收缩保留
  （它们是**信息**不是装饰，关掉等于让人看不见剩余时间）。
- canvas 用 `ResizeObserver` + `devicePixelRatio`（上限 2）重设尺寸，沿用旧实现。

## 7. 各界面构图

统一壳：`<Backdrop />` + 一列 `max-width: calc(1040 * var(--u))` 的居中主区。
**没有全局导航**——这是游戏不是网站，官网的导航条语汇改用在各屏的状态条上（`.cut-bar`）。

### Start
顶部 `PrismRail mode="idle"` 静止一条；下方 `SectionTitle`（片假名「ソングゲス」/ Jost `SONG GUESS`）；
两个难度作为**整宽斜切横条**纵向排列（不是 2 列网格——与 comp 的语言一致），
每条左端是斜切色帽，右端是四项参数（题数 / 片段 / 限时 / 重听）；
第三条是 1v1 入口，用 `--grad-brand` 实底与前两条区分（Dumbar raise：颜色成片落地）。
错误条 `role="alert"`，耳机提示置底。

### Play（= 批准的 comp，最高保真度要求）
上三分之一：`SectionTitle` 左对齐 +「07 / 20」「1240」右对齐，其下 `PrismRail` 带频谱与折痕。
下方四条 `OptionBar` 纵向排列。揭晓态：正确条整条铺 `--color-correct` 的 8% 淡场并在左端换成实心色帽，
我的错选条铺 `--color-wrong` 8% 并触发 `sc-shudder`；其余条降到 45% 明度。
封面缩略图在揭晓时以 `.cut-hex` 出现在条内左侧。底部「下一题」为整宽 `.cut-slant` 主按钮。

### Result
`PrismRail` 变成分数条：折痕摊开成 10/20 个斜切格（答对青、答错灰），
这是 Play 里那条光带的自然延续。其下大号 Jost 分数、评语、四项统计、逐题列表
（每项一条斜切横条，左端 `unitColor` 边段，`.cut-hex` 缩略图）。

### Lobby
`SectionTitle`（「タイセン」/ `VERSUS`）；房间码用 Jost 超大字距 `.3em`；
玩家两行用 `.cut-bar` 两端尖角状态条（在线点、昵称、RTT、准备）；
输入框走 `Field`（斜切、白玻璃、聚焦时边缘转 `--color-accent-deep`）。

### Karuta（thesis 的兑现处）
**`PrismRail mode="mirror"` 就是敵陣与自陣之间的那道界线**，频谱上下对称生长，
回合倒计时从两端向中央收。中央信息区叠在光带上方（`.cut-card` 白玻璃）。

- 敵陣在上、自陣在下，两块**整片色场**：敵陣底 `rgb(97 95 144 / 0.045)`，
  自陣底 `rgb(94 226 255 / 0.06)`（Dumbar raise：不是散点色条，是两个色场）。
- 牌：`.cut-slant` 小斜切块，`min-height: 44px`，決まり字部分 700 字重近黑、
  其余 400 字重 `--color-ink-faint`；左边缘一段 `unitColor`。
- 网格：PC 4 列；**窄屏也保持 4 列**（12 张牌 4×3 才装得下一屏），
  牌内文字 2 行截断，字号走 `--text-xs`。`Math.max(ownCards, slots.length)` 的动态格数逻辑照搬。
- 六种阶段状态沿用旧 `CardState` 语义，配色映射到新世界：
  `selected/pending` → `--color-accent-deep` 描边；`sending/sendable` → `--color-sub-pink` 系
  （送札是取舍不是对错，与红绿分开）；`answer` → `--color-correct`；
  `answer-missed` → `--color-correct` 虚线；`mistake` → `--color-wrong`。
- 三个遮罩（断线 / 手势 / 结算）走 `Overlay`：`rgb(247 246 251 / 0.9)` + `backdrop-blur`，
  **明底遮罩**而不是旧的暗底。

## 8. 动效

```css
@keyframes sc-appear { from { opacity:0; filter: blur(calc(5 * var(--u))); } to { opacity:1; filter: blur(0); } }
@keyframes sc-shudder { 0%,100%{transform:none} 20%{transform:translateX(-6px)} 40%{transform:translateX(5px)}
                        60%{transform:translateX(-3px)} 80%{transform:translateX(2px)} }
@keyframes sc-halo    { 0%{opacity:.5;transform:scale(.94)} 70%,100%{opacity:0;transform:scale(1.25)} }
```

`sc-appear`（模糊→清晰）是官网的签名入场，用 `var(--ease)` + `--dur-base`，
列表项按 index 递增 60ms 延迟。`prefers-reduced-motion` 下全部 `animation: none`
且 `transition-duration: 0.01ms`——**但 PrismRail 的计时收缩与折痕不在此列**（见 §6）。

## 9. 方向契约

写进 `apps/web/index.html` 的 `<body>` **首个子节点**，HTML 注释形式，构建后可 grep 到 `dfab6df5`。
六块：THESIS / OWN-WORLD / STORY / FIRST VIEWPORT / FORM / FINISH。

## 10. 风险与对策

| 风险 | 对策 |
|---|---|
| `clip-path` 裁掉阴影与焦点环 | §4.1 / §4.2，wrapper 分层 + `:has()` 上提 |
| 白底虹彩世界对比度不达标 | 正文强制 `--color-ink`，`unitColor` 禁作文字色，验收逐项测 |
| `backdrop-filter` 在移动端掉帧 | 只用于 `.cut-card`，不与 `filter` 同元素；牌场的 24 张牌**不用**毛玻璃 |
| 光带精度撑不住 | rAF 直写 + 无 transition + 线性映射；对着 comp 逐帧目视 |
| 窄屏牌场触摸目标过小 | 牌 `min-height: 44px` 用真实 px，不走 `--u` 钳制 |
| 重写时误改保留层 | 实施完毕对 6 个保留文件跑 `git diff --exit-code` |
