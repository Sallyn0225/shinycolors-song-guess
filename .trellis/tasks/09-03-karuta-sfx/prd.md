# 联机歌牌音效

## Goal

给联机歌牌屏补上音效反馈，并把整个音效层从"下载素材再解码"换成**运行时程序化合成**：
现有的 CC0 素材包效果不理想，改由 Web Audio 直接生成波形，音色自己定、随时可调。

## Background

- `apps/web/src/sfx.ts` 现在是 `fetch('/sfx/<name>.m4a')` + `decodeAudioData` + 缓存，
  六个逻辑名：`click / correct / wrong / tick / go / fanfare`，素材来源见
  `apps/web/public/sfx/CREDITS.md`（Kenney UI Audio + Interface SFX Pack 1，CC0）。
- 这套音效目前只服务单人流程：`Button`/`IconButton` 的 click、`Play` 的对错、
  `ReadyCountdown` 的 tick/go、`Result` 的 fanfare、`Records` 的 click。
- **联机歌牌屏 `Karuta.tsx` 里一次 `sfx.play` 都没有** —— 抢牌、送札、开局、结算、
  对手掉线，全程无声。而抢牌恰恰是这个项目里最需要即时听觉反馈的动作。
- 素材路径还有一个结构性问题：首次播放要等一次网络往返 + 解码。抢牌音必须零延迟，
  第一次抢牌就晚一拍是最糟的时机。

## Requirements

### R1 音效引擎改为程序化合成

- `sfx.ts` 的内部实现换成 Web Audio 合成（振荡器 + 噪声 + 包络 + 滤波），
  不再 `fetch` 任何音频文件。
- **对外 API 保持不变**：`play(name)`、`setMuted(on)`、`setSfxOn(on)`、`get sfxOn`。
  现有 7 处调用点（`Button`、`IconButton`、`Footer`、`InfoModal`、`Play`、`Records`、
  `Result`、`ReadyCountdown`）不需要改动，除非要换更贴切的音色名。
- 保持既有的三条硬约束：单例、绝不进 React state；走 `audio.bypass` 而非 master/analyser；
  播放 fire-and-forget，任何一步失败只是少一声，绝不抛错阻断交互。
- `play()` 增加一个可选的延迟参数，用于同一拍里的第二声错峰（见 R3）。
- 六个现有逻辑名全部保留并重新调音；新增名见 R3。

### R2 删除素材并同步法务文档

- 删除 `apps/web/public/sfx/` 下的 6 个 `.m4a` 与 `CREDITS.md`。
- 同步更新引用它们的文档：`LICENSE`（第 11、13-14 行）、`NOTICE`（第 38-39 行）、
  `.trellis/spec/web/frontend/index.md`（第 17 行，顺便修掉那里写的 `*.wav` —— 
  实际早已是 `.m4a`）。
- 更新后的表述：界面音效由代码在运行时合成，不含任何第三方素材，因此不再有
  需要单独署名的资源。

### R3 联机歌牌屏接入音效

按事件覆盖三组（已确认的范围，**不包含**回合起播倒计时与起播音 —— 那会与正在播的
题目音频抢听觉带宽）：

| 组 | 事件 | 音效 |
|---|---|---|
| 抢牌反馈 | 我方判定 `correct` | `take` 清脆上行 + 拍击瞬态 |
| | 我方判定 `wrong` / `otetsuki_karafuda` / `too_early` | `otetsuki` 低沉钝响 |
| | 对手取走了这张（`winner === foe`） | `foeTake` 极轻的中性提示 |
| 牌面变化 | `roundResult.transfers` 非空 | `okuri` 轻扫频"嗖" |
| | 进入挑送り札阶段（`roundReveal`） | `okuri`（同音色，提示该你动手了） |
| 对局节点 | Karuta 挂载 / `matchStart` | `matchStart` |
| | `matchEnd`：我方胜 / 负 / 平 | `win` / `lose` / `draw` |
| 对手事件 | `peer{online:false}`（掉线） | `peerOff` 下行双音 |
| | `peer{online:true}`（重连） | `peerOn` 上行双音 |

- 同一拍里最多出两声，第二声用 `play(name, delayMs)` 错开约 180ms
  （判定音先出、牌面移动音后出，顺序与视觉变化一致）。
- 重连恢复（`stateSync`）不补播任何漏掉的音效 —— 迟到的音效比没有更糟。
- 所有接入点都必须尊重 `sfxOn` / `muted` 开关（引擎内部已统一处理，接入点不做判断）。

### R4 音色与项目气质一致

- 整体走"玻璃/棱镜"质感：短、干净、少混响感，避免游戏机式的方波刺耳感。
- 每个音效峰值配平在同一水平（母带思路照旧：响度在定义处一次配平，
  不在调用点逐个调），总线增益 `SFX_GAIN = 0.5` 不变。
- 反馈音必须盖过 BGM，又不该盖过正在播的题目音频。
- 抢牌音（`take` / `otetsuki`）允许带轻微随机化（音高 ±2%），避免连续回合听起来像机械重复。

## Constraints

- `apps/web/src/audio.ts`、`net/ws.ts`、`api.ts`、`src/features/*` 是禁区
  （`.trellis/spec/web/frontend/index.md`）。`sfx.ts` 只通过既有的 `audio.bypass`
  取 ctx 与 destination，不新增对 `audio.ts` 的任何要求。
- 合成必须只用标准 Web Audio 节点，iOS Safari 可用；不引入任何新依赖。
- AudioContext 未被用户手势解锁时静默放弃（现状行为，保持）。

### 与 `09-03-pvp-exit-flow` 的顺序关系

「对手主动退出」的提示音依赖那个任务新增的 `peerLeft` 消息。**本任务不等待它**：
先只挂 `peer{online:false}`（`peerOff`）。若 `09-03-pvp-exit-flow` 已经合入，
则一并把 `peerLeft` 也挂到 `peerOff` 上（同一音色，不新增）。两个任务在
`Karuta.tsx` 里改的是不同区块，冲突面很小。

## Acceptance Criteria

- [ ] `apps/web/public/sfx/` 目录已删除，代码里没有任何 `/sfx/` 请求；
      Network 面板在整局游戏中不出现音效相关请求。
- [ ] 首次点击按钮就有声，无首播延迟（合成没有下载解码阶段）。
- [ ] 单人流程的音效全部照常：按钮 click、`Play` 的对错、倒计时 tick/go、
      结算页 fanfare、`Records` 的 click。
- [ ] 联机对局中 R3 表里每一行都能实际听到，且与画面变化同拍。
- [ ] 首页音效开关关闭后，联机全程静音；静音（mute）同样让音效消失。
- [ ] 连续多个回合的抢牌音不出现明显的机械重复感。
- [ ] `LICENSE`、`NOTICE`、`.trellis/spec/web/frontend/index.md` 中关于 `public/sfx/`
      的表述已更新，仓库内不再有指向已删除文件的引用。
- [ ] `pnpm -r typecheck`、`pnpm -r test` 全绿；音色定义表有单元测试覆盖
      （每个音效名有定义、参数在合理区间、峰值配平一致）。

## Out of Scope

- 不做音效音量的独立滑杆（现有 `sfxOn` 开关 + 全局静音已够）。
- 不给单人 `Play` 屏增加新事件音效。
- 不做回合起播倒计时 / 起播音（明确排除，见 R3）。
- 不做 BGM / 氛围音的任何改动（`ambience.ts` 不动）。
