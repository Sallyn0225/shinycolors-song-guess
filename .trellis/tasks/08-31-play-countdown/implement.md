# implement — 单机开局 3-2-1 倒计时缓冲

## 执行清单（按序；前置：08-31-ui-sfx 已归档）

1. [ ] 新建 `apps/web/src/ui/ReadyCountdown.tsx`：固定 N 步倒计时组件（setTimeout 递归、tick/go 经 `sfx`、`num.animate` 冲量、reduced-motion 跳过、`role="timer"`）。
2. [ ] `screens/Play.tsx`：`Phase` 加 `'countdown'`；`getRemaining` 补分支（返回 1，同 loading）；载入 effect 里 index 0 在 prefetch 之后、`api.begin` 之前进入 countdown 并 await 组件完成回调。
3. [ ] `screens/Play.tsx` JSX：`phase === 'countdown'` 时渲染 `<ReadyCountdown>` 覆盖层（居中，置于选项区上方，pointer-events-none）。
4. [ ] 复查键盘 effect：`'countdown'` 阶段不响应 1-4 / R / Enter（确认现有 phase 条件已天然排除，如无遗漏则不改）。
5. [ ] 对照 `.sc-title` 与 Countdown 的尺寸语言定稿数字字号与位置，窄屏（375×667）目测不溢出。

## 验证命令

```bash
pnpm --filter @scg/web build
pnpm --filter @scg/web test
# 手动：pnpm dev，点简单/困难各开局一次：
#   ① 倒计时 3-2-1 可见、每秒 tick、开播前 go；
#   ② 开播前光带满格、开播瞬间开始收拢；
#   ③ 倒计时中点「退出本局」→ 首页，再开局行为一致；
#   ④ 系统开 reduce-motion 复查（无冲量动画）；
#   ⑤ 断网/慢速节流开局：载入态先出，倒计时等载入完才起。
```

## Review gates

- 完成后跑 trellis-check 全量；随后做父任务集成验收（完整一局含音效节奏）。

## Rollback points

- 步骤 1-3 是一个原子 diff；4-5 是检查项。回滚删组件 + 还原 Play.tsx 即可。
