# シャニソン 官网设计语言（人工校订版）

> 来源：https://shinycolors-song-for-prism.idolmaster-official.jp/
> 提取日期：2026-08-30 · 工具：`designlang` + 官网 `share.css` / `lib.css` 原始 CSS 校对
> 用途：作为本项目（闪耀色彩猜歌游戏）前端改造的风格参考。**本文件只描述来源站风格，不含任何改造方案。**

## ⚠️ 自动提取的噪声（必须忽略）

`*-design-language.md` / `*-variables.css` / `*-tailwind.config.js` 由工具自动生成，其中以下内容**不是**该站的设计语言，改造时不要采用：

| 自动结果 | 实际来源 | 结论 |
|---|---|---|
| `Secondary #ff0000`（27 次） | OneTrust Cookie 同意弹窗按钮 | 弃用 |
| `#007aff` / `--swiper-theme-color` | Swiper 轮播库默认主题 | 弃用 |
| `WCAG 0% / 8 处对比度失败` | 全部来自红色 Cookie 弹窗 | 与本站无关 |
| `body font-size: 6.25px` | 该站用 `vw` 排版，工具按 `1280px` 视口误读根字号 | 弃用 |
| `spacing-1 … spacing-449`（px 列表） | 同上，`vw` 被折算成任意 px | 弃用 |
| `Material Language: flat` | 工具只看 `box-shadow`，本站用 `filter: drop-shadow` | 实际是「玻璃/棱镜」而非 flat |
| `Brand Voice: 中文 Cookie 文案` | 弹窗文案 | 弃用 |

真实设计语言以下文为准。

---

## 1. 设计主题：Prism（棱镜）

整站围绕游戏副标题 **"Song for Prism"** 建立视觉隐喻：

- **虹彩（iridescent / holographic）**：页面底色是一张浅色镭射膜质感大图，白底上散布极淡的粉、青、黄虹光。
- **晶体碎片（crystal shards）**：背景叠一层 SVG 多边形碎片图案，颜色仅为 `rgba(97, 95, 144, 0.03)`——几乎看不见，但让白色区域有"结晶折射"的细微质地。
- **斜切几何（angular cut）**：几乎所有容器都不是矩形，而是用 `clip-path` 切掉对角，形成平行四边形 / 六边形。**这是该站最强的识别特征。**

整体气质：**明亮、通透、清冷偏紫的偶像感**，不是暗色系。

---

## 2. 色彩

### 品牌色（按 CSS 中实际出现频次）

| 角色 | Hex | 出现 | 说明 |
|---|---|---|---|
| **Primary** | `#615f90` | 61× | 靛紫 / 薰衣草深紫。正文强调、导航底、标题、边框。**唯一的主色。** |
| **Accent** | `#5ee2ff` | 18× | 亮青。当前态、高亮文字（如导航 `TOP`）、发光描边。 |
| Accent-deep | `#00b4f0` | 7× | 天蓝，与 `#5ee2ff` 搭配做渐变／深一档强调。 |
| Primary-light | `#a2a2c0` | 5× | 浅紫灰，渐变收尾色、分隔线。 |
| Sub | `#ffbad6` | 4× | 淡粉，点缀（偶像/女性向柔和感）。 |
| Surface | `#ffffff` | 30× | 内容面（半透明叠加，见 §5）。 |

### 中性色

`#000000`（正文）、`#333333`、`#555555`、`#f2f2f2`（页脚底）、`#dbdbdb`（分隔线）

### 渐变（全部 4 条，原样摘录）

```css
/* 品牌主渐变：导航条 / 按钮底 */
background: linear-gradient(180deg, #615f90 0%, #a2a2c0 100%);

/* 淡出遮罩：内容区上缘融入背景 */
background: linear-gradient(180deg, #fff 0%, #a2a2c0 100%);

/* 棱镜彩虹：装饰线 / 分隔条，整站的"prism"点题 */
background: linear-gradient(180deg, #f8f 0%, #7ff 35%, #fff352 70%, #ff7070 100%);

/* 强调渐变：CTA / 进度条 */
background: linear-gradient(90deg, #00b4f0 0%, #1fe0d7 100%);
```

### 角色色系（可选）

