# 前端视觉层全量重构：シャニソン 官网风格

## Goal

推倒重写 `apps/web` 的视觉层，按 `design-extract-output/SHINYCOLORS-DESIGN-LANGUAGE.md`
记录的《Song for Prism》官网设计语言重建设计系统与全部界面。

**不是**在现有暗色主题上改配色——现有的「暗室里的棱镜」被整体替换为官网那套
「白底虹彩 + 半透明白玻璃 + clip-path 斜切」的明亮世界。

## Constraints

### 不动的代码（硬边界）

以下文件**一行都不改**，它们封着 PROGRESS.md 记录的一批只在生产环境复现的坑：

| 文件 | 封着什么 |
|---|---|
| `src/audio.ts` | AudioContext 手势门、`getOutputTimestamp()` 而非 `currentTime`、精确调度、频谱、AAC 兜底 |
| `src/net/ws.ts` | 时钟同步、`sessionStorage` 座位凭证、`connect()` 幂等、状态多播订阅 |
| `src/api.ts` | 取题与起表分离、clip token |
| `src/features/kimariji.ts` | 決まり字计算 |
| `src/features/karutaBoard.ts` | 稳定槽位（牌被取走后位置留空） |
| `src/features/narrate.ts` | 回合结果文案 |
| `src/features/*.test.ts` | 21 个既有测试，必须继续全绿 |

视觉层调用这些模块的**签名不变**。若发现某个签名确实挡路，先停下来在本文档记一条，不要顺手改。

### 技术栈

React 18 + Vite 6 + Tailwind v4 + TypeScript，不升级、不换栈。
以**手写 CSS（token + 语义 class）为主**表达 clip-path / vw / drop-shadow，Tailwind 只做排版微调。

### 已确认的产品约束

- **PC 与手机并重**，手机不能将就。牌场在窄屏必须重新排布，不是缩小。
- **文案：中文正文 + 日文术语**（空札 / 送り札 / お手つき / 自陣 / 敵陣 / 決まり字 / 勝ち）。
- **无障碍是硬性验收项**，见下方验收标准。

## Design Direction（已锁定，不再重开）

Impeccable 构图轮 seed `dfab6df5`，用户锁定 **`running-light`（一条光 / The Running Light）**，
comp-led。批准的 comp：`.impeccable/mocks/decision/running-light.png`——**comp 即法**。

> 全局只有一条不断的光带在动；它同时是计时、频谱、进度和两阵之间的界线。其余一切静止。

三条来自被判负挑战者的提升（已并入方向，必须落地）：

1. **步进键排**：光带在任何宽度下**只缩放不换行**，且严格锁在音频时钟上——不做缓动、不做补间。
2. **Studio Dumbar**：颜色以**整片区域**承担（自陣/敵陣各自成色场），不是散在中性底上的小色条点缀。
3. **折り鶴**：答过的题**不被替换掉**，以折痕的方式留在光带上，整局轨迹一直可见。

## Requirements

### R1 设计系统

- 一套 token 覆盖：色彩（白底虹彩世界）、字体（Noto Sans JP + Jost）、字距、
  斜切尺寸、紫调 drop-shadow、缓动与时长。
- 尺寸走官网的**比例体系**：单一断点 `767px`，PC 稿宽 1440 / SP 稿宽 375，
  尺寸随视口等比缩放但在超宽屏被钳制。
- 形状全部由 `clip-path` 提供：平行四边形（按钮/标签）、双切角矩形（内容卡/模态）、
  六边形（缩略图）、两端尖角长条（状态条）。`border-radius` 只有 0 与 6px 两档。
- 背景由**纯 CSS/SVG 程序化重建**（虹彩镭射膜 + 晶体碎片 + 前景碎片三层），
  不引入位图资源，不声称拿到了官方素材。

### R2 签名组件 PrismRail

