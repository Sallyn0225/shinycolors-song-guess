# 移动端揭晓槽定高，消除答题→揭晓页面跳动

## Goal

移动端（≤767px）单机模式中，答题→揭晓的切换会让揭晓槽从空的 38u 被内容（56u 封面 + 歌名/演唱者行）撑到约 56~64u，整页随之反复"一长一短"。将窄屏 `.sc-revealslot` 的 `min-height` 提高到 64u（与桌面定高同值），使 answering ↔ revealed 的页面高度差恒为 0。

## 背景

- 桌面（>767px）早已定高：`apps/web/src/index.css` 中 `.sc-revealslot { height: calc(64 * var(--u)) }`，且揭晓槽曲名 `truncate` 单行——当年为修同款跳动引入。
- 移动端块（同文件 `@media (max-width: 767px)`）保留 `height: auto; min-height: calc(38 * var(--u))`，原注释理由是"窄屏这块本来就要能换行"；但曲名改 `truncate` 后揭晓内容高度已确定（封面对 56u 为最高元素），该理由不再成立。
- 移动端 `.sc-vfit` 为 `flex-start`，槽的增量直接叠加进页面总高，跳动感比桌面明显。

## Requirements

- 窄屏 `.sc-revealslot` 的保底高度提到 `calc(64 * var(--u))`，使答题（空槽）与揭晓（封面 56u + 文本）两态高度相等。
- 窄屏 `.sc-bar` 保底从 74u 提到 78u：实测揭晓时数字列换 58u 缩略图使文字列窄 ~45u、一行曲名被挤成两行（内容高恒 ≈77.4u），74u 包不住导致每题答题→揭晓条被顶高。78u 包住两行，两态与逐题恒等高；演唱者行在 OptionBar 钉死 `lineHeight: 1.5` 使内容高度成为常量。
- 揭晓槽内演唱者行（`apps/web/src/screens/Play.tsx` 中 `result.song.artist` 一行）加 `truncate`，兜底防折行。
- 保留 `min-height`（而非 `height`）：极端长内容仍可撑高而不是被裁切。
- 不改变桌面端行为；不涉及 Karuta（多人）屏。
- 更新 CSS 中关于"窄屏保持 min-height"的过时注释，说明新理由。

## Acceptance Criteria

- [ ] 375px 宽移动视口下，单机模式答题→揭晓，`document.scrollingElement.scrollHeight` 前后不变（或页面内容不发生纵向位移）。
- [ ] 揭晓内容（封面、歌名、演唱者、"正解/+得分"）在 64u 槽内完整可见、无裁切；两行曲名的选项条在 78u 内完整可见。
- [ ] 桌面宽度（>767px）下视觉与改动前一致。
- [ ] `pnpm lint` / type-check 通过（web 包）。

## Notes

- 轻量任务：PRD-only，不建 design.md / implement.md。
