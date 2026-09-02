# 单机计分与倒计时手感调整、联机记忆时长、下架感謝のコントレイル

## Goal

四项互相独立的手感与曲库调整，合成一次改动落地：

1. 单机速度分宽限期 `SCORING.speedGraceSeconds` 1.5s → **1.8s**（现在太难）
   ——立项时定的是 2.0s，实施中实测偏易，落回 1.8s，见 R1
2. 联机记忆阶段 `KARUTA_DEFAULTS.memorizeSeconds` 30s → **60s**
3. 从曲库彻底下架「感謝のコントレイル」（源文件 + 产物 + manifest + 代码/文档引用）
4. 单机答题界面在现有答题窗口倒计时条之外，**新增一条歌曲播放倒计时条**

---

## Requirements

### R1 · 速度分宽限期放宽到 1.8 秒

> **立项时写的是 2.0s，最终落地 1.8s。** 实施中按 2.0s 跑了一轮实测，用户反馈
> 中段作答几乎不扣速度分、偏易，遂折中到 1.8s。下面的条目已按 1.8s 改写，
> 完整经过见 `implement.md` 顶部执行记录。

- `packages/shared/src/scoring.ts` 的 `speedGraceSeconds` 改为 `1.8`。
- 取值注释同步改写：现有注释把 1.5 记为现值、2.0 记为「区分度明显变弱」的被否决候选。
  改动后 1.8 是现值，必须把「为什么选它」（1.5 秒实测偏难、2.0 秒实测偏易）写进去，
  并把 1.0 / 1.5 / 2.0 三个取值都降格为各带否决理由的前值。
- 单机答题窗口（`answerSeconds` 15/10）与联机不受影响——宽限期是绝对量，不随时限缩放，
  这条既有性质不能被改掉。

**已知取舍（用户已确认接受）**：`.trellis/spec/shared/backend/tuning-constants.md` 记录了
放宽宽限期会让「快 / 慢」的速度分区分度变弱——0.95 得分率门槛从 1.5s 时的 2.88s（困难）
放到 1.8s 时的 3.13s。用户以「1.5s 太难」为由明确接受这个代价，spec 里这段陈述要改成
现值的依据，而不是保留为反对意见。

### R2 · 联机记忆阶段放宽到 60 秒

- `packages/shared/src/difficulty.ts` 的 `KARUTA_DEFAULTS.memorizeSeconds` 改为 `60`。
- 唯一旋钮：`apps/server/src/ws/room.ts`、`apps/web/src/screens/Karuta.tsx`、
  `apps/web/src/screens/Lobby.tsx` 全部已从常量读，不得新增写死的 30 或 60。
- `okuriSeconds` 不动（用户已确认只改记忆阶段）。

### R3 · 下架「感謝のコントレイル」

曲目 id `感謝のコントレイル-9aef61`，时长 617.8s，是全库唯一 >400s 的离群值，占 6 个切片。
下架后曲库 244 → **243 首**，切片 1464 → **1458 个**。

必须清理的三类东西：

**(a) 本地素材与产物**（`songs/` 与 `assets/` 都在 `.gitignore` 里，不进 git diff）
- `songs/闪彩off vocal无重复_Page1/感謝のコントレイル (Off Vocal) - シャイニーカラーズ/`（mp3 + jpg + lrc）
- `assets/slices/<6 个 sliceId>.opus`（及 `.m4a` 兜底，若存在）
- `assets/thumb/感謝のコントレイル-9aef61.webp`
- `assets/.cache/analysis/…json` 与 `assets/.cache/slices/…json` 里该曲的缓存条目
- `assets/manifest.private.json` / `assets/manifest.public.json` 重新生成

**(b) 代码里的计数与引用**
- `apps/web/src/features/library.ts` `LIBRARY = { songs: 244, clips: 1464 }` → `243 / 1458`
- `apps/server/src/app.test.ts` `expect(res.json().songs).toBe(244)` → `243`
- `tools/prepare-audio/data/overrides.json` `excludeSlicePositions` 里的该曲条目与 `_comment`
- `tools/prepare-audio/src/planSlices.ts` 的 doc 注释（举例用了 618s 的这首）
- `tools/prepare-audio/src/planSlices.test.ts` 的「最长曲（617.8s）」用例
- `tools/prepare-audio/src/config.ts` `SLICE.fractions` 注释里的「时长跨 159~618s」