一条贯穿全宽的棱镜光带，同时承担四件事：剩余时间（从两端向中央收）、
实时频谱（从光带上缘长出）、本局进度（走过的题留下折痕）、
以及在牌场里作为两阵之间的界线。

必须复用现有 `audio.spectrum()` 与 `getRemaining()` 契约，
**用 rAF 直写 DOM**，绝不每帧 `setState`。

### R3 五个界面全部重建

Start / Play / Result / Lobby / Karuta，外加 App 壳的恢复态与座位丢失提示。
功能清单以 `PRODUCT.md` 的界面表为准，**一个状态都不能少**。

### R4 非 UI 逻辑零改动

见上方硬边界。

## Acceptance Criteria

### 功能完整性

- [ ] Start：两个难度（题数/片段/限时/重听四项参数）、1v1 入口、错误条、耳机提示
- [ ] Play：loading / answering / revealed / error 四态齐全；倒计时与频谱；重听及余次；
      四选一；正确答案与我的错选**双标记**；下一题 / 查看结算
- [ ] Result：总分与满分、评语、四项统计、逐题列表（封面、你选了什么、用时、重听、得分）、
      再来一局 / 换个难度
- [ ] Lobby：昵称、创建房间、6 位房间码加入、连接状态与 RTT、房间内玩家列表与准备、规则说明
- [ ] Karuta：memorize / waiting / live / choosing / reveal / over 六阶段全部有对应界面；
      敵陣与自陣双网格；決まり字加粗；记忆阶段点两张交换；点牌抢答与本地即时高亮；
      送り札挑选（候选高亮、已选计数、自动送出倒计时）；回合叙述；
      对手掉线常驻横幅；自己断线全屏遮罩；刷新后手势遮罩；赛后统计表；再战投票
- [ ] App：「正在找回对局」恢复态与跳过；座位丢失后退回首页并说明原因
- [ ] 牌被取走后**位置留空**，阵形不重排
- [ ] 领地**超过 12 张时全部可见可点**（不固定渲染 12 格）

### 视觉保真

- [ ] Play 界面在 comp 自身像素尺寸下与 `.impeccable/mocks/decision/running-light.png`
      并排对比，结构、材质、层次、间距节奏一致（字体与图标按 Impeccable 的三项让步条款）
- [ ] 三条 raise 逐条可见：光带不换行只缩放且锁时钟；颜色成片落地；答过的题留痕
- [ ] `border-radius` 未超出 0 / 6px 两档；阴影全部是紫调 `drop-shadow`，无黑色 `box-shadow`

### 无障碍（硬性）

- [ ] 键盘完成单机全流程：`1`–`4` 选项、`R` 重听、`Enter`/`Space` 下一题
- [ ] `prefers-reduced-motion: reduce` 下入场模糊、抖动、光晕、跑马灯全部关闭
- [ ] `:focus-visible` 焦点环可见——**且不被 `clip-path` 裁掉**
- [ ] 图标化/纯色状态标记带 `aria-label`；错误信息带 `role="alert"`
- [ ] 正文与状态色对比度达标：**正文不得使用 `#615f90`**，必须压到近黑
- [ ] 触摸目标不小于 44×44 CSS px（含窄屏牌场的牌）

### 工程

- [ ] `pnpm --filter @scg/web typecheck` 干净
- [ ] `pnpm --filter @scg/web test` 全绿（既有 21 个测试一个不改）
- [ ] `pnpm --filter @scg/web build` 成功
- [ ] `audio.ts` / `net/ws.ts` / `api.ts` / `features/*` 的 `git diff` 为空
- [ ] 方向契约以 HTML 注释形式存在于构建产物中（`dist/index.html` 里 grep 得到 seed key `dfab6df5`）
- [ ] Impeccable 机械检测器 `detect.mjs` 通过或剩余项已交给 finish reviewer

## Out of Scope

- 服务端、game-core、shared、prepare-audio 的任何改动
- 新玩法、新界面、新功能
- React 升级、构建工具更换
- 官方位图素材的获取或仿制
