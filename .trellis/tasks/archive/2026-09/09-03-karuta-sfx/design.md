# 技术设计 — 联机歌牌音效（程序化合成）

## 边界

| 文件 | 改动 |
|---|---|
| `apps/web/src/sfxVoices.ts` | **新增** —— 纯数据的音色定义表 + 类型（无 AudioNode，可单测） |
| `apps/web/src/sfxVoices.test.ts` | **新增** —— 定义表的约束测试 |
| `apps/web/src/sfx.ts` | 内部实现换成合成渲染器；对外 API 只增一个可选参数 |
| `apps/web/src/screens/Karuta.tsx` | 接入点（判定、牌面、对局节点、对手事件） |
| `apps/web/public/sfx/` | 删除 |
| `LICENSE` / `NOTICE` / `.trellis/spec/web/frontend/index.md` | 表述更新 |

拆两个文件的理由：音色参数是**设计决定**，会被反复调；渲染器是**机制**，一次写对就不动。
混在一起会让每次调音都在动一个跑着 AudioNode 生命周期管理的文件。
定义表是纯数据，`vitest` 在 jsdom 里跑不了 Web Audio，但跑得了这张表。

放 `src/` 顶层而不是 `src/features/` —— `features/*` 是禁区目录（编码了生产环境修复），
新增文件进去会让"这个目录不要动"这条规矩出现例外。

## 音色的数据模型（`sfxVoices.ts`）

```ts
/** 一段音由若干 part 叠加而成；每个 part 是一条独立的信号链 */
export type Part =
  | {
      kind: 'tone'
      wave: OscillatorType          // 'sine' | 'triangle' | 'square' | 'sawtooth'
      /** 单值 = 定频；[from, to] = 在 dur 内滑到目标频率 */
      freq: number | [number, number]
      /** 相对这一声起点的偏移，秒 */
      at: number
      dur: number
      /** 峰值增益（配平后的绝对值，调用点不再乘系数） */
      gain: number
      /** 起音时间，秒。默认 0.004 —— 一律给一点，硬切会爆音 */
      attack?: number
      /** 低通截止，给方波/锯齿去毛刺 */
      lowpass?: number
    }
  | {
      kind: 'noise'
      at: number
      dur: number
      gain: number
      /** 带通中心频率；[from,to] 则在 dur 内扫频 */
      band?: number | [number, number]
      q?: number
      /** 高通，用于做"拍击"瞬态 */
      highpass?: number
    }

export interface Voice {
  parts: Part[]
  /** 音高随机化幅度（比例）。0.02 = ±2%。默认 0 */
  jitter?: number
}

export type SfxName =
  // 既有（调用点已存在，名字不能改）
  | 'click' | 'correct' | 'wrong' | 'tick' | 'go' | 'fanfare'
  // 联机新增
  | 'take' | 'otetsuki' | 'foeTake' | 'okuri'
  | 'matchStart' | 'win' | 'lose' | 'draw'
  | 'peerOn' | 'peerOff'

export const VOICES: Record<SfxName, Voice> = { ... }
```

### 参数表（起始值，实施时按耳朵微调；结构不要改）

音高体系统一到 D 大调族（D=587 / F#=740 / A=880 / D'=1175），
这样不同事件的音效互相之间是协和的，连着响不会打架。

