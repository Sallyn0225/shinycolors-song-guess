# 技术设计

## 改动边界

| 文件 | 改动 |
|---|---|
| `apps/web/src/index.css` | `--page-main` 值;新增 `.sc-resultlist` 滚动区的尺寸与遮罩 |
| `apps/web/src/screens/Result.tsx` | 列表包一层滚动容器;按钮文案 |
| `DESIGN.md` | 修订 `--page-main` 的「再窄就不行」结论 |
| `.trellis/spec/web/frontend/*` | 沉淀本次实测得到的两条可复用约束 |

`Start.tsx` 与 `Play.tsx` **不改一行** —— 它们只是引用 `--page-main`,收窄由 token 一处生效。
这是选择改 token 而不是改三个 `style` 的理由。

## R1 主列宽

```css
--page-main: calc(900 * var(--u));   /* 首页 / 单人猜歌 / 结算 */
```

900u 的取值依据(非拍脑袋):

- 落在 `--page-narrow` 760u 与原 1120u 之间,偏向窄端,但保住 Play 选项条 8.3:1 的横条比例。
- 1440 参考稿下两侧留白从 15% 涨到 **18.75%**,1920 档从 20.8% 涨到 **23.4%**,
  仍远离 `--page-main` 原来 1300u 时「gutter 4.9%、文字排到边」的失败态。
- `The Ambient-Veil Rule` 要求内容列整列落在乳化白幕 52% 半径以内。列变窄只会让这个更安全,
  不需要重新跑逐帧对比度扫描。

## R2 结算页列表滚动区

### 高度公式

```css
.sc-resultlist {
  max-height: min(calc(420 * var(--u)), 44dvh);
}
```

- 用 `min()` 而不是裸 `dvh`:`--u` 已经同时绑了视口宽与高,单用 dvh 会在超高窗口上
  让列表长到失去「限高」的意义;单用 `--u` 又会在矮窗口上继续挤按钮。两者取小。
- 用 `dvh` 而不是 `vh`:移动端地址栏收起会改 `vh`。这里**可以**用 dvh,因为它只影响
  一个容器的高度,不像字号绑 vh 那样会在滚动时抖字(见 Layout 里窄屏不加 vh 项的理由)。
- 10 题的列表自然高约 660px(1366 档),已经超过任何一档的 `max-height`,
  所以 10 题与 20 题都在滚动态 → **`docH` 相等**,满足 A5。

### 两个必须处理的裁剪陷阱

**1. `overflow-y: auto` 会裁掉每行的 `.cut-shadow-sm` 阴影。**
现在每个 `<li>` 带 `drop-shadow(0 1u 2u ...)`,阴影向左右各溢出几 px。
容器一旦滚动就成了裁剪盒,阴影会被削平,行会看起来"贴在墙上"。
解法是给容器左右各留一段 padding 供阴影落脚,再用等量负 margin 把视觉宽度还原:

```
容器: px-[calc(6*var(--u))] mx-[calc(-6*var(--u))]
```

**2. 遮罩不能用 `clip-path`。**
要表达「这里面还能滚」,用上下缘的 `mask-image` 线性渐隐,不用框线也不用 `clip-path`:

- 框线违反 DESIGN.md「区块之间靠留白与斜切分开,不靠框线」。
- `clip-path` 是硬边,做不出「淡出」,而且会和行内已有的 `clip-path` 叠加裁剪。
- `mask-image` 与容器内子元素的 `clip-path` 互不干扰,是这里唯一干净的手法。

渐隐带只在有内容可滚的那一侧出现最好,但纯 CSS 做不到条件遮罩;固定两端各渐隐
`calc(14 * var(--u))` 是可接受的近似——顶部那道渐隐同时也把列表与上方统计区分开了。

### 滚动条

`scrollbar-width: thin` + `scrollbar-color: var(--color-primary-lt) transparent`。
不用 `::-webkit-scrollbar` 自绘:那套伪元素在 Firefox 无效,而 `scrollbar-*` 标准属性
现在三大内核都支持,一份代码就够。滚动条本身是功能提示,不该做成看不见的。

### 键盘可达(A7)

滚动容器加 `tabIndex={0}` + `role="group"` + `aria-label="逐题结果列表"`。
浏览器对可聚焦的滚动容器原生支持方向键/PageUp/PageDown 滚动,不需要写 JS。

焦点环:这个容器**自身不带 `clip-path`**,所以 `The Lifted-Outline Rule` 不适用,
可以直接在它上面画 `outline`,不必套 `.cut-shadow*` 包装层。用系统既有的
`2px var(--color-deep-refraction)` + `offset 3px`,与全站焦点环一致。

### `<ol>` 的语义

滚动容器是新加的 `<div>`,`<ol>` 原样留在里面 —— 不把 `overflow` 直接写在 `<ol>` 上,
因为 `<ol>` 上还挂着 `flex flex-col` 与 gap,叠加 `overflow` 会让最后一行的 gap
被计入滚动高度,底部多出一段空白。多包一层是最省事的正确做法。

## R3 文案

`换个难度` → `返回首页`。只改字符串。

`onReplay`(再来一局)与 `onHome` 的语义分工因此变清晰:一个重开同难度,一个回首页。
Props 名与 `App.tsx` 的传值都不动。

## 风险与回滚

| 风险 | 判断 | 处置 |
|---|---|---|
| 收窄让 Start 页在 1366×678 溢出变大 | **已实测排除**:`docH` 两档都是 694,与 1120u 完全一致 | — |
| Play 页失去「整宽横条」语义 | **已实测排除**:624×75 = 8.3:1 | 同步修订 DESIGN.md |
| 结算页列表在窄屏形成嵌套滚动、手感差 | 未测,需在 375×667 实测 | 若窄屏手感差,窄屏放宽到 `60dvh` 或直接取消限高 |
| 20 题时顶部折痕带每片过窄 | 900u 下每片约 30px,仍可辨 | 截图确认 |

回滚点:三处改动彼此独立(token / 滚动区 / 文案),任一处出问题都可单独 `git checkout` 该文件段落,
不存在必须整体回退的耦合。
