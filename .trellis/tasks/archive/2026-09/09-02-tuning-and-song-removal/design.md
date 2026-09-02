# Design

R1 / R2 是常量改一行，没有设计面，此文档不重复。下面只写 **R4（播放倒计时条）** 与
**R3（下架流程）** 两处真正需要定形的东西。

---

## R4 · 歌曲播放倒计时条

### 现有的两条时间线，为什么第二条现在看不见

| | 答题窗口 | 片段播放 |
|---|---|---|
| 长度 | `answerSeconds` 15s / 10s | `clipSeconds` 8s / 6s |
| 起点 | 服务端 `api.begin` 下发的 `deadlineMs` | `audio.play()` 实际调度的 `t0` |
| 现有呈现 | `PrismRail`（两端向中收）+ `Countdown`（秒数） | 只有频谱在跳，跳完就没了 |
| 重听后 | 不重置（`REPLAY_PAUSES_TIMER = false`） | **重置**，从头再播一遍 |

关键差异在最后一行：这两条时间线的重置语义不同，所以第二条不能靠第一条推导，
必须有自己的数据源。

### 数据源：`audio.ts` 只加只读 getter

`AudioEngine` 已经在 `play()` 里维护 `playUntil = t0 + dur`（`isPlaying` 就读它）。
本次只补一个 `playStartedAt = t0`，并暴露一个纯读的比例：

```ts
/** 本次播放的剩余比例 0~1。没在播（或已 stop）时为 0 */
get playRemaining(): number
```

- 实现 = `(playUntil - ctx.currentTime) / (playUntil - playStartedAt)`，钳到 `[0, 1]`。
- `t0` 有 `LEAD_SEC = 0.06` 的调度提前量，`currentTime < playStartedAt` 时算出 >1，钳到 1
  ——那 60ms 里「还没出声」，满格是对的。
- `stop()` 把 `playUntil` 归 0，比例自然回 0，不需要额外分支。
- **不新增计时器、不改 `play()` / `stop()` 的调度语义**。`src/audio.ts` 是 spec 点名的
  UI 禁区（承载只在生产复现的修复），加只读 getter 是能接受的最小侵入。

选比例而不是秒数：调用方要的就是条子的填充度，返回秒数会逼调用方再持有一份「总长」，
而总长在引擎里已经是 `playUntil - playStartedAt`，重复持有就会在重听时走味。

### 新组件 `apps/web/src/ui/ClipRail.tsx`

为什么不复用 `PrismRail`：`PrismRail` 是 canvas + `ResizeObserver` + 频谱 DSP 的重组件，
它的 `--grad-prism` 渐变与「两端向中收」是答题窗口的身份标识。拿它渲一条 3px 素条，
既要每帧空跑一次 `clearRect`，又会让两条计时长得一模一样——而 R4 的验收明确要求可区分。

为什么不塞进 `PrismRail` 当一个 prop：那个组件的注释写死了四件事的语义与三条硬性约束，
加第五条时间线会把它变成「什么都画」的组件，下次调频谱要连带读懂播放条。

`ClipRail` 的形状（~50 行）：

- **一条 2px 素色横条，从左向右排空**（`clip-path: inset(0 X% 0 0)`），
  与 `PrismRail` 的「两端向中收 + 彩虹」在方向和颜色上都不同 → 一眼分得开。
- 颜色用 `--color-ink-faint` 一档的中性色，视觉上从属于主光带，不抢它。
- 与 `PrismRail` / `Countdown` 同一套约定：**一个 rAF 循环、直写 DOM、无 transition、
  线性映射**。每帧只写一次 `style.clipPath`，不读 DOM（不触发强制同步布局）。
- `aria`：`role="progressbar"`，`aria-valuenow` 与 `PrismRail` 一样按 1% 节流更新，
  `aria-label="片段播放剩余时间"`。
- props 与既有组件同构：`getRemaining: () => number`（传函数不传数值）、`label`、`className`。

### 在 `Play.tsx` 的接线与位置

```tsx
const getClipRemaining = useCallback(() => audio.playRemaining, [])
```

`audio` 是单例，`playRemaining` 是 getter，包一层箭头函数即可，不进 state、不进依赖。

