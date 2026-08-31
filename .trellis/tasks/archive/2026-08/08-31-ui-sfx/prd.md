# 核心交互音效系统

## Goal

全站无 UI 音效。引入 CC0 音效资源（Kenney UI Audio 等），建轻量音效播放层，覆盖核心交互反馈点：点击、正/误揭晓、倒计时、结算。

## Dependencies

- **本任务先于 `08-31-play-countdown` 实施**：倒计时任务需要本任务产出的音效层（`sfx.play('tick')` 等）。本任务不依赖任何未完成任务。

## Requirements

### R1 音效资源

- 来源：Kenney UI Audio（CC0 1.0，kenney.nl/assets/ui-audio）。选入仓库的文件必须是 CC0，无需署名。
- 资源放 `apps/web/public/sfx/`，走 Vite 静态服务（与 bg/、emote/ 同层）。
- 仓库内附许可与来源说明（`apps/web/public/sfx/CREDITS.md` 或同级文档），可追溯每个文件的来源。

### R2 音效层 `src/sfx.ts`

- 单例模块，**不改动 `src/audio.ts`**（spec 禁区）。沿用 `ambience.ts` 的模式：从 `audio.bypass` 取 ctx 与 destination，自己接一条平行链。
- 音效走固定增益的总线，不受音量滑杆管（与 BGM 同理：音效是反馈不是内容，且音量滑杆语义是「题目音频的响度」）。
- **全局静音必须切断音效**（同 `ambience.setMuted` 的规矩，`audio.ts` 是禁区不加订阅，由 VolumeControl / main.tsx 显式同步）。
- 懒解码：首次播放时 fetch + decodeAudioData 并缓存（音效文件极短、数量少，全量常驻）。
- AudioContext 未解锁或加载失败时**静默放弃**，绝不抛错阻断交互。
- API 形态：`sfx.play(name)`，`name` 为受控的字符串字面量联合类型（不暴露任意 URL）。

### R3 核心交互点接线

| 交互点 | 音效 |
|--------|------|
| 按钮/入口点击（Button、IconButton、EntryBar、原生 tap-line 链接） | click：短促、轻 |
| 揭晓正解 | correct：上行确认 |
| 揭晓不正解 | wrong：低沉否定 |
| 倒计时 3-2-1 每秒（本任务只提供音效，动画在 play-countdown 任务） | tick |
| 倒计时结束/起跑 | go |
| 结算页进场 | fanfare（克制，不做长奏） |

- 范围限定（用户确认）：只做核心反馈点，**不做** hover、焦点、滑杆拖动等细粒度音效。Karuta（1v1 牌场）的抢牌音效**不在本任务**（注意力在抢牌，另议）。
- OptionBar（答题选项）在 `answering` 阶段的点击不另加 click 音（提交后紧接正/误揭晓音，连响三层会糊）。

### R4 音效开关

- 与 `bgmOn` 正交的 `sfxOn` 偏好，默认开；沿用 prefs.ts 的字段级覆盖写法与「显式存过 false 才关」的兼容读法。
- 首页 ToolRail 加一个开关按钮（图标用现有 Icon 集，无合适图标则加一个简单 path），行为与 BGM 开关一致。

## Acceptance Criteria

- [ ] 点击首页难度入口、对局内按钮，有轻量 click 音；切静音后全部 UI 音效消失。
- [ ] 单机揭晓答案：正解一声上行确认音，不正解一声低沉否定音。
- [ ] `sfx.play('tick')` / `sfx.play('go')` 可被倒计时任务直接调用，AudioContext 未解锁时不抛错。
- [ ] 结算页进场有克制的结算音。
- [ ] 首页可独立开关 UI 音效，与 BGM 开关互不影响；刷新后偏好保留。
- [ ] `apps/web/public/sfx/` 内每个文件在 CREDITS 文档中有来源与 CC0 许可记录。
- [ ] `audio.ts` / `api.ts` / `net/ws.ts` / `features/*` 零改动。
- [ ] lint、type-check、现有测试全绿。
