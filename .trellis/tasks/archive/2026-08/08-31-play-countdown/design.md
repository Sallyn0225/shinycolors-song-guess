# design — 单机开局 3-2-1 倒计时缓冲

## 状态机改动（`screens/Play.tsx`）

现有 Phase：`'loading' | 'answering' | 'revealed' | 'error'`。插入 `'countdown'`，**只对 index 0 走**：

```
loading ──(题已取 + 切片已解码)──► countdown ──(3s 走完)──► begin → answering
   │                                    │
   └────── index > 0：直接 begin → answering ──┘
```

改动点全在载入 effect 的 async 链里：

```
await audio.prefetch(...)          // 已有
if (index === 0) {
  phaseRef.current = 'countdown'
  setPhase('countdown')
  await countdown(3)               // 新：3 tick + go，见下
}
const { deadlineMs } = await api.begin(...)   // 已有，位置不变——在倒计时之后
```

关键不变量：**`api.begin` 仍紧贴 `answering` 起表**，倒计时插在它前面，服务端 deadline 语义零变化。倒计时后 begin 的网络往返（本地 <50ms）会让「1」落地到起播有百毫秒级空隙——可接受，不追求采样级衔接（这不是 1v1 的抢牌判定）。

## 倒计时实现

不用 rAF（`ui/Countdown.tsx` 的 rAF 直写是为**跟随**服务端时钟的连续读数；这里是固定 3 步的离散节奏，`setInterval`/递归 `setTimeout` 更直白）。用一个 ref 持有定时器、cleanup 里清掉，退出本局时随 effect cleanup 自然撤销。

新组件 `ui/ReadyCountdown.tsx`：

- Props: `seconds?: number`（默认 3）、`onDone: () => void`、`label: string`。
- 内部 `useState(n)` 每秒 -1；每格换数字时 `sfx.play('tick')`（除最后一格之后接 `onDone` 前的 go 由 Play 播还是组件播？——**组件播 go**，让 Play 不必知道音效细节）。
- 视觉：绝对定位铺满 Play 主区，居中 latin 大数字（`fontSize: calc(96 * var(--u))` 量级，落地时对照 `.sc-title` 语言再定），每格一次 `num.animate()` 缩放淡入冲量（同 Countdown 的冲量做法），reduced-motion 跳过 animate。
- a11y：`role="timer"` + `aria-label`（「即将开始，N 秒」）。
- Play 渲染条件：`phase === 'countdown'` 时盖在选项区上（选项此时还没渲染——question 已 set 但 `phase !== 'answering'`，选项条本身有 disabled，保持现有条件不动，只叠倒计时层在 revealslot/选项区位置）。

`phaseRef`/`Phase` 类型、`getRemaining`（`'countdown'` 走 1，同 loading——光带满格）同步补类型分支。

## 音效衔接

- tick / go 直接 `import { sfx } from '../sfx'`，静音与开关逻辑全在 sfx 层，本任务不再碰。
- 起播顺序：go 响 → `audio.play` 切片。go 很短（<200ms），与起播重叠听感是「出发」，符合预期。

## 不改的东西

- 服务端、`api.ts`、`audio.ts`：零改动。
- `Countdown.tsx`（答题主计时）：不共用组件——那个是为连续读数 + 服务端时钟抖动钳制设计的，这里是固定三步节奏，共用会把两套约束搅在一起。
- Karuta 的 memorize 倒计时：1v1 的记忆阶段已有自己的节奏（服务端 `memorizeEndsAtServer`），不动。

## Rollback

`ReadyCountdown.tsx` 新文件 + Play.tsx 的 phase 分支 diff，回滚即删。无数据、无服务端迁移。
