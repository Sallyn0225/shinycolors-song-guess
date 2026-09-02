# Implementation Plan

> **执行记录（2026-09-02）**：阶段 0–5 全部执行完毕，`pnpm -r typecheck` 无错、
> `pnpm -r test` 262 项全绿（shared 13 / game-core 62 / web 87 / server 86 / prepare-audio 14）。
> 浏览器实测（dev server + 内置浏览器）：首页数据组 243/1458、单机答题同屏两条计时条
> （光带 88px + 2px 播放素条，间隔 12px，无溢出无跳动，播放条随片段排空、重听重填，
> 用户目视复核通过）、1v1 大厅「记忆时间 60s」。素材删除前的源目录备份在
> `../backup-09-02-contrail/`（仓库外），验收通过后可真删。
> 与规划的两处偏差：① design/implement 写的新最长曲曲名「叶を纏う光 -become the brave-」
> 有误，manifest 实测是 銀翼のアヴニール -become the brave- 378.12s，测试与注释按实际曲名落笔；
> ② 顺带把 planSlices.test.ts「全库最短 159.2s」用例校正为 134.8s（デビ太郎のうた，
> manifest 实测最短一直是它，旧注释属既有过期数字）；PROGRESS 素材实况表头/曲目数行
> 234→243 同理（同表内与新数字直接矛盾，不属于 PRD 划出范围的历史漂移回填）。
> `assets/artist-review.json/md` 经 `pnpm assets review` 重生（243 条，该曲引用清零）。
> 中途调整：用户实测 2.0s 体感偏易，speedGraceSeconds 再落为 **1.8s**（门槛 3.13/3.91s），
> 注释与 tuning-constants.md 同步改写，game-core 62 / server 86 测试复跑全绿。
> 遗留：线上 VPS 素材同步（部署动作）；审查（trellis-check）按用户要求未执行。

顺序按「先纯代码、后不可逆素材」排：R1 / R2 / R4 都可 `git revert`，R3 的素材删除不可逆，
放在最后，且在真删之前先移出仓库备份。

---

## 阶段 0 · 备份（在动任何东西之前）

- [ ] 抄下待删曲的 6 个 `sliceId`（删 manifest 之后就查不到了）：
      `assets/manifest.private.json` → `感謝のコントレイル-9aef61` 的 `slices[].sliceId`
      = `5N0X42NC4VRBSVCBTTGM` `DK883TPXC6SQKP0KATPQ` `K0ZRTB0MPCVACZCDHMSX`
        `G4XBX2ZWWZ9JKSCF13E9` `C0D1B6JXS21XSSD5PH99` `YN02YXBYZNMF1KWZFTP9`
- [ ] 把源目录 `songs/闪彩off vocal无重复_Page1/感謝のコントレイル (Off Vocal) - シャイニーカラーズ/`
      **移动**（不是删除）到仓库外的临时目录，验收全过再真删

---

## 阶段 1 · R1 速度分宽限期 1.5 → 2.0

- [ ] `packages/shared/src/scoring.ts`：`speedGraceSeconds: 2.0`
- [ ] 同文件注释改写：
      - 把 1.5 从「现值」降格为被替换的前值，写清替换理由（实测偏难）
      - 把 2.0 从「被否决的候选」提升为现值，保留「区分度会变弱」这条已知代价
      - 「固定秒数、不随 answerSeconds 按比例缩放」这段**保留不动**
- [ ] `.trellis/spec/shared/backend/tuning-constants.md` 第 77 行起那段同步改写
      （spec 现在把 2.0s 写成反对意见，改动后它是现值，这段必须翻面）

**验证**：`pnpm --filter @scg/game-core test`
`scoring.test.ts` 大部分断言从 `SCORING.speedGraceSeconds` 推导，会自动跟随；
第 32 行「困难模式平均 2.8 秒作答够到 0.95」是写死的数字，宽限期放宽后余量变大，应仍绿。
若这条的注释因新取值而失准，一并更新注释。

---

