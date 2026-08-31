# 执行计划

## 顺序

三步彼此独立,按「改动小 → 改动大」排,每步都能单独验证与回滚。

### 步骤 1 — R3 按钮文案 `[最小改动,先落地]`

- [ ] `Result.tsx:234` 的 `换个难度` 改为 `返回首页`
- 验证:截图确认文案,点击后回到首页

### 步骤 2 — R1 收窄主列宽

- [ ] `index.css:176` `--page-main` 改 `calc(1120 * var(--u))` → `calc(900 * var(--u))`,
      同步更新该行行尾注释
- [ ] `DESIGN.md` Layout 一节的 `--page-main` 代码块与其下「再窄就不行」那段结论,
      按实测改写(留白百分比、8.3:1 的横条实测、定高规则是它不涨高的原因)
- [ ] `Backdrop.tsx:52` 的注释提到「内容列宽只有 var(--page-main)」,核对结论是否仍成立
      (列更窄 → 更安全,预期只需确认不需改)
- 验证:A1 / A2 / A3 / A4

### 步骤 3 — R2 结算页列表滚动区

- [ ] `index.css` 新增 `.sc-resultlist`:`max-height: min(calc(420 * var(--u)), 44dvh)`、
      `overflow-y: auto`、上下 `mask-image` 渐隐、`scrollbar-width: thin`
- [ ] `Result.tsx` 在 `<ol>` 外包滚动 `<div>`,带 `tabIndex={0}` / `role="group"` /
      `aria-label`,左右 padding + 负 margin 给行阴影留落脚处
- [ ] 写清楚 `max-height` 两项取 `min()` 的理由与阴影 padding 的理由(这两处都是
      「看起来多余、删掉就坏」的代码,必须留注释)
- [ ] 实测调优 `420u / 44dvh` 两个数,以 A5 / A6 为准
- 验证:A5 / A6 / A7

### 步骤 4 — 全量验证与沉淀

- [ ] `pnpm -r typecheck`
- [ ] `pnpm -r test`
- [ ] Playwright 跑完 A1–A9 的四档分辨率(1366×678 / 1440×810 / 1920×990 / 375×667)
- [ ] 跑 impeccable 机械检测:
      `node .claude/skills/impeccable/scripts/detect.mjs --json apps/web/src/screens/Result.tsx apps/web/src/index.css`
- [ ] 按 3.3 更新 `.trellis/spec/web/frontend/`

## 验证命令

```bash
# 类型与测试
pnpm -r typecheck
pnpm -r test

# dev server(后端已在 5179,前端 5173)
cd apps/web && pnpm dev
```

## Playwright 量测脚本(A1–A5, A9)

```js
() => ({
  u:    getComputedStyle(document.documentElement).getPropertyValue('--u'),
  main: Math.round(document.querySelector('main').getBoundingClientRect().width),
  docH: document.documentElement.scrollHeight,
  vpH:  window.innerHeight,
  // A9:横向溢出
  overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  // A4:选项条比例
  bars: [...document.querySelectorAll('.sc-bar')].map(b => {
    const r = b.getBoundingClientRect()
    return { w: Math.round(r.width), h: Math.round(r.height), ratio: +(r.width / r.height).toFixed(1) }
  }),
})
```

## 基线数据(改动前实测,用于对比)

| 档位 | 页面 | main 宽 | docH | vpH |
|---|---|---|---|---|
| 1366×678 | Start | 874 | 694 | 678 |
| 1366×678 | Play | 874(条 796×75) | 678 | 678 |
| 1366×678 | Result(10 题) | 874 | **1142** | 678 |
| 1920×990 | Start | 1120 | 990 | 990 |

900u 预注入后的实测(同一 dev server,`documentElement.style` 覆盖):

| 档位 | 页面 | main 宽 | docH | 结论 |
|---|---|---|---|---|
| 1366×678 | Start | 702 | 694 | 与 1120u 完全一致,不涨高 |
| 1366×678 | Play | 702(条 624×75,8.3:1) | 678 | 一屏装下,横条语义保住 |
| 1920×990 | Start | 900 | 990 | 一屏装下 |

