# 执行计划 — 联机歌牌音效（程序化合成）

先读 `prd.md` → `design.md`。禁区：`apps/web/src/audio.ts`、`net/ws.ts`、`api.ts`、
`src/features/*`。`sfx.ts` 只从 `audio.bypass` 取 ctx/destination，**不要**为了这个任务
去给 `audio.ts` 加任何东西。

## 步骤 1 — 音色定义表

- [ ] 新建 `apps/web/src/sfxVoices.ts`：`Part` / `Voice` / `SfxName` 类型 + `VOICES` 表，
      参数照 design.md 的表落地。文件头写清楚"这是设计决定的数据，不是机制"。
- [ ] 新建 `apps/web/src/sfxVoices.test.ts`：
      - 每个 `SfxName` 在 `VOICES` 里都有定义，且 `parts` 非空；
      - 所有 `gain > 0`（指数斜坡不能收到 0）；
      - 每个 voice 的 `parts` gain 之和 ≤ 0.7（响度配平）；
      - 每个 part 的 `dur > 0`、`at >= 0`，总时长 ≤ 1s（音效不是音乐）；
      - 非 `sine` 的 tone 都配了 `lowpass`（去毛刺）。

验证：`pnpm --filter @scg/web test`

## 步骤 2 — 渲染器

- [ ] 重写 `apps/web/src/sfx.ts` 的内部：删 `buffers` / `pending` / `ensureBuffer` / `fetch`，
      新增 `renderPart` 与共享白噪 buffer 的懒建。
- [ ] `SfxName` 从 `sfxVoices.ts` re-export（现有调用点的 import 路径不变）。
- [ ] `play(name, delayMs = 0)`：延迟走 `ctx.currentTime`，不用 `setTimeout`。
- [ ] 保留并更新文件头注释：为什么走 bypass、为什么是单例、为什么 fire-and-forget、
      `SFX_GAIN = 0.5` 的理由。把"AAC 而不是 WAV"那段换成"为什么不再用素材"。
- [ ] 每个 part 的终端节点 `onended` 里 `disconnect()`。

验证：`pnpm --filter @scg/web typecheck`，然后 `pnpm --filter @scg/web dev`
在浏览器里逐个试听（可临时在控制台 `window.__sfx = sfx` 手动触发，**提交前删掉**）。
听感不对就回到步骤 1 调表，不要在渲染器里加特例。

## 步骤 3 — 删素材与法务文档

- [ ] 删除 `apps/web/public/sfx/`（6 个 `.m4a` + `CREDITS.md`）。
- [ ] `LICENSE`：第 11 行的例外列表去掉 `apps/web/public/sfx/`；第 13-14 行那条
      CC0 例外整条删除。
- [ ] `NOTICE`：第 38-39 行改为"界面音效由代码在运行时合成（`apps/web/src/sfx.ts`），
      不含第三方素材"。
- [ ] `.trellis/spec/web/frontend/index.md` 第 17 行：`public/sfx/*.wav (CC0, see CREDITS.md)`
      → 程序化合成 + 指向 `sfxVoices.ts`。
- [ ] `grep -rn "public/sfx" .` 复查：只允许 `.trellis/tasks/archive/` 下的历史归档命中。

## 步骤 4 — Karuta 接入

- [ ] `apps/web/src/screens/Karuta.tsx` 按 design.md 的接入表加 `sfx.play`：
      挂载 / `roundReveal` / `roundResult`（含判定分支与 180ms 错峰）/ `matchEnd` / `peer`。
- [ ] `stateSync` 分支不加音效。
- [ ] 若 `09-03-pvp-exit-flow` 已合入：`peerLeft` 分支也播 `peerOff`（同音色，不新增）。
      若未合入，跳过，不要为它预留死代码。

验证：`pnpm --filter @scg/web typecheck` → `pnpm -r test`

## 步骤 5 — 走查

两个浏览器窗口开一局：

1. 单人流程回归：首页按钮 click、`Play` 对错、倒计时 tick/go、结算 fanfare、
   `Records` 的 click —— 全部有声且不刺耳。
2. **首播无延迟**：清缓存刷新后第一次点按钮就有声；Network 面板全程无 `/sfx/` 请求。
3. 联机：开局音 → 抢牌成功 `take` / 手误 `otetsuki` / 被对手抢走 `foeTake` →
   有送札的回合听到 `okuri` 且在判定音之后 → 结算 `win`/`lose`。
4. 连续 5 个以上回合的抢牌音不觉得机械重复。
5. 一方拔网线：对手侧听到 `peerOff`；重连听到 `peerOn`。
6. 首页关掉音效开关 → 联机全程静音；打开静音（mute）→ 同样静音；
   两个开关互不干扰（正交）。
7. 音效响度：BGM 开着时反馈音听得清，题目音频播放时反馈音不盖过人声。

## 复查门（提交前）

- [ ] `audio.ts` / `net/ws.ts` / `api.ts` / `features/*` 的 diff 为空。
- [ ] 代码里没有 `fetch('/sfx` 残留，没有临时的 `window.__sfx` 调试挂载。
- [ ] `VOICES` 表里每个音色都实际被某个调用点用到（没有写了没接的死音色）。
- [ ] 长局（10+ 回合）后 DevTools 内存面板无明显 AudioNode 累积。

## 回滚点

步骤 1-2（引擎）与步骤 4（接入）是两个独立提交点；步骤 3 的删除单独一个提交，
这样"音色不满意想先回到素材版"时只需回退两个提交，接入点的改动可以保留。
