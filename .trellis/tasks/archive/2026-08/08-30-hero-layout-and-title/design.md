# 技术设计

## 空间论点（spatial thesis）

> **首屏的任务是让人在两秒内知道「这里是听伴奏猜闪耀色彩的歌」，然后立刻选一条路走。**

- **主路径**：标题 → 一句话说明 → 光带 → 三条入口。自上而下一条直线，不分叉。
- **归组**：`标题 + 说明 + 数据` 是同一件事（「这是什么」），必须靠得紧；
  `三条入口` 是另一件事（「怎么开始」）。两组之间由**光带**分开——
  光带在这套系统里本来就是「界线」这个语义的承担者（DESIGN.md: The Midline Rule 的同一条光）。
  不加框线、不加分隔线，靠留白与那条光分组。
- **主次**：中文主标题领读，品牌拉丁标是它的上标，数据组是脚注级别的证据。
- **疏密节奏**：组内紧（8u–20u）、组间松（56u–72u）。
  现状是一串等距的 `mt-5 / mt-6 / mt-7 / mt-8`，所有东西等重——这正是 squint test 失败的原因。
- **跨视口**：居中构图在 390 与 2560 之间不换拓扑，只换尺度；
  数据组在 <768 由三列改为紧凑一行（`gap` 收窄），不换行、不折成两行。

Lobby 用同一条论点，只是第二组换成「建房 / 进房」两条配对路径。

## 改动清单

| 文件 | 性质 | 说明 |
|---|---|---|
| `apps/web/src/ui/PrismRail.tsx` | 修 bug | 高度随 `spectrum` 变化 |
| `apps/web/src/ui/SectionTitle.tsx` | 扩展 | 新增 `HeroTitle` 导出，复用角标 |
| `apps/web/src/screens/Start.tsx` | 重排 | Hero 居中、新标题、数据组、节奏 |
| `apps/web/src/screens/Lobby.tsx` | 重排 | Hero 居中、新标题、节奏 |

`Play.tsx` / `Karuta.tsx` / `Room.tsx` / `Result.tsx` **不改**。

## 设计一：PrismRail 的高度

### 现状

```ts
const span = mode === 'mirror' ? 'calc(120 * var(--u))' : 'calc(112 * var(--u))'
```

112u 是频谱柱的动态范围上限（组件注释里写明：46u 时峰长不出来，只能摊成栅栏）。
但它与「是否真的画频谱」无关，于是 `spectrum={false}` 的场合白留一条 112u 的空带。

### 方案

```ts
/*
  112u 是频谱柱的动态范围上限（见上方注释），但它只在**真的画频谱**时才有意义。
  Start 与 Lobby 传 spectrum={false}，柱子永远不长出来，这 112u 就是光带上方
  一条 112px 的空白——实测把首页 Hero 顶得像浮在左上角。
  没有频谱时，容器收到光带线本身的 3px。

  mirror 不参与这个判断：牌场的光带必须落在场区几何中线上，
  高度是它成为「自陣与敵陣之间那道界线」的前提（DESIGN.md: The Midline Rule）。
*/
const span =
  mode === 'mirror' ? 'calc(120 * var(--u))' : spectrum ? 'calc(112 * var(--u))' : '3px'
```

### 影响面与安全性

- `spectrum={false}` 只出现在 `Start.tsx:91` 与 `Lobby.tsx:224`，两处都是本任务的目标。
- rAF 循环里 `ctx.clearRect` 之后立刻 `if (!spectrumRef.current) return`，
  3px 高的 canvas 不会进入绘制路径。
- `w === 0 || h === 0` 的早退在 3px 下不触发。
- 折痕（creases）只在 Play 用，且那里 `spectrum` 为真，高度不变。
- 底轨与亮轨都是 `bottom: 0` + `height: 3px`，容器收到 3px 后两者恰好填满，不裁切。
- `ResizeObserver` 仍挂在 canvas 上，高度变化会正常触发 `resize()`。

