# 单机计分加入速度奖励宽限期

## Goal

为单机模式速度奖励加入 1.5 秒宽限期：每题起播后的前 1.5 秒内速度分不衰减，给用户听歌反应时间，使最高段位在正常反应速度下可达。

## Background

当前 `scoreAnswer()` 从题目下发（`servedAt`，即音频起播）那一刻开始线性推进衰减比例：

```ts
const ratio = elapsedMs / limitMs
const left  = clamp(0, 1 - ratio, 1)
const speed = SCORING.speedBonus * left ** (1 / SCORING.speedCurve)   // speedCurve = 1.6
```

由此产生两个问题：

1. **最高段位实际不可达。** 「高山祐介」需要得分率 ≥ 0.95，即单题 `speed ≥ 90`。反推 `left ≥ 0.9 ** 1.6 ≈ 0.845`，即 `ratio ≤ 0.155`：
   - 困难（`answerSeconds = 10`）→ 必须 **1.55 秒** 内作答，而 `clipSeconds = 6`，等于只听到四分之一片段就要点下去；
   - 简单（`answerSeconds = 15`）→ 2.3 秒。

   听歌辨识本身需要若干秒，全对也几乎拿不到最高评级。

2. **起播延迟被计入答题耗时。** `servedAt` 是服务端时间戳，客户端还需经历网络往返与音频解码才真正出声。网络慢的用户凭空损失速度分，这部分与其辨识能力无关。

## Requirements

### R1 速度奖励宽限期

- 在 `SCORING`（`packages/shared/src/scoring.ts`）新增 `speedGraceSeconds: 1.5`，并写清取值依据与「为什么是固定值而非比例」的意图注释。

  > 命名遵循 `.trellis/spec/shared/backend/tuning-constants.md` 的约定：调参常量用**人调参的单位（秒）**声明，毫秒转换在消费端做。故不用 `graceMs: 1500`。

- `scoreAnswer()`（`packages/game-core/src/scoring.ts`）在宽限期内不衰减速度分，宽限期结束后在**剩余窗口**上按原曲线衰减：

  ```ts
  const graceMs = SCORING.speedGraceSeconds * 1000
  const window  = limitMs - graceMs
  const ratio   = window > 0 ? (elapsedMs - graceMs) / window : (elapsedMs > limitMs ? 1 : 0)
  ```

- 宽限期取**固定值**，不随 `limitMs` 按比例缩放。人的反应时间是绝对量，不会因为限时从 15s 缩到 10s 而跟着变短。

### R2 不改动的部分

以下均**不在本次范围内**，避免多个变量同时改动导致无法判断哪一项起了作用：

- `SOLO_TIERS` 段位阈值（`apps/web/src/features/grade.ts`）保持不变 —— 宽限期让 100% 得分率重新可达后，0.95 不再是死线，改阈值属于治标。
- 重听机制（`REPLAY_PAUSES_TIMER`、`SCORING.replayPenalty`）保持不变 —— 与反应时间是两套独立取舍。
- `SCORING.base` / `speedBonus` / `speedCurve` 保持不变，`maxScore()` 因此不受影响。
- 倒计时 UI 不做「聆听中」等宽限期可视化。

### R3 边界行为

- `limitMs <= graceMs`（含 `limitMs = 0`）时衰减窗口为 0 或负，不得出现除零、`NaN` 或 `Infinity`。此时没有「快慢」可分，只剩「赶上了没有」：`elapsedMs <= limitMs` 拿满速度分，超时拿 0。
  - 这条同时保住既有断言「`limitMs = 0` 时 `total === SCORING.base`」——`limitMs = 0` 下任何 `elapsedMs > 0` 都算超时。
- `elapsedMs` 超过 `limitMs`（含服务端 1500ms 超时宽限内的迟到作答）时 `speed` 不得为负。
- 速度分对 `elapsedMs` 保持**单调不增**。

## Acceptance Criteria

- [ ] `SCORING.speedGraceSeconds === 1.5`，且注释带有取值依据与被否决的候选值。
- [ ] `elapsedMs <= 1500` 时 `speed === SCORING.speedBonus`（满速度分），`total === base + speedBonus`。
- [ ] `elapsedMs = 1500 + ε` 时 `speed < speedBonus`（宽限期不会悄悄变宽）。
- [ ] `elapsedMs === limitMs` 时 `speed === 0`，`total === SCORING.base`（原有行为不回退）。
- [ ] 困难模式（`limitMs = 10_000`）下 `elapsedMs = 2800` 时得分率 ≥ 0.95，即最高段位在平均 2.8 秒作答时可达。
- [ ] `limitMs = 0` 与 `limitMs = 1000`（小于宽限期）时结果有限且不为负，按 R3 的「赶上了没有」规则给分。
- [ ] `elapsedMs = limitMs * 3` 时 `speed === 0`、`total === SCORING.base`。
- [ ] 速度分随 `elapsedMs` 单调不增的既有断言仍通过。
- [ ] `packages/game-core/src/scoring.test.ts` 中受影响的断言已更新（「瞬间答对拿满分」应扩展为覆盖整个宽限区间），并补充上述新增用例。
- [ ] `pnpm -r typecheck`、`pnpm -r test` 全绿。
  > 本仓库没有 `lint` script（`pnpm -r lint` 报 `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`），验证只有这两条。
- [ ] `.trellis/spec/game-core/backend/` 下的计分说明已同步宽限期语义。

## Reference: 改动前后对照（困难模式，`limitMs = 10s`）

| 作答耗时 | 改动前 total (得分率) | 改动后 total (得分率) |
|---|---|---|
| 1.5s | 190 (95.0%) | **200 (100%)** |
| 2.0s | 187 (93.5%) | 196 (98.0%) |
| 2.8s | 181 (90.5%) | 190 (95.0%) |
| 3.0s | 180 (90.0%) | 189 (94.5%) |
| 5.0s | 165 (82.5%) | 172 (86.0%) |
| 10.0s | 100 (50.0%) | 100 (50.0%) |

最高段位（得分率 0.95）门槛：**1.62 秒 → 2.88 秒**（困难）、**2.43 秒 → 3.69 秒**（简单）。

其它候选取值的门槛（困难 / 简单）：`1.0s → 2.46 / 3.27`、`2.0s → 3.30 / 4.11`。

宽限期后剩余窗口变短，衰减反而更陡，「快 vs 慢」的区分度不降反升 —— 原设计意图（辨识速度也是考点）得以保留。

## Notes

- 计分只在服务端计算（`apps/server/src/soloSessions.ts:160`），客户端上报耗时不参与判分，故本次无需改动 `apps/web`。
- `Play.tsx:346` 仅展示 `result.score.speed`，数值由服务端下发，无需同步改动。
