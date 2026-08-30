# Journal - sallyn (Part 1)

> AI development session journal
> Started: 2026-08-30

---



## Session 1: 前端视觉层全量重构收尾复验
<!-- trellis-session: v=2 fp=947e1347cf397d7f -->

**Date**: 2026-08-30
**Task**: 前端视觉层全量重构收尾复验
**Branch**: `main`

### Summary

在干净工作区上把 web-prism-redesign 的可机械验证项全部重跑：typecheck 干净、21/21 测试、build 成功、保留层（audio.ts/net/ws.ts/api.ts/features）diff 为空、dist 里 seed dfab6df5 仍在、detect.mjs 对 8 个改动文件返回 []。起 server+web dev 后用 tools/ui-audit 的 probe.mjs 双 page 真打 1v1，桌面 1536x1024 与移动 390x844 各一遍：六屏无结构问题，光带偏离中线 0、自陣越过折线的牌 0、曲名被裁 0、无横向溢出、牌 109x64 满足 44x44 热区；px-contrast.mjs DPR4 实测对比度全部 >= 4.5:1，最低 4.85:1。Tab 焦点环确认由包装层承担（被 clip-path 裁掉的元素自身 outline: none），上一轮的修法在生效。border-radius 全站为 0，唯一 box-shadow 是 Field 的靛紫 inset 描边而非黑色投影。两点如实留档：键盘整局走查只做了静态核对（Play.tsx:185-194 处理器齐全）仍需人工过一遍；390x844 上牌场纵向超出视口 21~53px（12+12 张牌各 333px，不压牌高装不下），属设计取舍未自行改动。实测记录与勾选状态写入 implement.md 并提交 430b52b。

### Git Commits

| Hash | Message |
|------|---------|
| `430b52b` | docs(trellis): 收尾轮复验 —— 执行计划勾选与实测记录 |

### Status

[OK] **Completed**


## Session 2: 公网联机房间：房间列表与公开/私人模式
<!-- trellis-session: v=2 fp=bf3a39efaa38a7a2 -->

**Date**: 2026-08-30
**Task**: 公网联机房间：房间列表与公开/私人模式
**Branch**: `feat/public-room-lobby`

### Summary

把联机从「只能口头传房间码」扩成公网可用的房间系统：建房可命名并选公开/私人，公开房进大厅列表可直接点进去，私人房仍只认房间码，2 人上限不变。用户决定站点完全开放，因此按 IP 的反滥用（全局/单 IP 房间数、建房速率、joinRoom 失败限流）与三种房间自动回收是同批交付的硬要求。过程中修掉两个真 bug：全员掉线的房间会被当成活房间在列表里挂满 30 分钟（disconnect 只 detach 不清座位，既不 isEmpty 也不过期）；joinFail 用 > 而非 >= 导致额度实际多放行一次。前端把 Lobby 拆成 Lobby + Room 两屏，离开房间回大厅而非首页。另修了一个用户报告的设计系统通病：inset box-shadow 描的是矩形的边，画在 clip-path 裁过的元素上会导致斜边整条没有描边、左下角多出一截直角残边，改用 evenodd 挖空的 clip-path 环（.cut-ring），Field/Button/Presence 三个共享组件一改全站生效。179 个测试全过。

### Git Commits

| Hash | Message |
|------|---------|
| `7fcf118` | feat(shared): 房间协议加入名称、可见性与大厅列表推送 |
| `1c4ee34` | feat(server): 公开房间注册表、合并推送与按 IP 配额 |
| `1416c94` | feat(web): 联机大厅改为房间列表，房间内拆成独立一屏 |
| `1561e0b` | fix(web): 斜切元素的描边改用 clip-path 环，不再用 inset 阴影 |
| `c44c8dc` | docs: 补开放公网部署的配额、房间回收与版权取舍 |
| `a065894` | docs(trellis): 把房间列表契约、生命周期与 clip-path 描边坑写回 spec |

### Status

[OK] **Completed**


## Session 3: 移除误入曲库的人声版 リフレクトサイン (2022 Ver.)
<!-- trellis-session: v=2 fp=e0582294d8d70dbe -->

**Date**: 2026-08-30
**Task**: 移除误入曲库的人声版 リフレクトサイン (2022 Ver.)
**Branch**: `main`

### Summary