**取舍**：也可以给 `span` 加一个新 prop（如 `band={false}`）来显式表达，
但那是把已经存在的 `spectrum` 语义拆成两个参数；`spectrum={false}` 本来就已经完整表达了
「这里不画频谱」，让高度跟着它走才是消除重复真相。

## 设计二：HeroTitle

### 为什么不直接复用 SectionTitle

`SectionTitle` 的契约是 DESIGN.md 的 **Kana-Over-Latin Rule**：
上排小号宽字距片假名，下排 Jost 大写拉丁，四角角标。
Hero 要的是「上排小号拉丁品牌标，下排大号中文主标题」——层级顺序反了，字体也反了。
把它压进 `SectionTitle` 的 props 会让一个组件同时表达两条互斥的排版规则。

### 方案

在同一个文件里新增 `HeroTitle`，与 `SectionTitle` **共用** `CornerMark` 与 `.sc-titlebox`：
角标的构造（实心深紫直角三角 + 平行浅紫窄带、四枚互为镜像）只此一份，不复制。

```tsx
interface HeroProps {
  /** 上排小号 Jost 大写拉丁，品牌标 */
  brand: string
  /** 下排大号中文，页面唯一的 H1 */
  title: string
  className?: string
}
```

排版：

- `brand`：`text-2xs`、`font-latin`、`uppercase`、`tracking-title`（0.3em）、`text-primary`。
  与 `SectionTitle` 的片假名行同一档——品牌标降到小号正是用户选定的形态。
- `title`：`sc-title-lg`（36u，窄屏 25u）、`font-bold`、`text-ink`、`tracking-tight`。
  用 `ink` 而不是 `primary`：这是页面主标题，要最强的对比度（`primary` 5.50:1 是结构色，
  DESIGN.md 明写「不作正文」；主标题按正文对待）。
- 角标尺寸沿用 `CORNER.lg = 30`。

**The Wide-Tracking Cap Rule 检查**：`brand` 是 `SHINY SONG GUESS`（15 字符含空格）
配 0.3em 字距。11px 下约 15 × 1.016 × 11 ≈ 168px，390 视口的内容宽 342px，安全。
`VERSUS`（6 字符）更短。不需要额外的 vw 封顶。

## 设计三：Start 的构图

```
main  mx-auto  max-w-1300u  px-6 py-14
│
├─ header  ── 居中 ────────────────────────────  组一：这是什么
│   ├─ HeroTitle  brand="SHINY SONG GUESS"  title="闪彩猜歌"
│   ├─ mt-6   p    说明句（text-base / ink-sub / 居中 / max-w 46ch / mx-auto）
│   └─ mt-7   dl   数据组：233 曲 · 1398 片段 · 0 人声
│
├─ mt-14  PrismRail idle spectrum=false     ← 界线（现在只有 3px 高）
│
├─ mt-12  section 三条入口条（保持左对齐）    组二：怎么开始
│
├─ mt-7   错误条（若有）
└─ mt-14  音量 + 耳机提示                     组三：设定
```

- `justify-center` 去掉。内容比视口高时它是空操作（D3），留着只会误导后来的人。
  改成 `justify-start`，纵向靠 `py-14` 与组间距控制。
- 说明句由 `maxWidth: '46ch'` + `mx-auto` + `text-center` 居中；46ch 保留——
  它是可读行长的上限，不是布局残留。
- 数据组用 `<dl>`，每项 `<dt>` 小标 + `<dd>` 数值，与既有 `Stat` 组件同构。
  直接复用 `Stat`（`align="center"`），不新造组件。
- 三条入口条**不居中**：它们是整宽横条，本来就填满 1220px，居中对它们没有意义；
  且 `EntryBar` 的左侧色帽是它的识别特征，动它等于动另一个组件。

### 数据组的三项

| 值 | 小标 | 来源 |
|---|---|---|
| `233` | `ライブラリ / SONGS` | `assets/manifest.public.json` → `songs.length` |
| `1398` | `クリップ / CLIPS` | `assets/slices/**/*.opus` 计数 |
| `0` | `ボーカル / VOCAL` | 产品定义：曲库全为 off vocal |