## 阶段 2 · R2 联机记忆阶段 30 → 60

- [ ] `packages/shared/src/difficulty.ts`：`memorizeSeconds: 60`
- [ ] 注释补一句取值理由（原注释只说「记忆阶段时长（秒），可自由摆放自陣牌」，没有依据）
- [ ] 确认三处消费方仍读常量、无写死数字：
      `apps/server/src/ws/room.ts:394,401` / `apps/web/src/screens/Karuta.tsx:59` /
      `apps/web/src/screens/Lobby.tsx:463`

**验证**：`pnpm --filter @scg/server test`
`room.test.ts` 用 `memorizeDone` 显式推进阶段、不等自然超时，改时长不该让它变慢或变红。
若有测试因超时窗口变长而变慢，说明它在等自然超时——那是要修的耦合，不是放宽超时。

---

## 阶段 3 · R4 播放倒计时条

### 3a `apps/web/src/audio.ts`（只加只读接口）

- [ ] 新增私有字段 `playStartedAt = 0`，在 `play()` 里与 `playUntil` 同处赋值 `t0`；
      `stop()` 里与 `playUntil` 同处归 0
- [ ] 新增 getter `playRemaining: number`，返回
      `(playUntil - ctx.currentTime) / (playUntil - playStartedAt)` 钳到 `[0, 1]`，
      `ctx` 为 null 或分母 <= 0 时返回 0
- [ ] **不改** `play()` / `stop()` 的任何调度、淡入淡出、缓存逻辑

### 3b `apps/web/src/ui/ClipRail.tsx`（新文件）

- [ ] props：`getRemaining: () => number`、`label: string`、`className?: string`
- [ ] 单个 rAF：每帧写 `track.style.clipPath = inset(0 ${(1-r)*100}% 0 0)`，无 transition
- [ ] `aria-valuenow` 按 1% 节流写（照抄 `PrismRail` 的 `lastPct` 做法）
- [ ] 高度 2px，颜色取中性 token（不要 `--grad-prism`），底下垫一层 `--color-track` 轨道
- [ ] 参照 `.trellis/spec/web/frontend/component-guidelines.md` 的 a11y 与 `--u` 尺寸约定

### 3c `apps/web/src/screens/Play.tsx`

- [ ] `const getClipRemaining = useCallback(() => audio.playRemaining, [])`
- [ ] 在现有 `<div className="relative mt-5">`（PrismRail + Countdown）之后渲染
      `<ClipRail getRemaining={getClipRemaining} label="片段播放剩余时间" className="mt-3" />`
- [ ] **无条件渲染**，不按 phase 挂载/卸载（避免布局跳动）
- [ ] 间距实测：折痕从光带 `bottom:-1px` 往下伸 12u，`mt-3` 是否够留待浏览器确认

**验证**：
- [ ] `pnpm --filter @scg/web typecheck`
- [ ] 浏览器实测一局单机（`/run` 或 Playwright）：
      - 起播瞬间播放条满格，`clipSeconds` 秒后归零，答题条仍在走
      - 点「重听」后播放条重新填满，答题条**不**重置
      - 揭晓与切题时页面不跳动、不溢出
      - 两条条子形态可区分（方向 + 颜色）

---

## 阶段 4 · R3 下架曲目

### 4a 素材与产物

- [ ] 确认阶段 0 的源目录已移走
- [ ] `pnpm assets scan` → 期望输出 `[scan] 243 首`
- [ ] `pnpm assets manifest` → 期望 `[manifest] public 243 首 / private 含 1458 个切片映射`，
      且 `✓ public manifest 边界检查通过`
- [ ] 删 6 个切片：`assets/slices/<sliceId 前 2 位>/<sliceId>.opus`
- [ ] 删 `assets/thumb/感謝のコントレイル-9aef61.webp`
- [ ] 删 `assets/.cache/analysis/感謝のコントレイル-9aef61.json`
      与 `assets/.cache/slices/感謝のコントレイル-9aef61.json`

