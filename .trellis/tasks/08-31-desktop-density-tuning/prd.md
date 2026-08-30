# 桌面端全站密度与版心收紧

## Goal

收紧桌面端的版心最大宽度、设计单位上限与关键组件的纵向占位，让首页与单人猜歌页在常见笔记本视口内一屏读完，并让全站六个 screen 的视觉密度保持一致。

不改变设计语言本身（斜切形状、靛紫 + 青的配色、片假名压拉丁的标题构造、模糊转清晰的入场），只改尺度。

## Background

用户在电脑端反馈两条：

1. **版心过宽。** 首页 / 单人猜歌 / 结算三屏的 `maxWidth` 是 `calc(1300 * var(--u))`。1440 宽视口下内容占 90.3%，两侧各只剩 70px；`--u` 的上钳位是 `1.16px`，1670 以上的屏上版心涨到 1508px，同时一切元素放大 16%。
2. **纵向溢出。** 首页需要下滚才能看完；单人猜歌页有时要下滚才够到「下一题 / 退出本局」；揭晓结果还会把页面再拉长一截。

第 2 条里的「有时」有两个独立成因，都要修：

- `.sc-revealslot` 的 `min-height: calc(58 * var(--u))` 与揭晓内容的实际高度贴得极近，曲名一折行就撑高页面。
- `.sc-bar` 是 `min-height`，条高取决于曲名折不折行，逐题不一致。

> 这两条在实现阶段被 `measure.mjs` 部分推翻：桌面四档上两者都没有真的变高，会变高的是窄屏。
> 详见 `design.md` 末尾的「实测与设计的偏差」。定高的改动仍然保留——把「不会变」从巧合变成约束。

## Requirements

### R1 设计单位随视口高度一起收

`--u` 的桌面规则改为同时受视口宽与视口高约束，上限回到 `1px`（即 `index.css` 注释已经写明的「1440 处 1:1 还原点」），不再允许放大到 1.16。窄屏（`max-width: 767px`）规则保持原样不动。

- 真 px 地板（触摸热区 44px、`--text-2xs` 11px、`--text-xs` 12px、发丝线 1px）继续生效，不得因为 `--u` 变小而被击穿。

### R2 版心宽度收敛为共享 token

把散落在各 screen 的 `maxWidth` 收成 `:root` 上的一组命名 token，并把三处 `1300u` 的宽版心收紧。大厅 / 房间的 `760u` 与牌场的 `1000u` 保持既有语义，只改为引用 token。

### R3 单人猜歌页纵向可容纳且高度恒定

- `Play` 在 answering 与 revealed 两个状态下页面总高度**完全相同**——切换状态不产生任何回流位移。
- 逐题高度一致：不同长度的曲名不改变选项条高度。
- 首屏内可见「下一题 / 重听」与「退出本局」。

### R4 首页纵向可容纳

`Start` 的三段（是什么 / 怎么开始 / 音量设定）在目标视口内一屏读完。

### R6 结算页的两个收尾按钮在窄屏并成一行（追加需求）

用户在桌面端的两条反馈交付后追加：移动端结算页的「再来一局」与「换个难度」是上下两行，
应该并成一行，左「再来一局」右「换个难度」。

实测三档移动宽度都只差约 7px 就能放下（375 需 333px / 行宽 327，390 需 346.6 / 340，
414 需 367.7 / 361）。仅收 `gap` 能挤进去但只富余 2px，字体回退或多一个字就又断，不算修好。
做法是窄屏两个按钮各占半行，同时把 `lg` 的 `px-10`(40px) 在窄屏收到 `px-4`——
半行只有 155px，而「再来一局 + 图标」的内容本身就要 91px。桌面维持自然宽度与 `px-10` 不变。

这一条**放宽了 R5 的第三点**：移动端本轮不再是「一律不动」，而是「不得回退」。
本次改动只影响 `Result` 的收尾按钮行，不涉及任何窄屏尺寸 token。

### R5 不碰的东西

- `src/audio.ts`、`src/net/ws.ts`、`src/api.ts`、`src/features/*` 一行都不改（见 `.trellis/spec/web/frontend/index.md` 的「The one rule that overrides taste」）。
- 不改任何 UI 文案、不改交互流程、不新增或删除任何屏上元素。
- 移动端（`max-width: 767px`）的观感不得回退。尺寸 token 一律不动；R6 是唯一的例外，
  且只落在 `Result` 的收尾按钮行上。