| 名 | parts | 意图 |
|---|---|---|
| `click` | tone(triangle, 2000, at 0, dur .035, gain .10, lowpass 4000) | 极短一"嗒"，按钮必须轻 |
| `tick` | tone(square, 1200, at 0, dur .030, gain .09, lowpass 3000) | 倒计时秒针，比 click 更干 |
| `go` | tone(sine, [660, 990], at 0, dur .18, gain .22) | 上滑起跑 |
| `take` | noise(at 0, dur .012, gain .16, highpass 3000) + tone(sine, 880, at .005, dur .12, gain .26) + tone(sine, 1320, at .045, dur .16, gain .16) | 拍击瞬态 + 两段上行，jitter .02 |
| `correct` | tone(sine, 880, .00, .14, .24) + tone(sine, 1320, .05, .16, .18) + tone(sine, 1760, .10, .22, .12) | 单人揭晓，比 take 多一段、更"完成" |
| `otetsuki` | noise(0, .02, .18, band [1200,300], q 1.2) + tone(sawtooth, [220,150], .01, .24, .20, lowpass 900) + tone(sine, [110,80], .01, .28, .14) | 钝、闷、往下掉，jitter .015 |
| `wrong` | tone(sawtooth, [240,170], 0, .22, .20, lowpass 1100) + noise(0, .010, .12, highpass 1500) | 单人版，比 otetsuki 轻一点 |
| `foeTake` | tone(sine, 740, 0, .09, .08) | 极轻，只说"被抢了"，不抢注意力 |
| `okuri` | noise(0, .14, .10, band [700, 2400], q 2.0) | 一声"嗖"，牌在移动 |
| `matchStart` | noise(0, .02, .10, highpass 2000) + tone(sine, 587, .01, .18, .18) + tone(sine, 880, .10, .30, .16) | 开场，克制的两音上行 |
| `win` | tone(sine, 740, 0, .16, .22) + tone(sine, 880, .09, .16, .20) + tone(sine, 1175, .18, .45, .18) + tone(triangle, 1480, .18, .45, .07) | 大三度上行琶音 |
| `lose` | tone(sine, 740, 0, .18, .18) + tone(sine, 587, .12, .40, .18) + tone(sawtooth, 293, .12, .40, .06, lowpass 700) | 小三度下行，收得干净 |
| `draw` | tone(sine, 740, 0, .30, .18) + tone(sine, 880, 0, .30, .12) | 平行两音，不上不下 |
| `fanfare` | tone(triangle, 784, 0, .12, .20) + tone(triangle, 988, .09, .12, .18) + tone(triangle, 1175, .18, .50, .18) + tone(sine, 2350, .18, .50, .05) | 单人结算，保留现有语气 |
| `peerOn` | tone(sine, 660, 0, .08, .12) + tone(sine, 880, .09, .10, .12) | 上行双音 = 回来了 |
| `peerOff` | tone(sine, 880, 0, .08, .12) + tone(sine, 660, .09, .14, .12) | 下行双音 = 走了 |

配平规则：**同一声内所有 part 的 gain 之和不超过 0.7**。这是母带思路的延续 ——
响度在定义处一次配平，运行时和调用点都不再乘系数。`sfxVoices.test.ts` 断言这一条。

## 渲染器（`sfx.ts`）

对外只多一个可选参数：

```ts
play(name: SfxName, delayMs = 0): void
```

`delayMs` 用 `ctx.currentTime + delayMs/1000` 精确调度，不用 `setTimeout` ——
音频时钟与主线程时钟是两回事，180ms 的错峰用 setTimeout 会被一次 GC 拉成 300ms。

内部结构（保留现有的 bus / 开关 / fire-and-forget 骨架，替掉 fetch+decode）：

```
play(name, delayMs):
  if (!on || muted) return
  const bypass = audio.bypass; if (!bypass) return
  try {
    ensureBus(ctx)                        // 固定增益 SFX_GAIN=0.5 的总线，首次出声时建，常驻
    const t0 = ctx.currentTime + delayMs/1000
    const voice = VOICES[name]
    const k = voice.jitter ? 1 + (Math.random()*2-1)*voice.jitter : 1
    for (const part of voice.parts) renderPart(ctx, bus, part, t0, k)
  } catch { /* 少一声，不是错误 */ }
```

`renderPart`：

