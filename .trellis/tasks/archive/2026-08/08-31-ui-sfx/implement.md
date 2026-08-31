# implement — 核心交互音效系统

## 前置

- [x] 下载 Kenney UI Audio（https://kenney.nl/assets/ui-audio，CC0 1.0）zip，试听并选出 6 个候选 WAV：click / correct / wrong / tick / go / fanfare。
  - 若某类在包里不合适（如 fanfare 太长），备选 itch.io Interface SFX Pack 1（ObsydianX，CC0）补位，CREDITS 里如实记录。
  - **由主会话于 2026-08-31 完成**：click / tick / go 取自 Kenney UI Audio；correct / wrong / fanfare 取自 Interface SFX Pack 1（备选包补位，已裁尾静音、60ms 淡出、峰值 -3dB、48kHz mono PCM16）。

## 执行清单（按序）

1. [x] 资源落地：6 个 WAV 放 `apps/web/public/sfx/`，重命名为逻辑名（`click.wav` 等）；写 `apps/web/public/sfx/CREDITS.md`（来源 URL、许可、日期、逐文件映射）。（资源下载与转换由主会话完成，CREDITS.md 由实施会话补写）
2. [x] `src/sfx.ts`：Sfx 单例（bypass 平行链、懒解码缓存、`play(name)`、`setMuted`、`setSfxOn`、`sfxOn` getter），注释风格对齐 `ambience.ts`（中文、写约束不写流水账）。
3. [x] `src/prefs.ts`：`AudioPrefs` 加 `sfxOn`（读 `!== false` 兼容老数据），不动既有字段写法。
4. [x] `src/main.tsx`：灌偏好时同步 `sfx.setMuted` / `sfx.setSfxOn`。
5. [x] `ui/Button.tsx`：内部包 onClick 播 click（保留 rest.onClick 引用）。
6. [x] `ui/IconButton.tsx`：同上。
7. [x] `screens/Start.tsx`：EntryBar onClick 补 click（难度入口 / 对战入口）；ToolRail 加音效开关（取舍：沿用现有 `volume`/`mute` 表达「音效开/关」，`music`/`music-off` 已被 BGM 占用；与 VolumeControl 静音钮撞字形是接受的代价，理由写在代码注释里）。
8. [x] `screens/Play.tsx`：submit 拿到 `r.correct` 播 correct/wrong；超时（TIMED_OUT）走同一分支自然播 wrong。
9. [x] `screens/Result.tsx`：挂载播 fanfare，`useRef` 守卫 StrictMode 双跑。
10. [x] `ui/VolumeControl.tsx`：commit 里补 `sfx.setMuted(next.muted)`。

## 验证命令

```bash
pnpm --filter @scg/web build          # type-check + build
pnpm --filter @scg/web test            # 现有单测
pnpm --filter @scg/web lint           # 若有
# 手动：pnpm dev 起本地，走一遍首页点击→单机一题→结算，听 6 个音效点；静音后复查全静
```

## Review gates

- 接线完成后跑 trellis-check（last iteration 全量）。
- 父任务集成验收在本任务归档前完成一次预验（倒计时还没做，tick/go 先在控制台验证可播）。

## Rollback points

- 每个清单项一个独立 diff；资源落地（1）与代码（2-10）互不依赖，可单独回滚。
