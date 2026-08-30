# 移除误入曲库的人声版 リフレクトサイン (2022 Ver.)

## Goal

曲库里混进了一首**带人声**的音源：`リフレクトサイン (2022 Ver.)`。整个游戏的前提是「听去人声版猜曲名」，人声版直接把答案唱出来，是数据缺陷。把它从源素材、构建产物和全部下游断言/文档里彻底清掉。

## Background

`songs/` 下有两个几乎同名的目录：

| 目录 | ID3 title | 判定 |
|---|---|---|
| `闪彩off vocal无重复_Page18/リフレクトサイン (2022 Ver.) - Team.Luna/` | `リフレクトサイン (2022 Ver.)` | ❌ 有人声 |
| `闪彩off vocal无重复_Page20/リフレクトサイン (Off Vocal) - Team.Luna/` | `リフレクトサイン (Off Vocal)` | ✅ 正常 |

全库 234 首里，**只有这一首**的 ID3 title 缺少 ` (Off Vocal)` 后缀 —— 这正是它有人声的信号。`tools/prepare-audio/src/util/text.ts:31` 当年把它当作数据特例兼容掉了（把后缀匹配写成可选），而不是当成错误剔除，于是它一路走完了 pipeline 进了曲库。

当前构建产物中它的身份：

- songId `リフレクトサイン-(2022-Ver.)-cd76f3`
- 6 个切片（sliceId 是随机 20 字符，只有 `manifest.private.json` 的 `sliceIndex` 知道映射关系）
- `assets/cover/` 与 `assets/thumb/` 各 1 个 `.webp`
- 与 `リフレクトサイン-19a2d0` 同属 `confusableGroup: "リフレクトサイン"`（该组仅这 2 首）

## Requirements

### R1 — 删除源素材

删除目录 `songs/闪彩off vocal无重复_Page18/リフレクトサイン (2022 Ver.) - Team.Luna/`（含 mp3 / jpg / lrc 三个文件）。

### R2 — 重建构建产物，且不留残留

`songs/` 与 `assets/` 均在 `.gitignore` 中，是本地素材与产物，但**残留文件本身是保密面上的 oracle**（见 `.trellis/spec/prepare-audio/backend/asset-secrecy.md`），必须清干净：

- pipeline 没有任何 orphan 清理逻辑（`slice.ts` / `covers.ts` / `manifest.ts` 都只写不删），所以重跑构建**不会**自动删掉这 6 个切片和 2 个 webp。
- 切片文件名是随机 id，**一旦重写 manifest 就再也查不到映射**。因此必须在重建之前，先从当前 `manifest.private.json` 的 `sliceIndex` 里把这 6 个 sliceId 捞出来。

### R3 — 同步下游断言与文档

代码/测试（入库）：

| 位置 | 现状 | 期望 |
|---|---|---|
| `apps/server/src/app.test.ts:47` | `expect(res.json().songs).toBe(234)` | `233` |
| `packages/game-core/src/deal.ts:10` | 注释「`リフレクトサイン` 有 2 个」 | 该组已不存在，注释需改写 |
| `packages/game-core/src/karuta.test.ts:65` | 同上注释（测试本体用合成数据，逻辑不受影响） | 注释同步 |
| `tools/prepare-audio/src/util/text.ts:31` | 注释「233/234 有，`リフレクトサイン (2022 Ver.)` 没有 → 必须可选」 | 改写为「此前有一首人声版没有后缀，已剔除；正则保持可选以容错」 |
| `tools/prepare-audio/src/util/text.ts:40` | 注释举例 `リフレクトサイン` 的 2 个版本 | 只保留 `Migratory Echoes` 一例 |

规格文档（入库，`.trellis/spec/`）中 6 处 `234`：

- `prepare-audio/backend/index.md:3`
- `prepare-audio/backend/asset-secrecy.md:37`
- `prepare-audio/backend/pipeline-guidelines.md:4,24,86,98,99`
- `server/backend/quality-guidelines.md:17`
- `server/backend/secrecy-and-anticheat.md:26,61`

## Constraints

- **C1 — 不收紧 `stripOffVocal`。** 用户明确决定：正则里 ` (Off Vocal)` 保持可选，不改成必选、也不新增 scan 阶段的 issue。理由记录在案即可，不做防御性改动。
- **C2 — 不重新编码其余 233 首。** pipeline 按内容缓存，重跑必须命中缓存；若出现大规模重编码，说明改动踩到了缓存 key，需停下来排查而不是硬跑完。
- **C3 — 切片 id 不轮换。** 其余 233 首的 sliceId 必须保持不变（`specsFor` 会复用已有 id），否则前端/缓存中的 URL 全部失效。
- **C4 — 不碰 `songs/` 里的任何其他目录。**

## Out of Scope

- 补齐或替换这首歌的 off-vocal 版本（`リフレクトサイン (Off Vocal)` 已在库中，无需补）。
- 为「检测人声版混入」建立自动化机制（见 C1）。
- 顺带修 `text.ts:40` 注释里「`Migratory Echoes` 的 10 个版本」这一处数字错误（实际是 9 个）—— 该行本来就要改，顺手改对即可，但不作为独立目标。

## Acceptance Criteria

- [x] AC1 — `songs/` 下不再存在 `リフレクトサイン (2022 Ver.)` 目录；`リフレクトサイン (Off Vocal)` 完好。
- [x] AC2 — `manifest.private.json` 的 `songs` 长度为 **233**，`sliceIndex` 条目数为 **1398**；两者均不含 `リフレクトサイン-(2022-Ver.)-cd76f3`。
- [x] AC3 — `manifest.public.json` 不含 `リフレクトサイン (2022 Ver.)`，且仅剩一条 `リフレクトサイン`。
- [x] AC4 — `assets/slices/` 下该曲的 6 个切片文件（`.opus` 及可能的 `.m4a`）已删除；`assets/cover/` 与 `assets/thumb/` 下的 `リフレクトサイン-(2022-Ver.)-cd76f3.webp` 已删除；`assets/.cache/` 中该曲的 analyze / slice 缓存条目已删除。
- [x] AC5 — 重建后 `confusableGroup` 只剩 `Migratory Echoes`（9 首）一组，`リフレクトサイン` 组消失。
- [x] AC6 — manifest 边界自检（`assertPublicManifestClean` / `selfCheck`）通过。
- [x] AC7 — 其余 233 首的 sliceId 与重建前逐一相同（C3）。
- [x] AC8 — `pnpm -r test` 与 `pnpm -r typecheck` 全绿。
- [x] AC9 — R3 表格中全部代码注释与 6 个 spec 文件的 `234` 表述已更新为 233 / 已改写；仓库内 `grep -r "234"`（排除 `node_modules` 等）不再有指代曲目数的残留。
- [x] AC10 — `text.ts` 的 `OFF_VOCAL_SUFFIX` 正则本身**未被修改**（C1）。
- [x] AC11 —（执行中追加）取证文件 `doomed-slices.json` 已销毁。它含全部 1398 个 `sliceId → songId` 映射，而 `.trellis/tasks/` 入库，留下即泄题。

## Notes

- 未写 `design.md`：本任务无新契约、无架构决策，是一次数据剔除 + 产物重建 + 文案同步。执行顺序上的坑（先捞 sliceId 再重建）写在 `implement.md`。