**(c) 文档与 spec 里的数字**
- `PROGRESS.md` 素材实况表：时长上界、切片数
- `DEPLOY.md` thumb 张数
- `.trellis/spec/` 中因这首曲子而写的现值陈述

**不在本次范围**：仓库里 233 / 234 / 244 三个曲目数在 spec 与文档之间的历史漂移
（见 `journal-1.md` 2026-09-01 条），本次只保证「244 → 243」这条线上的数字正确，
不去回填历史遗留的其他两个数字。

**不在本次范围**：线上 VPS（`283guess.hmhnk.top`，部署目录 `~/shinycolors-song-guess`）
的素材同步属于部署动作，本任务不执行，只在收尾时列为遗留项。

### R4 · 单机新增歌曲播放倒计时条

现状：`apps/web/src/screens/Play.tsx` 顶部只有一条 `PrismRail`，计的是**答题窗口**
（`answerSeconds`，15/10 秒），频谱只回答「现在在播吗」，回答不了「还能听多久」。
片段实际只播 `clipSeconds`（8/6 秒），比答题窗口短。

- 在答题阶段新增一条独立的**播放剩余**指示条，读的是音频引擎真实调度的播放结束时刻，
  不是 `setTimeout` 估算。
- 重听（replay）后必须重新填满——它读的是「本次播放」的剩余，不是「本题」的剩余。
- 视觉上必须与答题光带**区分得开**：两条都是全宽横条时，玩家分不清哪条是哪条就等于没加。
- 不得为它引入 per-frame `setState`（会连带重渲染四条选项与封面），与 `PrismRail` /
  `Countdown` 同一套 rAF 直写 DOM 的约定。
- 不得改动 `audio.ts` 的播放调度逻辑；只允许新增只读取值接口。

---

## Acceptance Criteria

- [ ] `SCORING.speedGraceSeconds === 1.8`（立项值 2.0 实测偏易后下调），
      注释写明选它的依据，并把 1.0 / 1.5 / 2.0 都记为各带否决理由的前值
- [ ] `KARUTA_DEFAULTS.memorizeSeconds === 60`，且三处消费方仍全部从常量读
- [ ] `pnpm -r test` 全绿；`pnpm -r typecheck` 无错
- [ ] `assets/manifest.private.json` 与 `manifest.public.json` 各 **243** 首，
      且全库任何一条 `neighbours` 都不再引用 `感謝のコントレイル-9aef61`
- [ ] `assets/slices/` 里不存在该曲的 6 个切片文件，`assets/thumb/` 里不存在它的缩略图
- [ ] 全仓（排除 `assets/`、`songs/`、`.trellis/tasks/archive/`、`design-extract-output/`）
      grep 不到「感謝のコントレイル」与「617.8」
- [ ] `LIBRARY.songs === 243 && LIBRARY.clips === 1458`；`app.test.ts` 断言 243
- [ ] 单机答题时同屏可见两条倒计时：答题窗口条（现有 PrismRail）与新的播放倒计时条，
      两者形态可区分，且播放条在片段放完时归零、重听后重新填满
- [ ] 新增的播放条不引入 per-frame `setState`（用 rAF 直写 DOM）
- [ ] 浏览器实测一局单机：布局无溢出、无跳动，两条计时读数与实际听感一致

---

## Notes

**为什么是一个任务而不是父子任务树**：四项确实各自可独立验证，但 R1/R2 各是一行常量、
R3 的代码面主要是数字同步、只有 R4 有真实设计。拆成四个子任务的调度开销大于收益，
且它们共享同一次 `pnpm -r test` 与同一个提交。R4 是唯一需要 `design.md` 的部分。

**层边界提醒**：`.trellis/spec/web/frontend/index.md` 明确 `src/audio.ts` 在 UI 改动期间是
禁区（它承载只在生产复现的修复）。R4 需要动它，改动必须限制在「新增只读 getter」，
不碰 `play()` / `stop()` 的调度语义。