## Acceptance Criteria

目标视口按「浏览器视口」计（屏幕高度减约 90px 浏览器界面）。基准四档：`1366×678`、`1440×810`、`1536×774`、`1920×990`。

- [x] AC1：四档视口下 `Start` 与 `Play`（answering 与 revealed 各一次）均满足 `document.documentElement.scrollHeight <= window.innerHeight`，即无纵向滚动。
- [x] AC2：`Play` 在同一题上，answering 与 revealed 的 `scrollHeight` 差值为 0。
- [x] AC3：`Play` 的四条 `.sc-bar` 在同一题内高度相等，且换到曲名更长的题目后高度不变。
- [x] AC4：1920 宽视口下，`Start` / `Play` / `Result` 的版心两侧留白各不少于视口宽的 15%。
- [x] AC5：四档视口下无横向滚动（`scrollWidth <= innerWidth`），375×667 与 390×844 两档移动视口同样无横向滚动。
- [x] AC6：`.tap-line`、`Button` 各 variant 的可点区域仍 ≥ 44px；`--text-2xs` / `--text-xs` 的计算值仍 ≥ 11px / 12px。
- [x] AC7：`pnpm -r typecheck`、`pnpm -r test`（含 `apps/web` 的 21 个与 `apps/server` 的 72 个）、`pnpm --filter @scg/web build` 全绿；`git diff --exit-code -- apps/web/src/api.ts apps/web/src/audio.ts apps/web/src/net apps/web/src/features` 无输出。
- [x] AC8：`DESIGN.md` 的 Layout / Typography / OptionBar 三节与新尺度一致，`.trellis/spec/web/frontend/quality-guidelines.md` 的 `--u` 段落同步更新。
- [x] AC9（R6）：375 / 390 / 414 三档移动视口下，`Result` 的「再来一局」与「换个难度」在同一行且等宽；1440 档桌面维持原有的自然宽度与左对齐。

所有 AC 由 `measure.mjs` 的 `after.json` / `after-nofonts.json` 裁定，逐条证据：

| AC | 结果 |
|---|---|
| AC1 | 四档桌面 `Start` / `Play`（answering / revealed / revealed-hit）`overflowY` 全为 0 |
| AC2 | 同上，三个状态的 `scrollHeight` 完全相同 |
| AC3 | `barHeights` 四值相等；`revealed-hit` 是另一题，值仍相同（如 1440 档恒为 86.39） |
| AC4 | `gutterRatio` 15.0%（1440）/ 18.0%（1366）/ 18.6%（1536）/ 20.8%（1920） |
| AC5 | 六档视口 `overflowX` 全为 0，含 375×667 与 390×844 |
| AC6 | `minTap` 恒为 44；`text2xs` 11、`textXs` 12 |
| AC7 | typecheck / 72 tests / build 全绿；层边界 `git diff --exit-code` 无输出 |
| AC8 | `DESIGN.md` + `quality-guidelines.md` + `component-guidelines.md` 已同步 |
| AC9 | 375 / 390 / 414 三档实测两按钮 `top` 相同且等宽（156/156、162/162、172/172）；1440 档仍是 154/131 的自然宽度、同一行 |

字体回退（`--no-fonts`，拦掉 Google Fonts 与所有 woff2）单独跑过一轮，桌面四档结果与
正常加载完全一致——`.sc-bar` 定高没有被回退字体的行高撑破。

**已知残留（超出本轮范围，如实记录）：**

- `1366×678` 之外的更矮桌面窗口未验证。`--u` 在 678 高时已触底钳位 0.78，再矮只能靠
  重排布局解决，而用户本轮明确不做重排。
- `Lobby` 在四档桌面仍溢出（1366 `+159` → 1920 `+19`，基线是 `+288` → `+162`）。
  它是房间列表，本来就是可滚容器，不在 AC1 内；密度收紧让它改善了约 45%。
- `375×667` 的 `Play` 仍溢出 `+97`（基线 `+107`）。窄屏尺寸本轮按约定不动。

## Out of Scope

- 不把 `Play` 改成「首屏固定不滚动」的重排布局（用户在本轮明确选择了只做密度收紧）。
- 不动移动端断点下的任何尺寸值。
- 不重做配色、动效或形状原语。
