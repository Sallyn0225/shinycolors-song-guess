# 执行计划：桌面端全站密度与版心收紧

## 前置

```bash
cd apps/web && pnpm dev      # 后台常驻，测量脚本要连它
```

先记一份**改动前**的基线测量（见步骤 0），否则「收紧了多少」只是估算。

---

## 步骤 0 · 建测量门（先于任何改动）

写 `.trellis/tasks/08-31-desktop-density-tuning/measure.mjs`：从
`.claude/skills/impeccable/node_modules/puppeteer` 取 puppeteer，依次在
`1366×678` / `1440×810` / `1536×774` / `1920×990` / `375×667` / `390×844` 六档视口下访问
dev server，对每个待测状态输出：

```
{ viewport, screen, phase, scrollHeight, innerHeight, scrollWidth, innerWidth,
  u, pageMaxWidth, mainRect, barHeights: [...], revealSlotHeight,
  minTapTarget, text2xs, textXs }
```

待测状态：
- `Start`
- `Play` / `answering`（进入 easy 局后立刻取样）
- `Play` / `revealed`（按键 `1` 作答后取样）
- `Result`
- `Lobby`、`Room`、`Karuta` 各取一次（只验 AC5 横向溢出与 AC4 版心）

`Play` 的两个状态**必须在同一题上采样**，否则 AC2 的差值没有意义。

跑一次存成 `baseline.json`。这一步不改任何产品代码。

**验证：** `baseline.json` 里 `Start` 与 `Play` 至少有一档 `scrollHeight > innerHeight`——复现用户报告的问题。复现不出来就停下来问，不要盲改。

---

## 步骤 1 · `index.css`：设计单位与版心 token

1. 改 `:root` 的 `--u`：

   ```css
   :root {
     --u: clamp(0.78px, min(0.0694444444vw, 0.1111111111vh), 1px);
   }
   ```

   同步改上面那段注释：说明为什么加 `vh` 项（1440×900 的稿要两个方向都装得下）、
   为什么上钳位是 1（1440 是 1:1 还原点，超过它等于比参考稿还大）、
   为什么窄屏规则不加 `vh`（地址栏收起会抖）。

2. `@media (max-width: 767px)` 那条 `--u` **不动**。

3. 在 `:root`（`--cut-*` 附近）加版心 token：

   ```css
   --page-main: calc(1120 * var(--u));
   --page-board: calc(1000 * var(--u));
   --page-narrow: calc(760 * var(--u));
   --page-card: calc(520 * var(--u));
   ```

**验证：** `pnpm --filter @scg/web build` 通过；跑 measure，`u` 字段等于设计文档表里的值。

---

## 步骤 2 · 六个 screen 换用版心 token

| 文件 | 行 | 旧 | 新 |
|---|---|---|---|
| `screens/Start.tsx` | 84 | `calc(1300 * var(--u))` | `var(--page-main)` |
| `screens/Play.tsx` | 219 | `calc(1300 * var(--u))` | `var(--page-main)` |
| `screens/Result.tsx` | 61 | `calc(1300 * var(--u))` | `var(--page-main)` |
| `screens/Lobby.tsx` | 216 | `calc(760 * var(--u))` | `var(--page-narrow)` |
| `screens/Room.tsx` | 61 | `calc(760 * var(--u))` | `var(--page-narrow)` |
| `screens/Karuta.tsx` | 791 | `calc(1000 * var(--u))` | `var(--page-board)` |
| `screens/Karuta.tsx` | 945 | `calc(520 * var(--u))` | `var(--page-card)` |

`Lobby.tsx:428` 的 `420u` 和 `VolumeControl.tsx:84` 的 `430u` 是组件内部宽度不是版心，**不改**。

**验证：** measure 的 `pageMaxWidth` 在 1920 档等于 1120；AC4 的留白比例 ≥ 15%。

---

## 步骤 3 · `index.css`：`Play` 的三个尺寸

在 `@layer components` 的桌面段（`@media (max-width: 767px)` 之外）：

- `.sc-song`：`calc(32 * var(--u))` → `calc(28 * var(--u))`
- `.sc-bar`：`min-height: max(60px, calc(112 * var(--u)))` → `height: max(60px, calc(96 * var(--u)))`
  （`min-height` 换成 `height`，这是「逐题高度恒定」的关键；换的时候在注释里写明原因）
- `.sc-options`：`gap: calc(20 * var(--u))` → `calc(16 * var(--u))`
- `.sc-revealslot`：`min-height: calc(58 * var(--u))` → `height: calc(64 * var(--u))`

窄屏块里的 `.sc-song` / `.sc-bar` / `.sc-options` / `.sc-revealslot` 四条要显式把
`height` 写回 `min-height`（`height: auto; min-height: ...`），否则桌面的定高会漏到移动端。