CSS 中另有约 20 组低频色（`#f54275` `#a846fb` `#ead7a4` `#006047` `#144384` `#24130d` …），是 28 位偶像 / 各单位的应援色，用于各自卡片的 `drop-shadow` 与名牌。若本项目需要"按角色/单位配色"，这是现成参照。

---

## 3. 字体

| 用途 | 字族 | 说明 |
|---|---|---|
| 正文 / 日文 | **Noto Sans JP** | 603 个元素，绝对主力 |
| 拉丁标题 / 数字 | **Jost** | 几何无衬线，用于 `INTRODUCTION` `IDOL` `MOVIE` 这类大写英文标题 |
| 特殊装饰 | Noto Serif JP | 仅 3 处 |

### 字距是核心特征

该站大量使用宽字距营造"精致 / 舞台字幕"感：

| letter-spacing | 频次 | 用在 |
|---|---|---|
| `.1em` | 21× | 通用正文、按钮 |
| `.2em` | 7× | 大写拉丁大标题 |
| `.08em` / `.13em` | 10× | 次级标题 |
| `.3em` / `.8em` | 4× | 标题上方的小号片假名 |

### 标题结构（成对）

```
　　　イントロダクション        ← 小号片假名，12–13px / 700 / letter-spacing .1–.3em / #615f90
　  INTRODUCTION            ← Jost 大写，~40px @1440 / 700 / letter-spacing .2em / #615f90
```
标题块的**四个角**各有一枚角标（不是两侧的尖括号 —— 初版这么写是看小图看错了）。
每枚角标的构造：贴着角的一枚**实心深紫直角三角**（两条直角边贴住框的两条边，斜边 45°），
隔一道白缝，外侧是一条**与斜边平行的浅紫窄带**，比三角更长。四枚互为镜像。
角标边长约为拉丁字号的 0.85 倍，离字很远；片假名居中压在拉丁之上，整块被四角框住。

> 依据：`screenshots/full-page.png` 的 INTRODUCTION 处放大到像素级核对。
> 该处的拉丁标题另带一道竖直渐变（上深下浅）；本项目未照搬 —— 渐变下缘的对比度不达标。

### 字重

`400`（正文）· `600`（小标题）· `700`（标题、按钮）——只有三档。

---

## 4. 尺寸单位系统（重要）

**全站不用 px，全部用 `vw`。** 两套设计稿等比缩放：

| 断点 | 设计稿宽 | 换算 |
|---|---|---|
| SP（`max-width: 767px`） | **375px** | `1px = 0.2667vw` |
| PC（`min-width: 767px`） | **1440px** | `1px = 0.0694vw` |

例：`filter: drop-shadow(0 .4166666667vw .5555555556vw …)` = PC 下 `0 6px 8px`。

**断点只有一个：767px。** 没有 sm/md/lg 多级断点——工具报告里那 18 个断点是第三方库（Swiper / OneTrust）自带的。

---

## 5. 材质与层次：棱镜玻璃

页面是**四层叠加**：

```
① 底：虹彩镭射大图        bg/bg_back_{sp,pc}.png（fixed）
② 中：晶体碎片 SVG        common/bg_geo{_pc}.svg  fill: rgba(97,95,144,0.03)
③ 内容面：半透明白        background-color: rgba(255,255,255,0.5 ~ 0.7)
④ 前景装饰碎片           bg/bg_front_{sp,pc}.png（叠在内容之上，做景深）
```

内容区因此永远是"透着底下虹光的半透明白玻璃"，而不是实心白。

### 阴影：紫色 drop-shadow，不是黑色 box-shadow

```css
/* PC，最常用（39×）*/
filter: drop-shadow(0 .4166666667vw .5555555556vw rgba(71, 68, 150, .25));  /* = 0 6px 8px */
/* SP 对应 */
filter: drop-shadow(0 .8vw 1.0666666667vw rgba(71, 68, 150, .25));          /* = 0 3px 4px */
/* 轻量（12×）*/
filter: drop-shadow(0 .0694444444vw .1388888889vw rgba(71, 68, 150, .2));   /* = 0 1px 2px */
```

阴影色 `rgba(71, 68, 150, …)` 是**紫色**——这让斜切形状的阴影跟着 `clip-path` 走，且整体色调统一在紫调里。角色卡片则用各自应援色做 `drop-shadow`。

