# 单机开局体验与音效系统

## Goal

用户反馈两个体验问题：

1. 单机模式点击难度后直接开播并起计时，没有任何缓冲动画，用户没有心理准备。
2. 全站没有任何 UI 音效设计，交互缺乏听觉反馈。

本父任务只做统筹与集成验收，实现工作在两个子任务里。

## Source requirement set

- 开局缓冲：点击难度 → 进入游戏 → **3-2-1 自动倒计时动画** → 开播 + 起计时。用户确认选「自动倒计时」方案（不再多一次点击，倒完自动开始）。
- 音效系统：引入免费可商用（CC0）音效资源，建轻量音效层，覆盖**核心交互反馈点**：按钮点击、答案正/误揭晓、倒计时、结算。用户确认先做核心范围（不含 hover 等细粒度反馈）。
- 音效资源：经调研选定 **Kenney UI Audio / Interface Sounds**（CC0 1.0，无需署名，可直接商用，kenney.nl 直接下载）。备选：itch.io Interface SFX Pack 1（ObsydianX，CC0）。不使用协议不明的聚合站资源。

## Task map

| 子任务 | 交付物 | 顺序 |
|--------|--------|------|
| 08-31-ui-sfx | CC0 音效资源落地 + `sfx.ts` 单例音效层 + 核心交互点接线 | 先做（倒计时需要它的 tick 音） |
| 08-31-play-countdown | 单机第一题开播前的 3-2-1 倒计时缓冲动画（消费 ui-sfx 的音效） | 后做 |

两个子任务可独立验收，但 play-countdown 依赖 ui-sfx 提供的音效播放层，故有先后顺序（已写在两边 prd 里）。

## Cross-child acceptance criteria

- [x] 单机：点击难度后，第一题音频开播前可见 3-2-1 倒计时动画，倒计时期间**服务端计时未开始**（`api.begin` 仍在倒计时结束后才调用）。（浏览器实测：tick t → go t+3.0s → begin t+3.01s）
- [x] 倒计时每秒有 tick 音效，开播前有起跑音效；音效与画面不错位。（网络时序证据同上；下一题无 tick/go、+95ms 即 begin）
- [x] 全局静音时所有 UI 音效一并静音（与 BGM 同一条静音规矩）。（main.tsx / VolumeControl 两处 setMuted 同步，trellis-check 复核）
- [x] 有独立的音效开关（与 bgmOn 正交，同 prefs 模式），默认开。（实测关掉后 tick/go 全静默，prefs `sfxOn:false` 落盘；倒计时节奏不受影响）
- [x] `prefers-reduced-motion` 下倒计时数字不做冲量动画。（代码路径核验；IAB 无法模拟系统 reduce-motion）
- [x] 音效资源附带来源与许可说明（CC0），仓库内可追溯。（apps/web/public/sfx/CREDITS.md）
- [x] 现有测试与 lint 全绿。（build 通过、87/87 测试通过、typecheck 通过；apps/web 无 lint script）

## Integration review

已完成（2026-08-31，浏览器实测完整一局 + 定向用例）：

- 整局通关：首页点击难度 → click 音 → 3-2-1（每秒 tick）→ go + 开播（`api.begin` 紧跟 go）→ 答题（选项点击无多余 click；正/误揭晓各一声）→ 结算页 fanfare（挂载即响，StrictMode 守卫）。
- 音量关系：音效走旁路固定增益，不经过音量滑杆；与题目音频无叠加冲突（时序证据）。
- 倒计时 tick 与起播衔接：go 响后切片起播，无错位；下一题直进无倒计时。
- 倒计时中退出：无泄漏（begin/answer 均为 0），干净回首页，重开局行为一致。
- 音效开关关闭：tick/go 静默但倒计时节奏不变；偏好字段级落盘（不覆盖 bgmOn）。