`0 人声` 是这三项里唯一真正的卖点——它把 PRODUCT.md 的定位
（「难度来源从记歌词变成记编曲」）压成了一个数字。

**Product Principle 5 检查**（不给作弊者送线索）：三项都是**聚合量**，
不暴露单曲时长、切片编号或加载差异，建立不了对照表。合规。

### 数字的单一来源

```ts
/*
  曲库规模。这两个数是构建产物的实际计数，不是估计：
    233  = assets/manifest.public.json → songs.length
    1398 = assets/slices/**/*.opus 的文件数
  曲库变动后重新求值：
    node -e "console.log(require('./assets/manifest.public.json').songs.length)"
    find assets/slices -type f -name '*.opus' | wc -l
  （改动前这里写的是 234 / 尚无片段数，是提交 a02a215 移除人声版曲目后遗留的旧值。）
*/
const LIBRARY = { songs: 233, clips: 1398 } as const
```

**已知取舍**：这是编译期常量，曲库变动后需要人工同步。
备选是让服务端在 `/api/difficulties` 里带上计数，但那要动服务端、且给首屏加一次网络往返，
换来的只是一个装饰性数字——不值。风险以注释形式留在代码里。

## 设计四：Lobby 的构图

```
main  mx-auto  max-w-760u  px-6 py-14
│
├─ header  ── 居中 ──────────────────────────  组一：这是什么
│   ├─ HeroTitle  brand="VERSUS"  title="1v1 空札領地戦"
│   └─ mt-5  p  说明句（居中）
│
├─ mt-10  PrismRail idle spectrum=false      ← 界线
│
├─ mt-10  两条配对路径                        组二：怎么进场
│   ├─ 昵称 Field
│   ├─ mt-3  创建房间 Button（primary / full）
│   └─ mt-5  房间码 Field + 加入 Button
│
├─ mt-11  房间列表（表头 + 列表）              组三：现在有谁
├─ mt-12  玩法说明 + 三项统计                  组四：规则
├─ mt-7   连接状态
└─ mt-6   返回
```

- Hero 从 `SectionTitle lg` + 说明 + 112u 死带 ≈ 340px 收到约 210px，
  回收的 130px 直接让「ルーム / ROOMS」表头进入 1440×900 首屏（A7）。
- 组二内部收紧（`mt-3` / `mt-5`），组间放开（`mt-10` / `mt-11`）——建立疏密对比。
- 表单区**不居中**：输入框与按钮是 `full` 宽的，居中对它们没有意义；
  且居中的表单标签会破坏左对齐的扫读线。
- 功能、文案含义、DOM 顺序、`aria-*`、`role="status"` / `role="alert"` 全部不动，
  只改 className 上的间距与对齐。

## 无障碍

- `HeroTitle` 的 `title` 渲染成 `<h1>`；`brand` 渲染成 `<p>`（它不是标题层级，是标识）。
  两页各自只有一个 `<h1>`，Lobby 原来的 `<h1>`（在 `SectionTitle` 里）随之被 `HeroTitle` 取代，
  不产生第二个。
- 数据组用 `<dl>/<dt>/<dd>`（`Stat` 已经是这个结构），读屏软件读得出「项—值」配对。
- 角标 SVG 保持 `aria-hidden` + `focusable="false"`。
- 只改间距与对齐，不动 DOM 顺序，Tab 顺序天然与视觉顺序一致（A10）。
- 入场动画仍走 `.anim-appear`，`prefers-reduced-motion` 的既有关闭规则继续生效（A11）。

## 回滚

四个文件都是纯 UI 改动，无数据迁移、无接口变更。
`git checkout -- apps/web/src/ui/PrismRail.tsx apps/web/src/ui/SectionTitle.tsx apps/web/src/screens/Start.tsx apps/web/src/screens/Lobby.tsx` 即可完全回退。
`PrismRail` 的改动是唯一有跨屏影响的一处，单独回滚它也不会破坏 Start / Lobby 的其余排版
（只会让那条 112u 空带回来）。