### 毛玻璃

```css
backdrop-filter: blur(.6944444444vw);   /* PC ≈ 10px */
backdrop-filter: blur(1.3333333333vw);  /* SP ≈ 5px */
```

### 圆角：几乎为零

`border-radius` 只有 `0` 和 `≈6px`（`.4166666667vw`）两档，最大 `1.6vw`。
**形状感完全由 `clip-path` 提供，不靠圆角。**

---

## 6. 形状语言：clip-path 斜切（最关键）

全部 6 条 `clip-path`，原样摘录：

```css
/* A. 双对角切角容器（SP / PC）—— 内容块、模态框 */
clip-path: polygon(13.3333333333vw 0, 100% 0, 100% calc(100% - 13.3333333333vw),
                   calc(100% - 13.3333333333vw) 100%, 0 100%, 0 13.3333333333vw);
clip-path: polygon(11.1111111111vw 0, 100% 0, 100% calc(100% - 11.1111111111vw),
                   calc(100% - 11.1111111111vw) 100%, 0 100%, 0 11.1111111111vw);

/* B. 大幅斜切横幅 —— hero / 分区带 */
clip-path: polygon(0 0, 25.3333333333vw 0, 100% 62.6666666667vw, 100% 100%,
                   22.6666666667vw 100%, 0 calc(100% - 18.6666666667vw));
clip-path: polygon(0 0, 13.1944444444vw 0, 100% 100%, 100% 100%,
                   11.8055555556vw 100%, 0 calc(100% - 9.7222222222vw));

/* C. 单边斜切（平行四边形）—— 按钮、标签、导航条 */
clip-path: polygon(14.6666666667vw 0, 100% 0, 100% 100%, 0 100%);   /* SP */
clip-path: polygon(5.5555555556vw 0, 100% 0, 100% 100%, 0 100%);    /* PC */
```

此外，**偶像卡片是六边形**（截图可见，由背景 PNG 实现），按钮/导航是**两端尖角的平行四边形长条**。

概括三种形态：

1. **平行四边形**（按钮、标签、导航条）——左上/右下削角
2. **双切角矩形**（内容卡、模态）——左上 + 右下削角
3. **六边形**（偶像头像卡、单位卡）

---

## 7. 动效

| 项 | 值 |
|---|---|
| 时长档位 | `.3s`（默认）· `.4s` · `.5s` · `.6s` · `1s` · `1.2s` · `2s` |
| 主缓动 | `cubic-bezier(.075, .82, .165, 1)` — 强 ease-out，"快出慢停" |
| 次缓动 | `ease` |
| 滚动联动 | 有（scroll-linked 入场） |

### 关键帧（站点自有，非库自带）

```css
/* 文字模糊淡入 —— 入场主效果 */
@keyframes text_appear_blur {
  0%   { opacity: 0; filter: blur(5px); }
  100% { opacity: 1; filter: blur(0);   }
}

/* Logo 呼吸闪烁 —— loading */
@keyframes logo_opacity {
  0%, 10%, 90%, 100% { opacity: 1; }
  40%, 60%           { opacity: 0; }
}

/* 白光扫过 */
@keyframes white_opacity {
  0%, 100%   { opacity: 0; }
  40%, 60%   { opacity: 1; }
}

/* 无缝横向跑马灯 —— 底部角色图带 */
@keyframes loop_slide {
  0%   { transform: translateX(0); }
  100% { transform: translateX(-100%); }
}
```

`text_appear_blur`（模糊→清晰）是最具风格的一条：呼应"棱镜聚焦"的概念。

---

## 8. 布局

- **57 个 flex 容器，0 个 grid** —— 纯 flex 布局，`row/nowrap` 为主（46×）。
- 容器 `max-width: 100%`，靠 `vw` 内边距控制留白，没有固定 max-width 栅格。
- 区块纵向节奏：PC `padding: 4.1666vw 0`（≈60px）；SP `padding: 13.3333vw 0`（≈50px）。
- z-index 分四层：`base 1` → `sticky 10–99` → `dropdown 100`（header / modal）→ `modal 999999+`。
- 图片比例以 `16:9`（39×）为主，其次 `1:1`（14×）、`3.2:1` 横幅（9×）、`2:3` 立绘（8×）。
- 图片一律 `border-radius: 0`、方角。