**验证（脚本断言，不靠肉眼）**：
- [ ] 两份 manifest 各 243 首
- [ ] 全库任一 `neighbours[].id` 都不等于 `感謝のコントレイル-9aef61`
- [ ] `assets/slices` 下 `.opus` 总数 = 1458
- [ ] 那 6 个 sliceId 的文件均不存在

### 4b 代码引用

- [ ] `apps/web/src/features/library.ts` → `{ songs: 243, clips: 1458 }`
      （该文件顶部注释解释过这两个数为何写死，注释里的历史陈述不要改，只改数值）
- [ ] `apps/server/src/app.test.ts:47` → `toBe(243)`
- [ ] `tools/prepare-audio/data/overrides.json`：删 `excludeSlicePositions` 里该曲条目。
      删完若该对象只剩 `_comment`，连 `_comment` 一并改写或删掉整块——留一个描述已不存在
      曲目的注释比没有更糟
- [ ] `tools/prepare-audio/src/planSlices.ts:143` doc 注释：换掉「618s 的 感謝のコントレイル」
- [ ] `tools/prepare-audio/src/config.ts:31`：「时长跨 159~618s」→ 新跨度
- [ ] `tools/prepare-audio/src/planSlices.test.ts:38-39`：最长曲用例改用 **378.12s**
      （`叶を纏う光 -become the brave-`），注释同步换曲名与秒数

### 4c 文档与 spec

- [ ] `PROGRESS.md:335` 时长上界、`:338` 切片数（`1464 个（244 × 6）` → `1458 个（243 × 6）`）
- [ ] `DEPLOY.md:270` thumb 张数 244 → 243
- [ ] `.trellis/spec/guides/cross-layer-thinking-guide.md:149-150` 是**历史事故复盘**
      （讲的就是「数字没跟着重算」这类漏网），不是现值陈述——先读上下文再决定改不改，
      若确为历史叙述则保留原样

**验证（prose 扫描，不只扫标识符）**：
- [ ] `grep -rn "感謝のコントレイル\|617.8\|1464\|244" --include=*.ts --include=*.tsx --include=*.md --include=*.json`
      排除 `assets/ songs/ node_modules/ .trellis/tasks/archive/ design-extract-output/`，
      逐条确认剩余命中都是有意保留的历史叙述

---

## 阶段 5 · 全量验收

- [ ] `pnpm -r typecheck`
- [ ] `pnpm -r test`
- [ ] 浏览器实测：单机一整局（看两条计时条 + 曲库计数）+ 联机大厅显示「记忆时间 60s」
- [ ] 阶段 0 移走的源目录真删

---

## Review Gates

1. **阶段 3 后**：`ClipRail` 是否真的只有一个 rAF、零 `setState`、零每帧 DOM 读？
   `audio.ts` 的 diff 是否只有新增字段与 getter？
2. **阶段 4a 后**：manifest 计数与 `neighbours` 清洁性必须脚本验证通过才继续 4b，
   否则先回滚素材（源目录还在备份里）。
3. **提交前**：prose 扫描的每一条剩余命中都要有明确的「保留理由」。

---

## Rollback Points

| 出问题的阶段 | 回滚方式 |
|---|---|
| 1 / 2 / 3 | `git checkout --` 对应文件，无副作用 |
| 4a | 把阶段 0 备份的源目录移回 `songs/`，重跑 `pnpm assets scan && pnpm assets manifest`；切片/缩略图需 `pnpm assets slice --only 感謝` + `covers` 重生成（**sliceId 会变**，这是不可逆的那一半） |
| 4b / 4c | `git checkout --` 对应文件 |

---

## 遗留（不在本任务范围，收尾时报给用户）

- 线上 VPS（`283guess.hmhnk.top`，部署目录 `~/shinycolors-song-guess`）的 `songs/`
  与 `assets/` 需要同步删除，属部署动作
- 仓库里 233 / 234 / 244 三个曲目数的历史漂移（见 `journal-1.md` 2026-09-01 条）