- **tone**：`OscillatorNode` → （可选 `BiquadFilterNode` lowpass）→ `GainNode` → bus。
  - 频率：定值用 `setValueAtTime`；`[from,to]` 用 `exponentialRampToValueAtTime`
    （频率恒正，指数滑音才自然）。
  - 包络：`gain.setValueAtTime(0.0001, t0)` →
    `linearRampToValueAtTime(peak, t0+attack)` →
    `exponentialRampToValueAtTime(0.0001, t0+dur)`。
    **指数斜坡的目标值不能是 0**，这是 Web Audio 的经典坑：传 0 会让整条曲线失效
    （在部分实现里直接抛 `RangeError`），必须收到 0.0001 再 `stop`。
  - `osc.start(t0)` / `osc.stop(t0+dur+0.02)`，`onended` 里 `disconnect()`。
- **noise**：`AudioBufferSourceNode`，buffer 是**一份共享的 1 秒白噪**（懒建一次、常驻）。
  每次播放随机取一个起点偏移，`playbackRate` 恒 1，链路
  → （`bandpass` / `highpass`）→ `GainNode` → bus。扫频的 `band: [from,to]`
  用 `filter.frequency.exponentialRampToValueAtTime`。
- 每次调用都建新节点、绝不复用：`AudioBufferSourceNode` / `OscillatorNode` 都是一次性的，
  stop 过再 start 会抛。这条与现有实现的注释一致，别在重写时丢掉。

删掉：`buffers` / `pending` 两个 Map、`ensureBuffer()`、`fetch`。
保留：`SFX_GAIN` 常量与它上面那段"为什么是 0.5"的注释（合成后依然成立）。

## Karuta 接入点

| 位置 | 触发 | 调用 |
|---|---|---|
| 组件挂载（`initialMatch` effect） | 进入牌场 | `sfx.play('matchStart')` |
| `case 'roundReveal'` | 进入挑送り札 | `sfx.play('okuri')` |
| `case 'roundResult'` | 见下方判定 | `take` / `otetsuki` / `foeTake`（+ `okuri` 延后 180ms） |
| `case 'matchEnd'` | 结束 | `winner === me ? 'win' : winner ? 'lose' : 'draw'` |
| `case 'peer'` | 上下线 | `msg.online ? 'peerOn' : 'peerOff'` |

`roundResult` 的判定（`me = match.you`）：

```ts
const mine = msg.result.taps.find((t) => t.player === me)
if (mine?.verdict === 'correct') sfx.play('take')
else if (mine && (mine.verdict === 'wrong' || mine.verdict === 'otetsuki_karafuda'
                  || mine.verdict === 'too_early')) sfx.play('otetsuki')
else if (msg.result.winner && msg.result.winner !== me) sfx.play('foeTake')
// 牌面有移动就再补一声，错开 180ms，顺序与视觉一致
if (msg.result.transfers.length > 0) sfx.play('okuri', 180)
```

`too_late` / `tie` / `clamped` / `none` 不出声：这几种要么是"你没赶上"，
要么是判定被校正 —— 给一个明确的音反而是在陈述一件玩家无法据此改变行为的事。

`stateSync`（重连）分支**不加任何 `sfx.play`**。

## 兼容性与回滚

- 对外 API 不变，7 个既有调用点零改动，只是听感变了。
- 无新依赖、无构建改动；`scripts/precompress.mjs` 少压 6 个文件，不需要改。
- 回滚 = 还原 `sfx.ts`、删两个新文件、`git checkout` 回 `public/sfx/` 与三份文档。

## 风险

| 风险 | 处置 |
|---|---|
| 指数斜坡传 0 导致整声消失或抛错 | 统一收到 0.0001；`sfxVoices.test.ts` 断言所有 gain > 0 |
| 合成音听感刺耳（方波/锯齿高频毛刺） | 所有非正弦 part 强制配 `lowpass`；表里已给默认值 |
| 连续回合抢牌音机械重复 | `jitter` 音高随机化；验收项里专门走查 |
| 节点泄漏（每声都建新节点） | 每个 part 的终端节点在 `onended` 里 `disconnect()`；长时间对局后用 DevTools 内存面板抽查 |
| 一拍两声导致响度叠加过头 | 错峰 180ms + 定义表的 0.7 峰值上限 |
| 删素材漏改法务文档 | 实施后 `grep -r "public/sfx"` 必须只剩历史任务归档命中 |