曲库里混进一首带人声的音源，与正常的 off vocal 版几乎同名、只多一个 (2022 Ver.) 后缀。全库唯一一首 ID3 title 缺 ' (Off Vocal)' 后缀的——那正是它有人声的信号，但 stripOffVocal 当年把后缀写成可选、当数据特例兼容掉了，于是它走完整条 pipeline 进了曲库。曲库 234→233 首、切片 1404→1398 个。用户明确决定不收紧正则：素材准入是人工判断，不该由正则兜底。执行中最大的坑是 pipeline 只写不删——删源目录后重跑构建不会清理旧切片，而切片文件名是随机 id，唯一映射记录在 manifest.private.json 的 sliceIndex 里，一旦重写就再也查不出孤儿是谁的，所以必须先取证再动手。清理后磁盘 1398 = manifest 1398，零孤儿；analyze/slice 233/233 全缓存命中，零重编码、其余 233 首 sliceId 逐一未变。另一个坑是我自己踩的：取证快照含完整 1398 条 sliceId→songId 映射，而 .gitignore 排除 assets/ 却包含 .trellis/tasks/，差点把答案表提交上去，提交前销毁。两个坑都写回了 asset-secrecy.md 与 pipeline-guidelines.md。顺带修正既有数字错误：text.ts 注释称 Migratory Echoes 有 10 个版本（实际 9 个）。核实过『96 首 artist 填成作曲者』这一统计不受影响——被删曲的 artist 是演唱者 Team.Luna，与作曲 Lauren Kaori/家原正樹 不重合，故只改分母 96/234→96/233。

### Git Commits

| Hash | Message |
|------|---------|
| `a02a215` | fix(assets): 移除误入曲库的人声版 リフレクトサイン (2022 Ver.) |

### Status

[OK] **Completed**


## Session 4: 首页与联机大厅的 Hero 布局与标题重构
<!-- trellis-session: v=2 fp=95f1b09b776c119f -->

**Date**: 2026-08-31
**Task**: 首页与联机大厅的 Hero 布局与标题重构
**Branch**: `main`

### Summary

用户反馈首页与 1v1 大厅的 Hero「被放在左上角、没有居中」，且标题不说明网站是干什么的。实测发现容器一直是居中的（1440 下 main x=65），偏的是内容：PrismRail 无条件按频谱柱的动态范围定高 112u，而光带线是 bottom: 0，两页都传 spectrum={false}，那 112u 整条变成光带上方 139px 的空白；同时整宽 1220px 的 Hero 行里标题框只占 446px、段落 383px，右侧 774px 无人平衡。修法：PrismRail 高度改为跟着 spectrum 走（mirror 不参与判断，牌场光带必须在几何中线上）；新增 HeroTitle，层级与 SectionTitle 相反——拉丁降为品牌标在上、中文主标题在下且是唯一 h1，两者共用抽出的 TitleBox；首页改 SHINY SONG GUESS / 闪彩猜歌，大厅改 VERSUS / 1v1 空札領地戦；Hero 补曲库数据组（曲数/片段/人声），纵向节奏从等距 mt-5/6/7/8 改为组内紧组间松、两组由光带分开；去掉 Start 的 justify-center（内容 1010px > 视口 900px，是空操作）。顺带修了过期数字：两处写死的「234 首」是 a02a215 移除人声版曲目后没同步的旧值，实际 233 首 / 1398 切片，收敛进 features/library.ts。验证：四档视口 overflowX 0、Hero 中心偏差 0、光带 112→3px、Play 仍 112u 无回归、Tab 顺序与视觉一致、reduced-motion 下 6 个 anim-appear 全部关闭、typecheck 通过、93 tests 通过、impeccable 检测器无发现。两条约定写回 DESIGN.md（The Hero-Title Rule、光带高度跟着频谱走）与 component-guidelines.md（组件为可选子元素预留的空间必须跟那个子元素同条件）。

### Git Commits

| Hash | Message |
|------|---------|
| `d3230c9` | chore(task): 08-30-hero-layout-and-title 规划产物 |
| `59e1e9e` | fix(web): 光带在不画频谱时不再预留频谱带的高度 |
| `5a898d8` | feat(web): 首页与大厅 Hero 改为居中构图，标题说明产品是什么 |
| `7efaa52` | docs: 把光带高度条件化与 Hero 标题层级两条约定写回 spec |

### Status

[OK] **Completed**
