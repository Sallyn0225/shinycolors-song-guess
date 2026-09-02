# 结算页 BGM 与跨屏续播

> 父任务：`.trellis/tasks/09-03-stats-and-session-fixes`（需求 U1，决策 D1 / D2）
> 轻量任务，**PRD-only**：改动集中在 `App.tsx` 的一处判断，没有新契约、没有新模块。

## Goal

让单机结算页也有环境 BGM：进结算时**淡入**（与首页/大厅同一条淡入），
结算→首页时**不重起**、直接续上正在播的那一段。背景视频的铺设范围一寸不动。

---

## 背景：今天为什么是哑的

`apps/web/src/App.tsx:210` 只有一个布尔量，同时管着两件事：

```ts
const ambient = screen.name === 'start' || screen.name === 'lobby' || screen.name === 'room'
// ...
<Backdrop video={ambient} />                       // 铺不铺背景视频
ambience.setEnabled(ambient && !resuming)          // 起不起 BGM
```

那段注释给出的理由（Play / Karuta 上「一切会动的东西都在跟听力和抢牌抢注意力」，
而且那两屏正在解码音频、跑 rAF 计时）**只对 Play 与 Karuta 成立**。
结算页既不解码音频也不抢判定，它落在 `false` 那一侧纯粹是因为搭了同一辆车。

顺带的两件事：

- 用户原文说的是「从结算页返回**大厅**」。单机结算页的两个出口是「再来一局」和「返回**首页**」
  （`App.tsx:196-198`），没有通往大厅的路，所以本任务按**返回首页**实现。续播要求一字不改。
- 父任务 D1 引入的奖杯屏 `stats` 也要 BGM 不要视频。本任务只负责**把两件事拆开**，
  `stats` 这个名字由 `09-03-local-stats-trophy` 自己加进来。

---

## Requirements

### R1 · 拆开视频与 BGM 的判断

- `App.tsx` 里那一个 `ambient` 变成两个：**`video`** 与 **`bgm`**。
  - **`video`**：`start | lobby | room`，**取值与今天完全一致**。
  - **`bgm`**：视频那三屏 **+ `result`**。
- **新变量一律不许再叫 `ambient`**。这个词在本仓库里已经被占用，且含义正是「铺着视频」：
  `ui/Backdrop.tsx:180-189` 会在铺视频时往 `<html>` 挂 `data-ambient`，
  `index.css` 的 `[data-ambient]` 靠它把 `--color-ink-faint` 压深一档
  （有视频的背景上，淡墨色文字要更深才够对比度）。
  沿用这个名字去指代 BGM，会让「ambient 为真」在 TS 里和在 CSS 里指两件不同的事。
  叫 `video` 还有一个好处：与 `<Backdrop video={...}>` 的 prop 同名，一眼看穿这条链路。
- **连带确认**：结算页不铺视频 → `data-ambient` 不会在结算页打开 →
  结算页的文字对比度与今天完全一致，本任务除 BGM 外没有任何视觉副作用。
- `<Backdrop video={...}>` 接前者，`ambience.setEnabled(...)` 接后者。
- `!resuming` 这个条件留在 BGM 那一侧不动——正在找回对局时不该起音乐，理由与今天相同。
- 那一大段注释要**改写**而不是照抄：它现在解释的是「为什么视频和 BGM 用同一个判断」，
  拆开之后必须说清两件事各自的范围与理由。留着旧话比不写更坏。

### R2 · 淡入，不是直接起播

- 进结算时 BGM 从静音处**淡入**，用的是与首页/大厅同一条淡入（`ambience.ts` 的 `FADE_IN_SEC`，2.5s）。
- **不修改 `ambience.ts`**：`start()` 本来就是 `0.0001 → BGM_GAIN` 的 `linearRamp`，
  淡入是它固有的行为，只要 `setEnabled(true)` 在结算屏被调到就有。

### R3 · 续播，不是重起

- `result` → `start`（返回首页）、`start` → `result`（再来一局打完）之间，BGM **不得**出现
  停顿、重起或音量跳变；正在播的那一段继续往下播，交叉淡化的排程不受影响。
- 这一条在现有实现下是**自然成立**的，实现时要确认而不是另写机制：
  - `useEffect` 的依赖是 BGM 那个布尔量，`result`→`start` 时它恒为 `true`，effect 根本不重跑；
  - 就算重跑，`ambience.setEnabled(true)` → `sync()` → `start()` 见 `this.bus` 非空**直接返回**
    （`ambience.ts:226`），不会重排任何东西。
- 反过来，`play` → `result` 时它 `false → true`，才会真正 `start()` 并淡入（R2）。

### R4 · 不动的东西

- 背景视频仍然只在 `start | lobby | room` 三屏（父任务 D2 / AC-P2）。
- `ambience.ts`、`audio.ts`、`sfx.ts` 不改。禁区规则见 `.trellis/spec/web/frontend/index.md`。
- 结算页的视觉、布局、导出战报一律不动。

---

## Acceptance Criteria

- [ ] **AC1**：开一局单机打完 → 结算页出现时 BGM 从无到有淡入，听得出是渐强不是直接落下。
- [ ] **AC2**：结算页点「返回首页」→ 音乐**没有**重新开头，也没有音量跳变，是同一段继续。
- [ ] **AC3**：结算页点「再来一局」→ 进 Play 时 BGM 淡出（0.9s，`FADE_OUT_SEC`），
      第一题的音频起播时 BGM 已经彻底安静。
- [ ] **AC4**：首页把 BGM 开关关掉 → 打一局到结算页，**全程没有** BGM；
      静音开关同理（三个正交条件仍然都管用，见 `ambience.ts` 的 `shouldPlay`）。
- [ ] **AC5**：结算页**没有**背景视频；首页/大厅/房间三屏的视频与今天一致。
- [ ] **AC6**：结算页那一声 `fanfare` 音效仍在，且与 BGM 淡入不打架
      （淡入头 1s 音量还在低位，fanfare 压得住；实听确认一次）。
- [ ] **AC7**：`pnpm --filter @scg/web typecheck && lint && test` 全绿。
- [ ] **AC8 · 一处会过期的 spec 表述已修**：
      `.trellis/spec/server/backend/secrecy-and-anticheat.md:55` 现在写着
      「The ambient BGM on the **home / lobby / room** screens needed clips…」——
      加上结算页之后这句话就是旧的。改一行把屏的清单补全即可，
      那一节的**论证不受影响**（结算页同样没有 solo session 也没有房间，
      正是它要解释的「没有会话的屏怎么拿音频」那一类）。

---

## 验证方式

改动全在渲染层的一个布尔量上，没有可单测的纯函数产出，因此**以实听为准**：

```bash
pnpm dev            # 或按 CONTRIBUTING.md 的本地启动方式
```

1. 首页等 BGM 起来 → 开「简单」→ 打完 10 题 → 听结算页（AC1）
2. 结算页 →「返回首页」（AC2）→ 再进结算（AC3 反向）
3. 关 BGM 开关重跑一遍（AC4）
4. 结算页肉眼确认无视频（AC5）

**必须挂着耳机验**：淡入淡出的接缝在外放小音量下听不出来。

---

## Non-Goals

- 不给结算页加背景视频（父任务 D2）。
- 不改 BGM 的音量、淡入淡出时长、换曲逻辑。
- 不给联机的对局结算（`Karuta` 的收尾）加 BGM——那一屏还在对局的语境里，不在本次范围。
- 不新增 `stats` 屏的名字（那是 `09-03-local-stats-trophy` 的事）。