**始终渲染，不按 phase 条件挂载**：`loading` / `countdown` / `revealed` 时 `playRemaining`
本就是 0，条子空着。条件渲染会在每次揭晓、每道题切换时抽掉一行造成布局跳动，
而 `.sc-vfit` 是按视口逐像素分配的布局。

位置放在现有光带容器**下方**。注意现有容器的两处占位：
- `PrismRail` 的折痕挂在 `bottom: -1px` 往下伸 12u，**溢出容器之外**；
- 答题秒数绝对定位在 `bottom: 18u`，在容器内。

所以 `ClipRail` 与容器之间至少要留 12u 才不与折痕叠字。实现时用 `mt-3` 起步，
以浏览器实测为准调整——这是需要看一眼的，不是能推算的。

### 不做的事

- 不给播放条配秒数读数。`Countdown` 的注释说明了「全局唯一**持续**运动的只有那条光带」
  这条纪律已经被本次改动破了一次（多了一条动的条），再加一个跳秒数字是第二次破。
  播放剩余是「还能听多久」的粗略量，条子够用。
- 不动 `clipSeconds` / `answerSeconds` 的任何取值。

---

## R3 · 下架流程

### 为什么能只跑两个 stage

`prepare-audio` 的 stage 缓存按 `songId + srcSize + srcMtimeMs` 命中
（`StageCache`，`assets/.cache/{analysis,slices}/<id>.json`），`sliceId` 由
`specsFor(song, analysis, cached?.map(s => s.sliceId))` 从缓存复用。
所以删掉一首歌之后：

```
pnpm assets scan        # 重扫 songs/ → assets/.cache/scan.json 少一首
pnpm assets manifest    # 用现有 analyze/slice 缓存重写两份 manifest
```

其余 243 首全部缓存命中，**`sliceId` 一个都不变**，不重新编码、不重新生成缩略图。
这正是「只删一首歌」不必付出全量重跑代价的原因。

`neighbours` 在 `manifest` stage 由 `similarity.ts` 对当前曲目集重算，
所以别的曲子指向被删曲的引用会自动消失——这是必须**验证**而不是假设的一条。

### 手工清扫的孤儿文件

`scan` / `manifest` 都不会删任何东西，下面四类要手删：

| 路径 | 说明 |
|---|---|
| `assets/slices/<前2位>/<sliceId>.opus` × 6 | 分 256 子目录，见 `slice.ts#slicePath`。`aacFallback=false`，无 `.m4a` |
| `assets/thumb/感謝のコントレイル-9aef61.webp` | |
| `assets/.cache/analysis/感謝のコントレイル-9aef61.json` | 不删也不会进 manifest，但留着就是下次误判的种子 |
| `assets/.cache/slices/感謝のコントレイル-9aef61.json` | 同上 |

删源目录 **先于** `pnpm assets scan`——`scan` 的输入就是 `songs/` 的实际内容。
`assets/manifest.private.json` 是删除前唯一能查到那 6 个 `sliceId` 的地方，
**必须在重跑 manifest 之前把它们抄下来**，否则孤儿切片就找不回来了。

### 一致性回归

`app.test.ts` 断言 `/api/library` 的 `songs` 数，`library.ts` 的 `LIBRARY` 是前端写死的
同一个数——两者对不上时前端会显示一个和服务端不一致的曲库规模。这两处必须同批改。

`planSlices.test.ts` 的「最长曲（617.8s）」用例失去了它的实测依据。
删掉该曲后全库最长是 **378.12s**（`叶を纏う光 -become the brave-`）。
用例不删——「长曲的切片要铺开在全曲」这条性质仍然要守——改成用新的最长时长，
注释同步换成新的曲名与秒数。

---

## Rollback

- R1 / R2 / R4：普通 `git revert`，无数据迁移。
- R3 的代码/文档面同样 `git revert`。素材面**不可逆**：`songs/` 与 `assets/` 都在
  `.gitignore` 里，删掉的 mp3 只能从原始素材来源重新取回，重跑 `pnpm assets all`
  会给它生成**新的** `sliceId`。执行前把待删的源目录先移到仓库外的临时位置，
  确认整轮验收通过后再真删。