## 回滚点

每个步骤一个 commit 粒度;`index.css` 的两处改动(token / `.sc-resultlist`)分属步骤 2 与 3,
互不依赖,可单独还原。

---

## 验收结果

`baseline.json` / `after.json` 是同一把量测门在改动前后各跑一次的输出。

| # | 标准 | 结果 |
|---|---|---|
| A1 | `--page-main` == 900u,1366 档版心 702px | ✅ 702 / 810 / 774 / 900(四档),留白 24.3% / 21.9% / 24.8% / 26.6% |
| A2 | Start 在 1366×678 仍为 +15,不退化 | ✅ +15(与 baseline 同);1440 / 1536 / 1920 均为 0 |
| A3 | Play 在桌面各档 `docH == vpH` | ✅ 四档全部 `overflowY 0` |
| A4 | 选项条 ≥ 8:1、四条等高、答题↔揭晓差 0 | ✅ 624×74.88 = **8.3:1**;四条同高;`revealSlot` 两态同为 49.91 |
| A5 | 10 题与 20 题 `docH` 相等 | ✅ **+174/+174**(1366)、**+542/+542**(375)、**+476/+476**(390) |
| A6 | 按钮行在 1366×678 首屏可达 | ⚠️ **部分达成**,见下 |
| A7 | 滚动区可 Tab 聚焦、方向键可滚 | ✅ PageDown 把 `scrollTop` 0 → 260,焦点保持;焦点环 `#0077a8` 2px / offset 3px |
| A8 | 文案为「返回首页」且点击回首页 | ✅ 点击后 `h1` 为「闪彩猜歌」 |
| A9 | 窄屏无横向溢出 | ✅ 六档 `overflowX` 全 0 |
| A10 | typecheck / test | ✅ 五个包 typecheck 通过;255 个测试全过;`build` 通过 |
| A11 | DESIGN.md 已按实测更新 | ✅ 含 before/after 表与被推翻的旧结论 |

### A6 的实情

| 档位 | 按钮露出视口 before(10 题 / 20 题) | after(两难度相同) |
|---|---|---|
| 1366×678 | 383 / 979 | **92** |
| 390×844 | 674 / 1443 | **287** |
| 375×667 | 796 / 1536 | **360** |

桌面 92px 是一次滚轮的量,判定为达成。**手机没有达成,而且做不到**:375×667 上即使把
列表高度归零,页面仍溢出 249px —— 标题 + 折痕带 + 分数 + 段位 + 四项统计 + 说明在 375 宽下
本身就超过一屏。手机上结算页必然要滚,能做到的是「滚的距离不再随题数增长」,
这一点由 A5 保证(20 题从 1536px 降到 360px,且与 10 题相同)。

要在手机上进一步逼近,只能压缩结算页**头部**(分数字号 / 统计区留白),那是另一件事,
不在本任务范围。

### 顺带修掉的一个缺陷

`.sc-resultlist` 最初写成单层可聚焦元素,焦点环被 `mask-image` 吃掉。
`getComputedStyle` 报 `outline: rgb(0,119,168) solid 2px`、`:focus-visible` 也 match,
只有截图上没有 —— 靠断言查不出来。已按 `.cut-shadow` 的既有模式提到 `.sc-resultlist-frame`
外层,并写进 DESIGN.md 与 quality-guidelines。

### 量测门的修复

`08-31-desktop-density-tuning/measure.mjs` 写于 `Splash` 上线之前,原样重跑会**全绿**
(六档 Start 都报 `overflowY 0 ✓`)—— 它量的是开场遮罩。本任务的副本已在 `fresh()` 里关掉
`[role="dialog"]`,并加了结算页的两局与 `itemCount / listBox / listScroll / actionsBottom`
四个字段。后续布局改动以这一份为准。

### 已知的、接受的取舍

滚动条在 Windows / Linux 上占位约 12px,列表右缘因此比上方统计区的分隔线内缩同样距离
(左缘精确对齐)。抹平它需要一个平台相关的魔数,代价大于收益,不做。