---

## 9. 一句话总结

> 白底上铺一层几乎看不见的虹彩镭射与紫色晶体碎片；内容装在半透明白玻璃里，
> 所有容器用 `clip-path` 削掉对角、变成平行四边形与六边形；
> 唯一主色是靛紫 `#615f90`，唯一亮色是青 `#5ee2ff`；
> 阴影是紫的、圆角几乎没有、字距很宽；
> 元素以模糊转清晰的方式入场。

---

## 10. 可直接复用的 token

```css
:root {
  /* 品牌 */
  --sc-primary:        #615f90;
  --sc-primary-light:  #a2a2c0;
  --sc-accent:         #5ee2ff;
  --sc-accent-deep:    #00b4f0;
  --sc-sub-pink:       #ffbad6;

  /* 中性 */
  --sc-text:           #000000;
  --sc-text-sub:       #555555;
  --sc-surface:        rgba(255, 255, 255, 0.6);
  --sc-footer-bg:      #f2f2f2;
  --sc-divider:        #dbdbdb;
  --sc-shard:          rgba(97, 95, 144, 0.03);

  /* 渐变 */
  --sc-grad-brand:  linear-gradient(180deg, #615f90 0%, #a2a2c0 100%);
  --sc-grad-fade:   linear-gradient(180deg, #fff 0%, #a2a2c0 100%);
  --sc-grad-prism:  linear-gradient(180deg, #f8f 0%, #7ff 35%, #fff352 70%, #ff7070 100%);
  --sc-grad-cta:    linear-gradient(90deg, #00b4f0 0%, #1fe0d7 100%);

  /* 阴影（紫调 drop-shadow） */
  --sc-shadow-sm: drop-shadow(0 1px 2px rgba(71, 68, 150, 0.20));
  --sc-shadow-md: drop-shadow(0 4px 8px rgba(71, 68, 150, 0.20));
  --sc-shadow-lg: drop-shadow(0 6px 8px rgba(71, 68, 150, 0.25));

  /* 字体 */
  --sc-font-jp:     "Noto Sans JP", sans-serif;
  --sc-font-latin:  "Jost", sans-serif;
  --sc-ls-tight:    0.08em;
  --sc-ls-base:     0.1em;
  --sc-ls-wide:     0.2em;
  --sc-ls-title:    0.3em;

  /* 动效 */
  --sc-ease:        cubic-bezier(0.075, 0.82, 0.165, 1);
  --sc-dur-fast:    0.3s;
  --sc-dur-base:    0.4s;
  --sc-dur-slow:    0.6s;

  /* 形状 */
  --sc-radius:      6px;
  --sc-cut-sm:      12px;   /* 平行四边形削角 */
  --sc-cut-lg:      40px;   /* 内容卡削角 */
}

/* 平行四边形按钮 */
.sc-slant {
  clip-path: polygon(var(--sc-cut-sm) 0, 100% 0, 100% 100%, 0 100%);
}
/* 双切角内容卡 */
.sc-cut {
  clip-path: polygon(var(--sc-cut-lg) 0, 100% 0,
                     100% calc(100% - var(--sc-cut-lg)),
                     calc(100% - var(--sc-cut-lg)) 100%,
                     0 100%, 0 var(--sc-cut-lg));
}
/* 六边形卡 */
.sc-hex {
  clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
}
/* 入场 */
@keyframes sc-appear {
  from { opacity: 0; filter: blur(5px); }
  to   { opacity: 1; filter: blur(0);   }
}
```

---

## 附：本次生成的其他文件

`design-extract-output/` 下工具自动产出 35 个文件。校对后建议只参考：

- `*-preview.html` — 可视化总览（注意其中的红色是 Cookie 弹窗噪声）
- `*-motion.html` — 缓动/时长交互演示
- `screenshots/full-page.png`、`hero.png`、`nav.png`、`card-default-0.png` — 视觉参照
- `_raw/share.css`、`_raw/lib.css` — 官网原始 CSS，本文所有结论的依据

其余（`*-tailwind.config.js`、`*-variables.css`、`*-shadcn-theme.css`、`*-design-tokens.json` 等）含 §0 所列噪声，**不建议直接引入**，请用本文 §10 的 token。
