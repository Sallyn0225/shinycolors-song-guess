# 首页工具条新增信息弹窗与 GitHub 入口

## Goal

在首页 Start 屏工具条 ToolRail 的 BGM / 音效两个图标按钮旁新增两个图标按钮:

1. **信息按钮** —— 打开一个带翻页的展示信息弹窗(悬浮窗),共三页:玩法介绍、免责声明、开源致谢
2. **GitHub 按钮** —— 点击跳转到 GitHub 仓库页面

## Background

- Start 屏工具条(光带上方那排)现有 BGM、音效两个开关;`ToolRail` 的注释明确预留了扩展位(「以后要加的图标按钮都往 ToolRail 里塞」),新按钮应放入同一行,不新增独占行(该页桌面档垂直余量已用尽,见 `Start.tsx` 头部注释)。
- 仓库 `NOTICE` 已有完整的非官方粉丝作品声明文案,弹窗第二页应与其口径一致,不另造说法。
- 用户列出的四个致谢/参考项目此前未在站内任何页面展示。
- 仓库地址:`https://github.com/Sallyn0225/shinycolors-song-guess`。

## Requirements

### 信息弹窗(三页,可翻页)

- **第一页「玩法」**:
  - 单机玩法:听一段无人声的伴奏片段,在限定时间内从选项中认出是哪首歌(听节奏猜歌)
  - 联机玩法:日式歌牌(かるた)1v1 抢牌对局;不展开完整规则,以文字引导用户到联机页面(首页「1v1 空札領地戦」入口)查看详细信息
- **第二页「免责声明」**:
  - 说明本项目为非官方粉丝作品、非商业
  - 与「偶像大师闪耀色彩」(アイドルマスター シャイニーカラーズ)官方及万代南梦宫(BANDAI NAMCO Entertainment)没有任何关联,未获其认可或授权 —— 口径与仓库 `NOTICE` 的「非官方声明」一致
- **第三页「致谢」**,以下项目及用途,外链可点击:
  - MSST-WebUI — https://github.com/SUC-DriverOld/MSST-WebUI — 用于部分伴奏的分离
  - Irodori-TTS — https://github.com/Aratako/Irodori-TTS — 用于角色语音的合成
  - 闪耀色彩表情包 — https://aldiba.github.io/shinycolors-stickers/ — 表情包的制作
  - ヨルシカ猜歌小游戏 — https://www.bilibili.com/toy/yorushika_song_guess/index.html — 本项目的灵感来源
- **翻页交互**:
  - 上一页 / 下一页控件 + 当前页指示(页码或分段点),首末页相应方向的控件不可用或隐藏
  - 弹窗可关闭(明确的关闭控件)
  - 键盘可完成完整流程:打开 → 翻页 → 关闭(复用 Overlay 的 `role="dialog" aria-modal` 与焦点圈闭)
- 弹窗打开、翻页、关闭均有全站一致的 click 音效反馈

### GitHub 按钮

- 点击在**新标签页**打开 `https://github.com/Sallyn0225/shinycolors-song-guess`
- 有无障碍名称(如「GitHub 仓库」);语义上是**链接**(读屏应播报为链接而非按钮)

## Constraints

- 新图标须照 `ui/Icon` 现有体系手绘(24 网格、1.8 描边、方头方角),不得引入 Lucide / Font Awesome 等圆头圆角图标库
- 不改动 `audio.ts` / `net/ws.ts` / `api.ts` / `features/*`(本任务也无需触碰)
- 弹窗复用现有 `Overlay` 模态体系(明底遮罩、backdrop-blur、焦点圈闭),不自造新的弹层样式
- UI 文案中文;外链项目名保留原名
- 不在 Start 页新增任何独占一行的元素

## Acceptance Criteria

- [x] Start 屏工具条共四个图标按钮:BGM、音效、信息、GitHub,同一行内
- [x] 信息按钮打开模态弹窗,含三页内容,可前后翻页,有当前页指示,可关闭
- [x] 第一页覆盖单机(听伴奏猜歌)与联机(日式歌牌)两种玩法,并引导用户去联机页面看详情
- [x] 第二页为免责声明,口径与 `NOTICE` 一致(粉丝项目、与官方及万代南梦宫无关联)
- [x] 第三页完整列出四个致谢项目及其用途,链接可点击跳转
- [x] GitHub 按钮在新标签打开仓库页,读屏播报为链接
- [x] 键盘可完成:打开弹窗 → 翻页到三页各看一遍 → 关闭
- [x] `pnpm -r typecheck` 通过;`pnpm -r test` 中不依赖曲库的测试集通过(仓库无 lint 脚本,以 CI 同款命令为准)
- [x] 375px 窄屏与桌面常见视口下工具条一行放得下,页面布局无破坏

## Notes

- 轻量任务,PRD-only。
