---
name: 闪耀色彩 猜歌
description: 一条光带同时是倒计时、频谱与两阵之间的界线；其余一切静止。
colors:
  crystal-violet: "#615f90"
  crystal-violet-lt: "#a2a2c0"
  refraction-cyan: "#5ee2ff"
  refraction-cyan-deep: "#00b4f0"
  deep-refraction: "#0077a8"
  pale-refraction: "#b9f2ff"
  crystal-violet-deep: "#4b4977"
  sub-pink: "#ffbad6"
  sub-rose: "#e2669b"
  rose-ink: "#c33f7a"
  prism-magenta: "#ff88ff"
  prism-cyan: "#77ffff"
  prism-yellow: "#fff352"
  prism-coral: "#ff7070"
  ground: "#f7f6fb"
  surface: "rgb(255 255 255 / 0.62)"
  surface-lit: "rgb(255 255 255 / 0.88)"
  divider: "#c2c2d0"
  ink: "#191922"
  ink-sub: "#55555f"
  ink-faint: "#6e6e7c"   # 铺背景视频的三屏被 :root[data-ambient] 覆盖成 #5c5c68
  correct: "#0a6b50"
  wrong: "#b3123a"
typography:
  display:
    fontFamily: "Jost, 'Noto Sans JP', sans-serif"
    fontSize: "calc(64 * var(--u))"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.2em"
  headline:
    fontFamily: "Jost, 'Noto Sans JP', sans-serif"
    fontSize: "calc(36 * var(--u))"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "0.2em"
  title:
    fontFamily: "'Noto Sans JP', 'PingFang SC', 'Hiragino Sans', sans-serif"
    fontSize: "calc(28 * var(--u))"
    fontWeight: 700
    lineHeight: 1.22
    letterSpacing: "0.08em"
  body:
    fontFamily: "'Noto Sans JP', 'PingFang SC', 'Hiragino Sans', sans-serif"
    fontSize: "max(13px, calc(15 * var(--u)))"
    fontWeight: 400
    lineHeight: 1.7
    letterSpacing: "normal"
    fontFeature: "'palt' 1"
  label:
    fontFamily: "Jost, 'Noto Sans JP', sans-serif"
    fontSize: "max(11px, calc(10 * var(--u)))"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.3em"
rounded:
  none: "0"
spacing:
  xs: "calc(8 * var(--u))"
  sm: "calc(12 * var(--u))"
  md: "calc(16 * var(--u))"
  lg: "calc(24 * var(--u))"
  xl: "calc(32 * var(--u))"
  cut-sm: "calc(12 * var(--u))"
  cut-md: "calc(20 * var(--u))"
  cut-lg: "calc(40 * var(--u))"
components:
  button-primary:
    backgroundColor: "{colors.crystal-violet}"
    textColor: "#ffffff"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "calc(14 * var(--u)) calc(40 * var(--u))"
    height: "max(48px, calc(62 * var(--u)))"
  button-glass:
    backgroundColor: "{colors.surface-lit}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "calc(12 * var(--u)) calc(24 * var(--u))"
    height: "44px"
  button-ghost:
    backgroundColor: "rgb(255 255 255 / 0.5)"
    textColor: "{colors.crystal-violet}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "calc(6 * var(--u)) calc(16 * var(--u))"
    height: "44px"
  field:
    backgroundColor: "{colors.surface-lit}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "calc(12 * var(--u)) calc(20 * var(--u))"
    height: "44px"
  option-bar:
    backgroundColor: "{colors.surface-lit}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0 calc(24 * var(--u)) 0 calc(60 * var(--u))"
    height: "max(60px, calc(96 * var(--u)))"   # 定高，不是 min-height；窄屏 max(56px, calc(74 * var(--u)))
  karuta-tile:
    backgroundColor: "{colors.surface-lit}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "calc(6 * var(--u)) calc(8 * var(--u))"
    height: "max(44px, calc(62 * var(--u)))"
  panel-glass:
    backgroundColor: "{colors.surface-lit}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "calc(12 * var(--u)) calc(24 * var(--u))"
---

# Design System: 闪耀色彩 猜歌

## Overview

**Creative North Star: "一条光 / The Running Light"**

全局只有一条不断的光带在动。它同时是倒计时、实时频谱、进度，以及 1v1 里自陣与敵陣之间的那道界线——
其余一切静止。玩家戴上耳机，听见一段没有人声的伴奏，在光带收完之前认出它是哪首歌。
这条光带不是装饰件，它是这套系统唯一的动词。

