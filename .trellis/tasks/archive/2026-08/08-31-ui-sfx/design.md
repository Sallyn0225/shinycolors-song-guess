# design — 核心交互音效系统

## Boundaries

**禁区（spec 硬约束）**：`src/audio.ts`、`src/api.ts`、`src/net/ws.ts`、`src/features/*` 一律不改。音效层完全沿用 `ambience.ts` 已趟出来的路：共用 AudioContext、不共用信号链。

## 模块：`src/sfx.ts`

```
audio.bypass ──► sfx bus (GainNode, SFX_GAIN) ──► ctx.destination
                     ▲
   解码缓存 Map<name, AudioBuffer> ── bufferSource（一次性，短促）
```

- 单例 `class Sfx`，导出 `export const sfx = new Sfx()`。绝不进 React state（同 audio/ambience 的规矩）。
- `play(name: SfxName)`：fire-and-forget。内部 `void` 异步链，所有异常吞掉。
  - `audio.bypass` 为 null（未解锁）→ 直接返回（倒计时 tick 等场景首屏手势后必然已解锁，不需要等待机制）。
  - 未解码过 → fetch `/sfx/<file>` + `decodeAudioData`，缓存进 Map；在途去重。
  - 解码完成后 `createBufferSource` 一次性播放，`onended` 里 disconnect。
- 每类音效一个固定响度系数（在文件选择/母带时统一，不在运行时逐个调）。

### 开关与静音

三个正交条件（同 ambience 的合取模式）：

```ts
shouldPlay = enabled(常 true，由屏幕驱动？否——UI 音效全屏都在) && !muted && sfxOn
```

实际两个条件就够：`!muted && sfxOn`。UI 音效不随屏幕启停——按钮在哪都有，跟 ambience 的 `enabled` 语义不同，不需要 `setEnabled`。

- `setMuted(on)`：VolumeControl.commit 与 main.tsx 两处显式同步（全项目已知调用点，注释写明同 ambience 的规矩）。
- `setSfxOn(on)`：首页开关写；prefs 加 `sfxOn` 字段。
- `sfxOn` getter：控件初值从单例读，不从 localStorage 读（引擎是运行时唯一真相）。

### prefs.ts 扩展

`AudioPrefs` 加 `sfxOn: boolean`。读法沿用 `bgmOn` 的兼容写法：`bgmOn !== false` 同款 `sfxOn !== false`（缺字段回落默认开）。写仍走字段级 `saveAudioPrefs({ sfxOn })`。

### main.tsx

`loadAudioPrefs()` 之后补一行 `sfx.setMuted(prefs.muted)`、`sfx.setSfxOn(prefs.sfxOn)`。

## 资源

- 下载 Kenney UI Audio zip，挑 WAV 文件，放 `apps/web/public/sfx/`。候选映射（实施时按实际文件名微调）：

| 逻辑名 | Kenney 候选 | 说明 |
|---------|-------------|------|
| click | click (low/soft) | 所有按钮 |
| correct | confirmation_001 类上行确认 | 揭晓正解 |
| wrong | error 类低沉音 | 揭晓不正解 |
| tick | glass/pluck 类短音 | 3-2-1 每秒 |
| go | confirmation 高一点/起始音 | 起跑 |
| fanfare | victory/最长一段 | 结算进场（选克制的，不做长奏） |

- `apps/web/public/sfx/CREDITS.md`：逐文件记录来源（kenney.nl/assets/ui-audio）、许可 CC0 1.0、下载日期。
- 文件格式保持 WAV（原生解码零兼容问题，单个 <30KB 不值得再压）。

## 接线点（全部是「播放方」，不新建组件）

| 位置 | 做法 |
|------|------|
| `ui/Button.tsx` | 不改共享组件（会波及所有 variant 语义）；在**调用点**包 `sfx.play('click')`？—— 反向决定：**在 Button 内部 onClick 前置一声 click 是最省的**，但 Button 是共享件，OptionBar 的答题点击会经它吗？不会——OptionBar 是独立 `<button>` 不用 Button。Karuta 的「记好了」用 Button，加 click 音无碍。**定：Button 内部接线**（包一层 onClick），代价最小、覆盖一致。`type="button"` 的 tap-line 文字链接（退出本局等）**不**加——它是次级动作，声音留给主操作。 |
| `ui/IconButton.tsx` | 同 Button，内部接线。 |
| `screens/Start.tsx` EntryBar | 自绘 button，在 onClick 里补一声 click。 |
| `screens/Play.tsx` | submit 的结果回来后（`r.correct`）播放 correct/wrong；超时按 wrong。 |
| `screens/Result.tsx` | 挂载后播一次 fanfare（在 `useEffect` 里，注意 StrictMode 双跑会响两声——用 ref 守卫或放 Prefetch 之后）。 |
| play-countdown 任务 | 调 `sfx.play('tick')` / `sfx.play('go')`，本任务只保证 API 存在。 |

StrictMode 双跑守卫：Result 的 fanfare 用 `useRef(false)` 守卫（挂载即播，属一次性欢迎音，dev 双挂载只该响一次）。

## Trade-offs

- **音效不受音量滑杆管**：滑杆语义是「题目音频响度」（见 VolumeControl 注释），BGM 已是固定增益先例；音效同理固定，母带时压到「听得见但不抢」。
- **不做 Karuta 抢牌音**：1v1 注意力在听与抢，音效帮倒忙；用户确认的核心范围也不含它。
- **懒解码而非预取**：首屏不背 6 个文件的请求；第一次 click 音可能在解锁当次晚 10ms 出现——可接受。倒计时 tick 之前点击难度那次手势已经把 click 解码好了，天然预热。

## Rollback

单文件模块 + 接线点各自独立，回滚 = 删 `sfx.ts`、还原接线点 diff、删 `public/sfx/` 与 prefs 字段。无数据迁移（localStorage 缺字段回落默认）。