新增桌面专属的频谱带高度：

```css
.sc-rail-spectrum { height: calc(88 * var(--u)); }
@media (max-width: 767px) { .sc-rail-spectrum { height: calc(112 * var(--u)); } }
```

`ui/PrismRail.tsx` 的 `span` 三分支保留；`spectrum` 为真时不再写内联 `height`，改为挂
`.sc-rail-spectrum` 类。`mirror`（牌场）与 `3px`（纯线）两支不动。

**验证：** measure 的 `barHeights` 在同一题内四条相等；换题后仍相等；`revealSlotHeight` 恒定。

---

## 步骤 4 · `Play.tsx`：揭晓块曲名单行

`screens/Play.tsx:285` 的曲名 `<span>` 加 `truncate`（它已有 `jp-wrap block`，
`truncate` 会带上 `overflow-hidden text-ellipsis whitespace-nowrap`——
`whitespace-nowrap` 与 `jp-wrap` 的 `overflow-wrap` 不冲突，前者优先）。

同一行的演唱者已经是单行。右侧「正解 / 不正解」块不动。

**验证：** 手动跑一局，找一首长曲名（如 `スマイルシンフォニア`）确认省略号出现且槽高不变；
AC2 的 `scrollHeight` 差值为 0。

---

## 步骤 5 · `Start.tsx`：纵向节奏

- L83 `py-14` → `py-10 sm:py-12`（窄屏原本就是 `py-14`，保持观感不回退则维持 `py-14` 在
  `max-sm` 下——用 `py-14 sm:py-10` 更贴近「只收桌面」的要求，按这个写）
- L109 `mt-14` → `mt-14 sm:mt-10`
- L117 `gap: calc(22 * var(--u))` → `calc(18 * var(--u))`
- L118 附近 `mt-12` → `mt-12 sm:mt-9`
- L193 `mt-14` → `mt-14 sm:mt-10`
- `EntryBar` 的 `minHeight`：`max(72px, calc(118 * var(--u)))` → `max(72px, calc(104 * var(--u)))`

L80–82 那段注释（「不用 justify-center：内容比视口高」）在收紧之后可能不再成立——
测完如果 `Start` 的 `scrollHeight < innerHeight`，就把注释改写成描述新事实，别留一条错的。

**验证：** measure 四档 `Start` 均 `scrollHeight <= innerHeight`。

---

## 步骤 6 · 复测与一轮微调（**只允许一轮**）

重跑 measure，与 `baseline.json` 对比，逐条核对 AC1–AC6。

若某档仍溢出，**按下面的顺序**取值调整，不要同时动多个：
1. `.sc-bar` 96u → 90u
2. `.sc-options` gap 16u → 12u
3. `.sc-rail-spectrum` 88u → 76u
4. `Start` 的 `sm:mt-10` → `sm:mt-8`

调完再测一次即收敛。**不进入第三轮**——继续磨下去只是在估算噪声上打转，交给
`trellis-check` 与真实设备。

字体回退场景各测一次：measure 里加一个 `page.setRequestInterception` 拦掉
`fonts.googleapis.com` / `.woff2`，确认 `barHeights` 仍相等（对应设计里的风险项）。

---

## 步骤 7 · 全量校验

```bash
pnpm -r typecheck
pnpm -r test
pnpm --filter @scg/web build
git diff --exit-code -- apps/web/src/api.ts apps/web/src/audio.ts apps/web/src/net apps/web/src/features
node .claude/skills/impeccable/scripts/detect.mjs   # 设计检测器，按其输出修
```

删掉 `measure.mjs` / `baseline.json` 之外要留档的中间产物；测量脚本与两份 JSON
留在任务目录里作为验收证据，不进 `apps/`。

---

## 步骤 8 · 写回文档（Trellis 3.3）

- `DESIGN.md`
  - `## Layout` 的「设计单位」代码块：换成新的 `--u` 公式，补一句为什么加 `vh` 项
  - `## Layout` 的「容器宽度」：改成四个 token 名 + 取值
  - `## Typography` 的 Hierarchy / Named Rules：`.sc-song` 的桌面值
  - OptionBar 一节：`height` 从 `max(60px, 112u)` 改为 `max(60px, 96u)`，并写明它现在是**定高**
  - `components.option-bar.height` 那条 token 同步
- `.trellis/spec/web/frontend/quality-guidelines.md`：`--u` 段落补「桌面单位同时受 vw 与 vh 约束」
- `.trellis/spec/web/frontend/component-guidelines.md`：若其中提到版心字面量，改为 token

## 回滚点

每个步骤一个 commit（`step 1` 之后即可独立回滚）。整体回滚 = `git revert` 步骤 1–5 的
提交范围；无迁移、无状态、无接口变更。