世界是白的。白底上铺一层几乎看不见的虹彩镭射膜与晶体碎片，内容装在半透明白玻璃里，
所有容器由 `clip-path` 削掉对角——平行四边形、双切角矩形、六边形、两端尖角长条。
`border-radius` 在整个代码库里出现 **0 次**：形状感完全由斜切给出。
唯一主色是晶体紫 (#615f90)，唯一亮色是折射青 (#5ee2ff)，阴影是紫的不是黑的，字距很宽，
字重只有 400 / 600 / 700 三档。入场是从模糊转清晰——像棱镜对上了焦。

开局之前的三屏（首页 / 大厅 / 房间）在这层白底**之下**还垫着一段无声循环的 MV 剪辑，
隔着一层乳化白幕透出来。它不违反「一条光」——那条规矩管的是**内容层**的运动，
而这段视频在遮罩底下不承载任何信息，读得出是哪支 MV 就算调坏了。
进入对局（Play / Karuta）它整层卸载：那两屏一切会动的东西都在跟听力和抢牌抢注意力。

明确拒绝的做法：把一个听觉游戏塞进一堆等大卡片，让每个区块都自带容器、边框和各自的动效。
这套世界里区块之间靠留白与斜切的方向分开，不靠框线。

**Key Characteristics:**

- 一条贯穿全宽的棱镜光带是内容层唯一持续运动的元素
- 形状由 `clip-path` 斜切给出，圆角为零
- 白底 + 半透明白玻璃 + 紫色阴影
- 开局前三屏的底衬垫一段乳化到近乎白的循环视频，对局中整层卸载
- 宽字距的 Jost 大写拉丁压在片假名小标之下
- 8 个组合的官方代表色只作标识，绝不进入文字
- 尺寸由单一设计单位 `--u` 驱动，但触摸热区与最小字号有真 px 地板

## Colors

极浅的紫白场地上，一支高饱和的青作唯一亮色；判定色（绿 / 红）是这套克制里仅有的两次提高音量。

### Primary

- **晶体紫 Crystal Violet** (#615f90)：结构色。标题、图标、边框、空态描边、键盘序号。**不作正文。**
- **浅晶体紫 Crystal Violet Light** (#a2a2c0)：仅作面色与极淡的分隔——对白底只有 2.31:1，任何文字都不能用它。
- **深晶体紫 Crystal Violet Deep** (#4b4977)：只作 `--grad-brand-ink` 的上端。承白字的面必须整条都够深。
- **折射青 Refraction Cyan** (#5ee2ff)：自陣的底色调、选中态的填充、棱镜光带的中段。**是面色不是字色。**
- **深折青 Deep Refraction** (#0077a8)：青色系唯一的文字与描边色。焦点环、选中态边、已就绪。对白底 4.9:1。
- **浅折青 Pale Refraction** (#b9f2ff)：反过来的场景——深紫渐变面上要一个「青」的强调字时用它。对 #615f90 实测 4.85:1。

### Secondary

- **薄樱粉 Sub Pink** (#ffbad6)：只出现在底衬的虹彩径向渐变里，从不作前景。
- **玫瑰 Sub Rose** (#e2669b)：送り札的色帽与填充。对白底 3.2:1，同样只作面。
- **玫瑰墨 Rose Ink** (#c33f7a)：送り札可选牌的描边、「空札」徽标的文字与边。取舍类信息专用，与「对错」的红绿分开。

### Neutral

- **场地白 Ground** (#f7f6fb)：页面底色，也是 `theme-color`。
- **玻璃面 Surface** (rgb(255 255 255 / 0.62)) 与 **亮玻璃面 Surface Lit** (rgb(255 255 255 / 0.88))：
  所有内容容器的面。配 `backdrop-filter: blur(calc(10 * var(--u)))`。
- **分隔线 Divider** (#c2c2d0)：表格与统计区的横线。比官网的 #dbdbdb 深——后者对白底只有 1.29:1，实质不可见。
- **墨 Ink** (#191922)：正文与数字。
- **次墨 Ink Sub** (#55555f)：说明文字，以及**所有浅色面上的小字**。
- **淡墨 Ink Faint** (#6e6e7c)：最弱的辅助文字。对白底 4.95:1——再浅一档（#7c7c8a 是 4.06:1）就不达标。
  余量只有 0.45，所以它是**唯一**扛不住背景视频的一档：铺了视频的三屏上，`:root[data-ambient]`
  把它压到 **#5c5c68**（同一个灰紫，肉眼分不出）。见下方 The Ambient-Veil Rule。

### Tertiary

- **正解绿 Correct** (#0a6b50) 与 **失误红 Wrong** (#b3123a)：判定色。
  这两个值不是对着白底选的，是对着**它们自己的浅色底**选的（见下方规则）。
- **棱镜品红 / 棱镜青 / 棱镜黄 / 棱镜珊瑚** (#ff88ff / #77ffff / #fff352 / #ff7070)：
  只作 `--grad-prism` 的四个停止色，**不单独出现**。它们是全站唯一的彩虹。

### Gradients

四条渐变，从官网原始 CSS 原样摘录。停止色本身也是 palette 里的 token，不是散落的字面量。

- `--grad-prism`：**棱镜品红 → 棱镜青 → 棱镜黄 → 棱镜珊瑚**（90deg，停止点 0 / 35% / 70% / 100%）
  ——全站唯一的彩虹，只出现在光带与遮罩顶部那一小段上。
- `--grad-brand-ink`：**深晶体紫 → 晶体紫**（180deg）——承白字的深紫面。
- `--grad-brand`：**晶体紫 → 浅晶体紫**（180deg）——**不承白字**，下缘对白只有 2.4:1。
- `--grad-cta`：**深折射青 → #1fe0d7**（90deg）——强调面。

代码里 `--grad-prism` 写作三位简写（`#f8f` / `#7ff`），与上表的六位等值。

### Named Rules

**The Surface-Not-Text Rule.** 亮色一律是面色。#5ee2ff (2.4:1)、#e2669b (3.2:1)、#a2a2c0 (2.5:1)
在白底上作文字全部不达标。要写字就换压深过的同色系：`deep-refraction`、`rose-ink`、`ink-faint`。
这条规则是**双向**的：深紫面上的青字同样要换，用 `pale-refraction`。

**The Tinted-Surface Rule.** 判定色对着**它自己压出来的浅色面**取值，不是对着白底。
18% 绿面上写绿字最差 4.74:1，16% 玫瑰面上写红字 4.93:1。
新增任何有色面板之前，先算合成色（token × alpha 叠在 ground 上）再测文字——
`ink-faint` 在白底上过（4.95:1）、在 12% 玫瑰面上不过（3.86:1）。

**The Ambient-Veil Rule.** 背景视频不是背景图——它每帧都在换底色，所以对比度要按**逐帧最差像素**验，
不是按截图，也不是按平均亮度。乳化白幕（`Backdrop` 的 `VEIL`）是径向的：中心 .94、52% 半径处 .91、
边缘 .72。内容列最宽是 `--page-main`，整列都落在 52% 以内，那一圈的 .91 是**下限不是手感**——
在视频最暗的一帧上，`crystal-violet` 在 .90 是 4.56:1、在 .88 就掉到 4.38:1，而 Stat 的小标正是这个色。
视频自身再吃一道 `brightness(1.18) contrast(0.82)` 压动态范围，把黑场从 YAVG 16 抬到 38；
不压的话遮罩接不住，白页面上会突然糊一块脏灰。

四档实测（全片 1537 帧逐像素扫描，0 帧掉线）：`ink` 13.71、`ink-sub` 5.89、
`crystal-violet` 4.76、`ink-faint`（已压深的 #5c5c68）5.12。
原色 #6e6e7c 在同一组数据里 **98.6% 的帧不达标**，最差 3.90——这就是上面那条压深的由来。
白遮罩救不了它：要靠遮罩把它拉回 4.5:1 得推到 .97，那时视频等于没铺。
**换片子或调遮罩之前先重跑这个扫描**，方法记在 `apps/web/public/bg/README.md`。

**The Unit-Colour-Is-Data Rule.** 8 个组合的官方代表色是既有事实数据，不是设计 token。
它们只能是一枚实心色帽、一段边缘、或一圈缩略图描边，**绝不作白底上的文字**（#fff68d 会直接消失）。
每一枚实心色帽补 `inset 0 0 0 1px rgb(0 0 0 / .1)`，浅色组合才读得出来；无归属的曲目回落到
`crystal-violet` 而不是 `crystal-violet-lt`。

## Typography

**Display Font:** Jost（回落 Noto Sans JP）
**Body Font:** Noto Sans JP（回落 PingFang SC / Hiragino Sans）

**Character:** 几何无衬线的大写拉丁配日文黑体。拉丁字距拉到 0.2~0.3em，
日文正文开 `font-feature-settings: 'palt' 1` 收紧标点。字重只有 400 / 600 / 700 三档，
没有中间态——这套系统靠字距和大小拉开层级，不靠字重的微调。

文案是**中文正文 + 日文术语**：说明性文字用中文保证看得懂，游戏术语（空札 / 送り札 / お手つき /
自陣 / 敵陣 / 決まり字 / 勝ち・負け・引き分け）与大标题用日文保持气氛。这是确认过的约束。

### Hierarchy

- **Display** (700, `calc(64 * var(--u))`, lh 1)：结算页的分数、房间码这类只出现一次的大数字。
- **Headline** (700, `calc(36 * var(--u))`, ls 0.2em)：区块标题的 Jost 大写拉丁。窄屏降到 `25u` 且字距收到 0.14em。
- **Title** (700, `calc(28 * var(--u))`, lh 1.22)：难度名、曲名。窄屏降到 `21u`。
- **Body** (400, `max(13px, calc(15 * var(--u)))`, lh 1.7)：中文说明正文。
- **Label** (600, `max(11px, calc(10 * var(--u)))`, ls 0.3em)：片假名小标、统计项名。

选项条上的曲名（`.sc-song`）是单独一档：桌面 `28u`，窄屏 `22u`。它不是 Title——
Title 是 `28u` 没错，但曲名要跟着选项条的定高一起算，见下面 The Constant-Height Rule。

### Named Rules

**The Floor Rule.** 最小的**四级**字号带**真 px 地板**：`--text-2xs` 是 `max(11px, calc(10 * var(--u)))`，
`--text-xs` 是 `max(12px, calc(11 * var(--u)))`，`--text-sm` 是 `max(12px, calc(13 * var(--u)))`，
`--text-base` 是 `max(13px, calc(15 * var(--u)))`。只跟 `--u` 缩的话，低钳位下它们会掉到
7.8px / 8.6px / 10.1px / 11.7px——那不是风格，是读不出来。
11px 是功能性文字的下限，12px 是正文的下限。

sm 与 base 的地板是后补的：桌面的 `--u` 改成同时看视口高之后（见 Layout），低钳位从
「1123 以下的窄窗口」变成「1366×768 这类常见笔记本」的常态，而 `--text-sm` 承的是
演唱者、难度说明这些**正文**。收紧密度不能收成读不出来。

**The Kana-Over-Latin Rule.** 区块标题永远是两行：上排小号宽字距片假名，下排 Jost 大写拉丁，
四角各一枚角标把整块框起来。角标是**实心深紫直角三角 + 一条与斜边平行的浅紫窄带**，
不是细线条，也不是贴着字的大括号。

**The Hero-Title Rule.** 页面主标题（`HeroTitle`）把上面那条规则**倒过来**：
上排是小号宽字距的 Jost 拉丁**品牌标**，下排是大号中文**主标题**，且是全页唯一的 `h1`。
理由是分工不同——区块标题由拉丁串命名即可，而页面主标题必须回答「这个站是干什么的」，
拉丁串答不了（`SONG GUESS` 既不说闪耀色彩也不说无人声）。
两者共用同一套四角角标，形状语言不分家。
主标题用 `ink` 不用 `primary`：`#615f90` 是结构色，本文档明写不作正文，页面主标题按正文的对比度对待。

**The Wide-Tracking Cap Rule.** 宽字距的拉丁串要按视口再封一道顶，不能只靠 `--u`。
6 个 0.3em 字距的字母实测每字 1.016em——房间码在 390 宽下会排到 431px 而容器只有 340px，
把整页顶出 66px 横向滚动。`.sc-roomcode` 用 `min(calc(68 * var(--u)), 12.5vw)` 封顶。

## Layout

**设计单位。** 官网全站不用 px 只用 vw，单一断点 767px（PC 稿宽 1440×900 / SP 稿宽 375）。
直接照搬会让 2560 宽的屏上一切巨大化，所以钳制两端；桌面那一条还要**同时受视口高约束**：

```css
:root { --u: clamp(0.78px, min(0.0694444444vw, 0.1111111111vh), 1px); }   /* 1440×900 处恰为 1px */
@media (max-width: 767px) { :root { --u: clamp(0.82px, 0.2666666667vw, 1.28px); } }
```

`0.0694444444vw` 是 `视口宽 / 1440`，`0.1111111111vh` 是 `视口高 / 900`，取 `min()` 就是
「把 1440×900 的稿等比装进当前视口」。只看宽的旧写法（上钳位 1.16）在 16:9 的屏上必然溢出：
1920×1080 的视口是 1920×990，宽多 33% 而高只多 10%，按宽放大 16% 之后实测单人猜歌页
doc 1150 > vp 990。上钳位收回 1 是因为 1440 就是 1:1 还原点，超过它等于让版面比参考稿还大。

窄屏那条**不加 vh 项**：移动端浏览器地址栏收起会改变 `vh`，字号绑上去会在滚动时抖。
代价是桌面拖动窗口高度会等比改变字号——这是横向早就有的语义在纵向的延伸，不是新行为。

各档实测：1366×678 → 0.78（触底）、1440×810 → 0.9、1536×774 → 0.86、1920×990 → 1.0。

Tailwind 的间距基数接到它上面（`--spacing: calc(4 * var(--u))`），整套间距与字号随视口等比缩放。
断点对齐到 767/768（`--breakpoint-sm: 768px`），否则 `sm:` 类与 `--u` 的切换点会错开 128px，
出现「尺寸已经按手机缩了、布局还没换」的夹层。

**不走 `--u` 的三类值：** 触摸热区（真 px，`--u` 低钳位下会掉到 44px 以下）、
发丝线（永远 1px）、最小四级字号（见上）。

**容器宽度。** 四个命名 token，都是 `mx-auto` 居中：

```css
--page-main: calc(1120 * var(--u));    /* 首页 / 单人猜歌 / 结算 */
--page-board: calc(1000 * var(--u));   /* 牌场 */
--page-narrow: calc(760 * var(--u));   /* 大厅 / 房间 */
--page-card: calc(520 * var(--u));     /* 牌场结算卡 */
```

`--page-main` 原来是 `1300u`，1440 宽下内容占 90.3%、两侧各只剩 70px（实测 gutter 4.9%），
文字排到边没有落脚处。收到 `1120u` 后两侧留白 15%（1440）到 20.8%（1920）。
再窄就不行——选项条是「整宽横条」的形状语汇，1366 档再收会短到失去这个语义。

**窄屏重排，不是缩小。** 牌场在 768px 以下从 4 列改 3 列：牌宽从 ~81px 涨到 ~109px，
曲名才放得下——4 列时 12 首里有 6~7 首会被截成「…」。
区块标题的角标框收窄左右留白，否则「LISTENING + 题号」那一行会横向溢出。

### Named Rules

**The Both-Territories Rule.** 牌场必须一屏装下。1536×1024 上实测 `doc == vp == 1024`，
390×844 上自陣越过折线的牌为 0。抢牌只有几秒，滚动去找自己的牌等于没得玩。

**The Constant-Height Rule.** 单人猜歌页的高度是**常量**：答题与揭晓两个状态、逐题之间都不许变。
两处靠 `min-height` 撑的东西因此改成定高：

- `.sc-bar` 桌面 `height: max(60px, calc(96 * var(--u)))`。原来是 `min-height: 112u`，
  而条内文本块（曲名 `28u` × lh 1.22 × 最多两行 + 演唱者）≈ `92u`——一行曲名的条停在钳位上、
  两行的被内容顶起来，高度取决于曲名长短。曲名从 `32u` 收到 `28u` 后两行也在 `96u` 之内。
- `.sc-revealslot` 桌面 `height: calc(64 * var(--u))`，配合揭晓块曲名 `truncate`。
  原来的 `min-height: 58u` 正好压在最高那一列（「正解」+「+N 速度 +M」）的边上，
  曲名一折行必然撑高整页（窄屏实测 38u 的槽被顶到 88px）。

窄屏两者都写回 `height: auto` + `min-height`——那里内容本来就要能换行。

**The Safe-Center Rule.** 整屏内容用 `justify-content: safe center` 垂直居中（`.sc-vfit`），
不用裸的 `center`。裸 `center` 在内容比容器高时把溢出**平均分到两端**，顶上那截跑到视口外
且滚不回来（滚动条只能往下走），页面头部就此永远够不着。`safe` 在这种情况下自动退回 `flex-start`。
窄屏显式退回顶端对齐：那里内容本来就比视口高，居中没有意义。

**The Midline Rule.** 场区是 `grid-template-rows: 1fr auto 1fr`，光带落在几何中线上，
与中央面板多高无关——这条线的全部意义就是「自陣与敵陣之间的那道界线」，不在中线上就是保住了形、丢掉了义。
代价是**面板有多高、光带下方就镜像出多高的空白**，所以面板一律绝对定位浮在光带上，不占网格行。
网格里绝对定位的子项不占单元格，因此三行都要显式钉死 `grid-row`，浮起来的那个跨 `1 / -1`。

## Elevation & Depth

**面是平的，影子属于形状。** 所有表面一律平；阴影不表达「悬浮高度」，
而是让 `clip-path` 削出来的斜角有厚度。所以它跟着形状走，且是紫的不是黑的。
深度另由两件事给出：半透明白玻璃的 `backdrop-filter`，以及白底上那层几乎看不见的虹彩镭射膜。

**底衬的层序。** 全部 `position: fixed` + 负 `z-index`，自下而上六层，前两层只在开局前三屏存在：

| | 层 | 作用 |
|---|---|---|
| ⓪ | 循环视频 | `object-fit: cover`，轻模糊 + 压过动态范围 |
| ⓪′ | 乳化白幕 | 中心浓边缘薄的径向白，把视频压回「底衬」而不是「画面」 |
| ① | 虹彩镭射膜 | 粉 / 薄荷 / 青 / 奶油黄的超大低透明径向渐变 |
| ② | 晶体碎片 | `rgb(97 95 144 / .02)` 的多边形，只给白色区域一点折射质地 |
| ③ | 上缘淡出 | 内容区顶端融进底色 |
| ④ | 前景碎片 | `z-index: 2`，只在视口最外缘露一点，叠在内容之上做景深 |

① 的最后一个 background 是不透明的 `--color-ground`，铺视频时**必须让开**，否则整块盖死。

### Shadow Vocabulary

- **sm** (`drop-shadow(0 1u 2u rgb(71 68 150 / .2))`)：牌、色帽、输入框、小按钮。
- **md** (`drop-shadow(0 4u 8u rgb(71 68 150 / .2))`)：选项条、内容卡。
- **lg** (`drop-shadow(0 6u 8u rgb(71 68 150 / .25))`)：结算卡这类唯一的主体。

### Named Rules

**The Shadow-Belongs-To-The-Shape Rule.** 阴影不是高度，是斜切面的厚度。它画在 `.cut-shadow`
包装层上而不是被裁元素上——同元素时落在裁剪区外的阴影会被 `clip-path` 一起裁掉。颜色取自主色系而非黑色。

**The Flat-At-Rest Rule.** 静止态一律平。抬升只作为状态回应出现：hover 位移 -1px（300ms，`--ease-prism`），
active 归零。

## Shapes

`border-radius` 在整个代码库里出现 **0 次**。形状语言完全由 `clip-path` 提供，四个原语：

- **平行四边形** `.cut-slant`：左上削一角。按钮、标签、选项条、输入框底板。反向的 `.cut-slant-r` 与它成对，避免一屏全是同一个斜向。
- **双切角矩形** `.cut-card` / `.cut-card-sm`：左上、右下各削一角。内容卡、模态、中央信息面板。
- **六边形** `.cut-hex`：缩略图与封面。
- **两端尖角长条** `.cut-bar`：状态条、玩家名牌。

切角深度三档：`--cut-sm` 12u、`--cut-md` 20u、`--cut-lg` 40u。

### Named Rules

**The No-Radius Rule.** 不用圆角。一处都不用。要柔化边缘就换切角深度，不要引入 `border-radius`。

**The Closing-Vertex Rule.** 双切角多边形的最后一个顶点 `0 var(--cut)` 不能省。
省掉之后多边形会从左下角 `(0,100%)` 直接连回 `(cut,0)`，左边变成一条贯穿全高的斜边——
贴着左缘的组合色条会被整条裁掉，只在底部留一个三角。
贯穿全高的斜边本身是合法形状（选项条就故意用一条），bug 是**想要切角却写成了全高斜边**。写完数顶点。

**The Lifted-Outline Rule.** 被裁元素上画的 `outline` 会被一起裁没，等于没有焦点环。
焦点环上提到 `.cut-shadow` 包装层用 `:has(:focus-visible)` 代画，被裁元素自身 `outline: none`。
任何新的可交互斜切元素都必须套在 `.cut-shadow*` 里，否则它出厂就没有键盘焦点指示。

## Components

### Buttons

- **Shape:** 左上削一角的平行四边形（`--cut-sm` 12u）。无圆角。
- **Primary:** `--grad-brand-ink` 深紫渐变承白字，`lg` 尺寸最小高 `max(48px, calc(62 * var(--u)))`。
  注意承白字的面必须**整条都够深**——`--grad-brand` 的下缘 #a2a2c0 配白字只有 2.4:1。
- **Glass:** `surface-lit` + `backdrop-filter`，墨色文字。次级操作。
- **Ghost:** 半透明白底 + `inset 0 0 0 1px crystal-violet` 描边。轮廓是非文字对比度，要 3:1，所以用 `crystal-violet`（5.50:1）而不是 `crystal-violet-lt`（2.31:1）。
- **Outline:** 透明底 + 1.5px 描边。comp 里的主操作形态。
- **Hover / Focus:** hover `translateY(-1px)`，300ms `--ease-prism`；焦点环 2px `deep-refraction`，offset 3px，画在包装层上。
- **触摸热区:** 三档尺寸的 `min-height` 分别是 44px / 44px / `max(48px, 62u)`。纯文本按钮（返回、离开房间、放弃这局）用 `.tap-line`：内边距加 9px、外边距减 9px，盒子长到 44px 而文字不挪窝——不能用 `::after` 扩热区，这类按钮多在 `clip-path` 容器里，伪元素会被裁掉。

### Cards / Containers

- **Corner Style:** 左上 + 右下双切角，`--cut-lg` 40u（小号 `--cut-md` 20u）。
- **Background:** `surface-lit` + `backdrop-filter: blur(calc(10 * var(--u)))`。
- **Shadow Strategy:** `lg`，画在 `.cut-shadow-lg` 包装层上。
- **Internal Padding:** `px-8 pt-12 pb-8`——上内边距要多给一截，因为 `--cut-lg`（≈43px）大于 `p-8`（≈34px），左上角切除区会吃掉紧贴顶端的内容。

### Inputs / Fields

- **Style:** 输入框自己**不裁剪**——`clip-path` 会吃掉光标与选中高亮的边缘。形状由外层的斜切底板给出，输入框透明地坐在上面。
- **静止态:** `inset 0 0 0 1.5px crystal-violet`。边框是非文字对比度，要 3:1。
- **Focus:** `inset 0 0 0 2px deep-refraction`，300ms 淡入。
- **最小高度:** 44px。房间码那类输入开 `tracking-[0.3em]`、居中、等宽数字。

### 棱镜光带 PrismRail（签名组件）

这套系统唯一持续运动的元素，也是它的全部动词。一条贯穿容器全宽的细带：

- **时间**：从两端向中央收（`mirror` 模式），或从右向左收（单机）。映射是**线性的，不加缓动**；
  `clip-path` 上**不能有 transition**——transition 是插值，而这条带的全部意义是它锁在音频时钟上。
- **频谱**：108 根竖条从光带上缘长出。对数取样 + 实测静态剖面归一 + 帧内相对拐点——
  拐点随曲目自适应，但是帧全局的，不会反转左右平衡。
- **折痕**：判定结果以 `correct` / `wrong` 色在带上留下刻痕。
- **实现**：单个 rAF 循环直写 `style.clipPath` 与 canvas 像素，**绝不每帧 setState**
  （React 18 并发调度会批处理，表现是「有时候没反应」）。带 `role="progressbar"` 与节流的 `aria-valuenow`。
- **高度跟着频谱走**：频谱带（`mirror` 120u）是柱子的动态范围上限，
  但光带线本身是 `bottom: 0`。首页与大厅传 `spectrum={false}`，柱子永远不长出来，
  那一整段就变成光带上方的空白（112u 时实测 139px，Hero 因此看着像浮在左上角）——
  没有频谱时只占光带自己的 3px。`mirror` 不参与这个判断：牌场的光带必须落在场区几何中线上。
  频谱那一支的**具体高度**由 `.sc-rail-spectrum` 给（桌面 88u / 窄屏 112u），不写在组件里：
  它是单人猜歌页纵向预算里最大的一块非内容区，要能按断点分档。88u 在 1440 档仍有 79px 峰高，
  不会退回「摊成栅栏」的老问题。

### 歌牌 KarutaTile（签名组件）

- **Shape:** 双切角，`--cut-sm` 14u。最小高 `max(44px, calc(62 * var(--u)))`。
- **组合色条**：左缘一段实心色，从切角下沿起（斜切会吃掉左上角），宽 5u，补 `inset 0 0 0 1px rgb(0 0 0 / .12)`。
- **決まり字**：曲名前 N 个字加粗（`ink`），其余 `ink-faint`。靠字重与明度区分，**不靠另一种颜色**。
- **状态**：idle / selected / pending / sending / sendable / answer / answer-missed / mistake，
  各自一组填色与描边。送り札用玫瑰系（取舍），判定用红绿（对错），两套不混。
- **牌被取走后位置留空**，阵形不重排——玩家背的就是位置。

## Do's and Don'ts

### Do:

- **Do** 让光带承担所有持续运动。它是倒计时、频谱、进度和界线，其余一切静止。
- **Do** 把阴影画在 `.cut-shadow*` 包装层上，被裁元素自身不带阴影也不带 outline。
- **Do** 给每个新的可交互斜切元素套 `.cut-shadow*`，否则它出厂就没有焦点环。
- **Do** 新增有色面板前先算合成色（token × alpha 叠在 `ground` 上），再对着**那个**测文字对比度。
- **Do** 给触摸热区和最小字号真 px 地板：热区 44px，功能性文字 11px，正文 12px。
- **Do** 宽字距的拉丁串按视口再封一道顶（`min(calc(N * var(--u)), Xvw)`）。
- **Do** 在网格里给每个子项显式钉死 `grid-row`——绝对定位的子项不占单元格。
- **Do** 用 rAF 直写 DOM 驱动一切与音频时钟相关的视觉。
- **Do** 在惩罚发生的当下点名它（お手つき）、标出引发它的那张牌，并把文字放进 live region。
- **Do** 让 `prefers-reduced-motion` 关掉入场、抖动、光晕与背景视频——但**不关**倒计时的收拢与折痕，那是信息不是装饰。
- **Do** 换背景片子后重跑逐帧对比度扫描，并按最暗的那一帧定遮罩，不是按平均亮度或一张截图。

### Don't:

- **Don't** 用 `border-radius`。一处都不用。
- **Don't** 把亮色（`refraction-cyan`、`sub-rose`、`crystal-violet-lt`）用作文字，无论底色是白还是深紫。
- **Don't** 把 8 个组合的代表色写成文字或当作设计 token——它们是数据，只作色帽、边段、缩略图描边。
- **Don't** 给动画中的 `clip-path` 加 transition，也不要给时间映射加缓动。
- **Don't** 每帧 `setState`。
- **Don't** 在同一个元素上同时写 `clip-path` 和 `filter: drop-shadow()`，或指望被裁元素上的 `outline` 还在。
- **Don't** 省掉双切角多边形的最后一个顶点。
- **Don't** 把 `line-clamp-*` 和 `block` 写在一起——两者都设 `display`，`block` 会赢，钳制静默失效。
- **Don't** 给 `position: fixed` 的底衬层用 `z-index: 0`；必须是负值，否则它会盖住普通文字（卡片正常、标题和纯文本按钮凭空消失）。
- **Don't** 让牌场的阵形重排或位置漂移——位置就是玩法。
- **Don't** 在播放期间让界面抢注意力。屏幕上唯一该看的是「还剩多久」和「现在在播吗」。
- **Don't** 把背景视频带进 Play 或 Karuta。那两屏的注意力已经被听力和抢牌占满，
  而且它们正在解码音频、跑 rAF 计时，再挂一路视频解码是拿判定去换装饰。
- **Don't** 让 `<video>` 在拿到第一帧前就可见。它画出来是**黑**的不是透明的，铺满整屏时
  慢网上首屏就是一整块黑——先 `opacity: 0`，`canplay` 再淡入（并补一次 `readyState` 的现场检查，
  缓存命中时 `canplay` 会赶在 effect 之前过去）。
