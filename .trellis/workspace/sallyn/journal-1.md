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


## Session 5: 桌面端密度与版心收紧，结算页按钮并行
<!-- trellis-session: v=2 fp=271d6de53f3dd80f -->

**Date**: 2026-08-31
**Task**: 桌面端密度与版心收紧，结算页按钮并行
**Branch**: `feat/desktop-density-tuning`

### Summary

修掉电脑端两个问题：版心几乎顶满屏宽（1440 下内容占 90.3%），以及首页与单人猜歌页要下滚。根因是 --u 只看视口宽——稿是 1440x900，而 16:9 的屏视口宽多得远比高多，按宽取到 1.16 上钳位后纵向必然溢出。改成 min(vw/1440, vh/900) 且上钳位收回 1；窄屏不加 vh 项（地址栏收起会抖）。低钳位因此在桌面常态化，给 --text-sm/--text-base 补了真 px 地板（12/13px），因为 sm 承的是正文。版心收成四个命名 token，1300u -> --page-main 1120u。单人猜歌页高度改成常量：.sc-bar 与 .sc-revealslot 从 min-height 改定高、揭晓块曲名 truncate、频谱带下放到 .sc-rail-spectrum(88u)。收紧后内容装得下却仍顶着上边排，加 .sc-vfit 用 safe center 垂直居中（裸 center 会把顶部推出视口且滚不回来）。用 Puppeteer 建了六档视口的测量门（measure.mjs），四档桌面 Start 与 Play 的纵向溢出从 +145~+306 全部归零。基线测量还推翻了两条设计推导：桌面上揭晓并不会撑高页面、选项条也没有高度不齐，出问题的是窄屏——定高仍然做了，把巧合变成约束。另外把结算页的再来一局/换个难度在窄屏并成一行等宽。

### Git Commits

| Hash | Message |
|------|---------|
| `a53f427` | feat(web): 桌面端收紧版心与密度，单人猜歌页高度恒定 |
| `362c43b` | fix(web): 结算页两个收尾按钮在窄屏并成一行 |

### Status

[OK] **Completed**


## Session 6: 删除 480px 封面档，缩略图接管揭晓与 CDN 前缀

**Date**: 2026-09-02
**Task**: 删除 480px 封面档，缩略图接管揭晓与 CDN 前缀
**Branch**: `main`

### Summary

封面两档里 480px 的 cover 从未以超过 160px 的尺寸显示过（单机揭晓槽 56u、歌牌 30u，都比旁边用 thumb 显示到 58u 的选项条还小），删掉这一档让「揭晓槽 = 选项条已下载的同一资源」成立。Play.tsx / Karuta.tsx 两处揭晓改用与 OptionBar/Result/shareCard 相同的 `/thumb/<id>.webp` 模板字符串（5 处写法一致，不抽助手），协议删 `RevealView.coverUrl` 与 `api.ts` 的 `song.coverUrl`（URL 可由 id 推导，留字段等于两套拼法），服务端删 `/cover/` 静态挂载与 `assetBase`/`coverUrl()`/`PUBLIC_ASSET_BASE`（动手前核对「切片绝不能走 CDN」红线在 DEPLOY.md 与 secrecy spec 完整存续），prepare-audio 只编 thumb 且幂等 stat 改 thumbPath（增量跑不退化全量，产物 12MB→1.8MB），本地 assets/cover 244 文件已删（线上删除留作部署动作）。测试用反向断言 `not.toHaveProperty('coverUrl')` 挡字段加回来，新增 /cover 下线测试——发现 SPA 兜底让已删路由返回 200 text/html 而非 404，断言改为 content-type 不匹配 image/；「答案必在选项里」断言补注释说明它兼负揭晓命中缓存的自动化依据。检查代理另修 5 处标识符 grep 漏网的 spec prose 陈旧引用（挂载清单、Last-Modified 段、体积数字等）。浏览器实测整局单机（内置浏览器 Web Audio 无声，全部走 15s 限时揭晓）：每题选项恰好 4 条 /thumb/ 请求、10 次揭晓全部缓存命中零新增、揭晓槽 49.8px = 56u 不变，整局真实传输仅 246KB，重复加载字节全为 0。沉淀两条 spec：SPA 兜底下删静态路由不能断言 404（断言 content-type）、删除跨层概念的残留清扫必须扫 prose 与路径字面量而非只扫标识符。遗留：线上 assets/cover 删除属部署动作需单独确认；曲目数 233/234/244 在 spec 与文档间的漂移是本次之前的历史遗留，未处理。

### Git Commits

| Hash | Message |
|------|---------|
| `e7a1454` | perf(assets): 删除 480px 封面档，揭晓改用 thumb 并移除 PUBLIC_ASSET_BASE |
| `a4a46d6` | docs: 同步封面档下线后的文档陈述与产物体积数字 |
| `98e9c28` | docs(spec): 同步挂载与协议陈述，沉淀 SPA 兜底断言与删除清扫经验 |

### Status

[OK] **Completed**


## Session 7: 单机计分与倒计时手感调整、联机记忆时长、下架感謝のコントレイル
<!-- trellis-session: v=2 fp=e5a3707b7cccc4ca -->

**Date**: 2026-09-02
**Task**: 单机计分与倒计时手感调整、联机记忆时长、下架感謝のコントレイル
**Branch**: `main`

### Summary

四项改动一次落地：speedGraceSeconds 1.5→1.8s（立项 2.0 实测偏易后折中）、memorizeSeconds 30→60s、下架 感謝のコントレイル（曲库 244→243 首 / 1464→1458 切片，含源文件与产物）、单机答题新增 ClipRail 片段播放倒计时条（audio.ts 仅加只读 getter）。trellis-check 全量审查发现 4 处 prose 漏改，全部集中在 memorizeSeconds 那条线——因为 implement.md 的 grep 词表只覆盖了下架关键词，改 N 个常量就需要 N 个扫描词，且改值时标识符 grep 完全无效，已沉淀为 cross-layer-thinking-guide 的 Constant Value Change Sweep。另订正 DEPLOY.md 反代读超时的因果陈述：兜住 proxy_read_timeout 的是 app.ts 每 25 秒的无条件心跳，不是记忆阶段时长；memorizeSeconds 是唯一有应用外消费方的旋钮，已记入 tuning-constants.md。typecheck 5/5、测试 262 项全绿。遗留：线上 VPS 素材同步（部署动作）。

### Git Commits

| Hash | Message |
|------|---------|
| `ce49ade` | feat(web): 单机答题增加片段播放倒计时条 |
| `c8e87f2` | feat(shared): 速度分宽限期 1.5→1.8s、联机记忆阶段 30→60s |
| `261e4c2` | chore(assets): 下架 感謝のコントレイル，曲库 244→243 首、1464→1458 切片 |
| `64d01fa` | docs: 同步下架与调参后的文档数字，订正反代读超时的因果陈述 |
| `dd4096d` | docs(spec): 沉淀常量改值的 prose 清扫与记忆阶段的部署耦合 |

### Status

[OK] **Completed**


## Session 8: 公开/私人房分类上限配置与大厅房间数展示
<!-- trellis-session: v=2 fp=room-limits-config-20260902 -->

**Date**: 2026-09-02
**Task**: 09-02-room-limits-config
**Branch**: `main`

### Summary

三个新部署旋钮一次落地：ALLOW_PRIVATE_ROOMS / MAX_PUBLIC_ROOMS / MAX_PRIVATE_ROOMS 进 RoomQuotas，分类上限默认跟随 MAX_ROOMS 的实际取值（不是字面量 200），MAX_ROOMS 保留为全局总闸。createRoom 校验链扩为六步（总闸 → 私人房开关 → 分类上限 → 按 IP 持有 → 频次），关闭私人房时拒绝且不降级为公开——visibility 默认 private 的失败方向在此闭环。roomList 增 privateTotal 聚合计数与 limits（分母 min 总闸），私人房 code/name/host/status 依旧零下发，lobby.test.ts 用 JSON 全文 not.toContain 断言兜底未来字段泄露。大厅计数行改两行（公开 x/N · 私人 y/M + 等人/进行中），sr-only 摘要带上限，私人房关闭时弹窗选项置灰+说明、服务端独立校验不变。浏览器实测三项人工确认全过（默认态计数、ALLOW_PRIVATE_ROOMS=0 置灰、跨标签页私人计数+1）；dev 联调时默认端口 5179 被一个拒绝访问的遗留 node 进程占用，改用 PORT=5181 + API_TARGET 绕开。typecheck 5/5、测试 262→270（server 86→94）；pnpm -r lint 在本仓结构性不存在，PRD 该条以 typecheck+test 代替。一处测试预期修正值得记住：buildApp 的 rooms 注入是 { ...SERVER_CONFIG.rooms, ...opts.rooms }，未注入的 publicMax 取环境默认 200 而非跟随注入的 max: 1000——这正是「分类上限跟随 MAX_ROOMS 实际取值」的正确表现，不是 bug。spec 同步三份（protocol-and-contracts 契约改写、server index 旋钮清单+测试数 72→94 补正、realtime-guidelines 校验顺序），secrecy-and-anticheat 与 tuning-constants 核查后确认不涉及房间、未动。

### Git Commits

| Hash | Message |
|------|---------|
| `b0b602c` | feat(server,web,shared): 公开/私人房分类上限配置与大厅房间数展示 |
| (archive) | chore(task): archive 09-02-room-limits-config |

### Status

[OK] **Completed**


## Session 9: 结算页 BGM 与跨屏续播
<!-- trellis-session: v=2 fp=ed11a37722b556c6 -->

**Date**: 2026-09-03
**Task**: 结算页 BGM 与跨屏续播
**Package**: web
**Branch**: `main`

### Summary

将 App.tsx 中管辖背景视频与 BGM 的单一 ambient 变量拆分为 video 与 bgm 两个独立判断，环境 BGM 覆盖范围扩展至单机结算页（result），进结算淡入、结算返回首页无缝续播不重起；背景视频铺设范围保持 start/lobby/room 不动，杜绝视觉副作用。同步修正 secrecy-and-anticheat.md 的覆盖屏描述（AC8）。禁区文件零改动，全仓 typecheck 和 270 项测试全绿通过。

### Git Commits

| Hash | Message |
|------|---------|
| `f2a7996` | feat(web): separate video and BGM conditions, enable ambient BGM on result screen |

### Status

[OK] **Completed**


## Session 10: 建房弹窗内展示拒绝错误与占用提示
<!-- trellis-session: v=2 fp=78a590b92c560c17 -->

**Date**: 2026-09-03
**Task**: 建房弹窗内展示拒绝错误与占用提示
**Package**: web
**Branch**: `main`

### Summary

实现并在建房弹窗内展示公开房间已满等错误提示，补齐提交中禁用防连击，并在提交前提供占用指示

### Main Changes

- 建房弹窗打开时将 WebSocket error 分流至弹窗内部，弹窗保持打开以允许切换选项重试
- 增加 submitting 状态与 submittingRef 同步锁，提交中禁用按钮并防高频连击消耗配额
- VisibilityChoice 支持 limits、公开房总数与私人房总数，在提交前指示占用情况与已满提示

### Git Commits

| Hash | Message |
|------|---------|
| `09d9837` | feat(web): show room creation error inside dialog with pending state and quota hint |

### Testing

- [OK] pnpm typecheck、pnpm test 及 apps/web build 均全绿通过

### Status

[OK] **Completed**

### Next Steps

- 继续推进父任务下其余子任务（09-03-local-stats-trophy / 09-03-abandoned-room-cleanup）


## Session 11: 全员离线房间即时回收 + 半开重连竞态修复
<!-- trellis-session: v=2 fp=e75074c79506b509 -->

**Date**: 2026-09-03
**Task**: 全员离线房间即时回收 + 半开重连竞态修复
**Branch**: `main`

### Summary

房里一条活连接都不剩时立刻 dropRoom 并作废座位凭证，取代原先依赖 abandonedTtlMs(65s)+5s 清扫的滞后回收；判据是 allOffline 而非 isEmpty，因为 detach 保留座位给重连。sweep 的 abandoned 分支逻辑与常量未动，降级为异常路径兜底。顺带修了被本次改动放大的半开连接竞态：reattach 成功时用 releaseSeatPointers 转移座位所有权，否则半开旧 socket 迟到的 close 会 detach 掉新连接、并在对手也离线时把房间销毁。检查阶段用双向变异测试验证了新用例并非空跑，据此抓出 T4 的空断言（订阅早于建房，waitList 扫全缓冲区被建房前的空快照凭空满足）。server 94->102 测试，全仓 278 全绿。仓库无 lint 脚本，AC7 的 lint 条款为空条款。遗留：阶段 5 手工验收未跑；shared/web 的 spec 测试数字陈旧未订正。

### Git Commits

| Hash | Message |
|------|---------|
| `6f503fe` | feat(server): reclaim deserted rooms immediately and invalidate seat tokens |
| `701b79e` | test(server): cover the half-open reconnect race |
| `c1223aa` | docs: update room lifecycle docs for instant reclamation |

### Status

[OK] **Completed**


## Session 12: 本地战绩统计与奖杯面板
<!-- trellis-session: v=2 fp=3fb5254aa368a16d -->

**Date**: 2026-09-03
**Task**: 本地战绩统计与奖杯面板
**Branch**: `main`

### Summary

单机结算按 sessionId 幂等落进 localStorage，简单/困难分两档存，首页 ToolRail 加第五枚奖杯按钮进独立的 Records 屏。两个口径有意不同并在调用点各写了注释：模式总正确率沿用结算页的 correct/total（含未作答），组合与单曲榜的分母不含 correct === null。组合榜只收 8 个常设组合 + 全体曲，shuffle unit 与无归属曲目仍计入分数和易错榜。阈值 UNIT_MIN=5 / SONG_MIN=3，未达标显示「样本不足」而不是 0%/100% —— 243 首曲库配一局 10 题，长期以样本不足为主是正常状态。存储照 prefs.ts 写，版本不认识直接回落到空、不迁移。

质检抓到三处会静默失效的样式缺陷，都是「无类型错误、无警告、声明根本没落地」这一类：--cut-card 这个变量名不存在（.cut-card 实际读 --cut-lg），切角一直停在 40u 默认值并吃掉 p-4 内容；--surface-correct token 不存在，「最高」标记底色渲染为透明；传给 ui/Button 的 style 排在 {...rest} 之后被组件整块覆盖。另外修了 5 处 Button 调用点重复 sfx.play 导致的双响，以及组合榜 role="table"+role="row" 无 cell、行级 aria-label 把行内百分比/样本数/最高最低标记全盖掉的问题，改成 ul/li。这五条已写进 component-guidelines.md。

阶段 6 的 /impeccable 与 dataviz 复核未跑，视觉走人工验收：sallyn 逐条走完六档视口、无痕模式、坏数据注入、幂等与清除的清单，全部通过。遗留已知项：.cut-slant 上用 inset 0 0 0 1px 画描边落在 quality-guidelines「坑三」范围内，但 Start.tsx:327 已有同样写法，未单方面改，值得单开一条统一处理。web 87 -> 113 测试，全仓 304 全绿。

### Git Commits

| Hash | Message |
|------|---------|
| `5b6e9ff` | feat(web): add local solo match statistics with a trophy screen |
| `935b55f` | docs: record the Records screen and three silent-failure pitfalls in the web spec |
| `ab39e30` | chore(task): add planning artifacts for the stats task tree |
| `c2d422f` | chore(task): record acceptance results for the stats task |

### Status

[OK] **Completed**


## Session 13: PVP 主动退出流程与 peerLeft 契约
<!-- trellis-session: v=2 fp=5263769d086b2e71 -->

**Date**: 2026-09-03
**Task**: PVP 主动退出流程与 peerLeft 契约
**Branch**: `main`

### Summary

为联机对局补上主动退出：新增 peerLeft 服务端消息（携带退出者座位、昵称与重置后的 RoomView），服务端 resetToLobby() 镜像 startMatch() 让房间退空一半后仍可复用，前端加退出入口、二次确认层与 10s 横幅倒计时。掉线路径零改动，由「退出 ≠ 掉线」回归护栏钉住。310 测试全绿，用户实机走查 7 条通过。走查中发现既有缺陷：座位凭证存 sessionStorage，关标签页即失效，掉线方重开链接无法重连——已另立任务。

### Git Commits

| Hash | Message |
|------|---------|
| `489970c` | feat(pvp): let a player leave a match without it reading as a disconnect |
| `ff0b97e` | docs: record the leave-vs-disconnect contract and the board's 6px budget |
| `173eae8` | chore(task): record acceptance results for the pvp exit task |

### Status

[OK] **Completed**


## Session 14: 断线重连找回与放弃重连
<!-- trellis-session: v=2 fp=66ccabfb8b5ed01a -->

**Date**: 2026-09-03
**Task**: 断线重连找回与放弃重连
**Branch**: `feat/reconnect-recovery`

### Summary

掉线方重开链接后能在宽限期内找回对局。座位凭证从 sessionStorage 搬到 localStorage 并带过期戳，防抢座改由新增的零副作用探测 hello{claim:false} -> seatOffer{ok|busy|gone} 承担，刻意不放进 reattach()（那会砸掉半开连接的正常重连）；Splash 上摆出「找回对局 / 放弃重连」二选一。

手动走查暴露出三个缺陷，都已修并沉淀进 spec：(1) 凭证过期戳从「发放时刻」起算，一局牌远超 75s，凭证在对局进行中就自己过期，找回入口和同标签页 F5 一起废掉 —— 改为由心跳续期，跟着「最后一次还在座位上」走；(2) 启动 effect 拿 socket.hasResumeToken 当早退判据，而 parkSeat() 正是把它改成 false 的那个动作，StrictMode 双跑时第二遍直接返回，探测消息一次都没发出去 —— 只在 dev 复现，与本项目惯常的「本地好、线上坏」方向相反；(3) resuming 一个 state 同时表达「加载中」和「这次打开的性质」，两者在恢复成功那一刻要求相反的值，导致刷新后 Splash 掉回首次访问支线、完整播一遍开场问候 —— 改为由 screen 推导。

验证：pnpm -r test 114 passed（座位探测 6 条：零副作用 / ok / busy / gone / 放弃重连 / 回归护栏）、typecheck 全绿；Playwright 端到端走查了新标签页找回、同标签页 F5 静默恢复、首次访问三条路径；用户在手机 + 电脑真机联机复测通过。

### Git Commits

| Hash | Message |
|------|---------|
| `9f18c9c` | feat(pvp): offer a disconnected player their seat back on reopen |
| `3cbaac7` | docs: record the seat-credential contract and two dev-only React traps |
| `77e9a4e` | chore(task): add planning artifacts for the reconnect recovery task |

### Status

[OK] **Completed**


## Session 15: 联机歌牌音效：程序化合成替换素材包
<!-- trellis-session: v=2 fp=71d183d7ca1481a9 -->

**Date**: 2026-09-03
**Task**: 联机歌牌音效：程序化合成替换素材包
**Branch**: `main`

### Summary

把 sfx.ts 从 fetch+decodeAudioData 换成运行时 Web Audio 合成，音色参数拆到可单测的 sfxVoices.ts（16 个音色）；联机牌场 Karuta.tsx 接入抢牌/送札/对局节点/对手上下线音效；删除 public/sfx 素材并同步 LICENSE、NOTICE、spec index。过程中修掉三个计划外问题：判定音原计划挂 roundResult 会迟到 10 秒（改挂自带 taps/winner 的 roundReveal 并按回合号去重）、sfx.play 只判 ctx 存在不判是否 running 导致挂起期间音效会攒着齐发（改判 audio.unlocked）、reattach 的 peer 广播不排除当事人导致自己重连误响 peerOn（加座位守卫）。三条契约已写入 server realtime-guidelines 与 web quality-guidelines。遗留：case 'peer' 的横幅与宽限倒计时仍未按 playerId 过滤，属 reconnect-recovery 范围。

### Git Commits

| Hash | Message |
|------|---------|
| `3b53d2d` | feat(sfx): synthesise UI sound cues at runtime instead of loading assets |
| `0b7d939` | chore(sfx): drop the CC0 audio pack now that cues are synthesised |
| `7536d03` | feat(pvp): give the karuta board sound cues for taps, okuri and peer events |
| `4868f23` | docs: record the peer-broadcast contract and the suspended-context audio gate |

### Status

[OK] **Completed**


## Session 16: 上线 29 首新曲（HOPEFUL FE@THERS 28 首 solo + 泡沫に染まる）
<!-- trellis-session: v=2 fp=4cd126c6fe19072e -->

**Date**: 2026-09-10
**Task**: 上线 29 首新曲（HOPEFUL FE@THERS 28 首 solo + 泡沫に染まる）
**Package**: prepare-audio
**Branch**: `main`

### Summary

把「闪猜歌即将上线曲目/」里的 29 首伴奏上线成可玩曲目：28 首来自 2026-09-16 发售的三张 HOPEFUL FE@THERS（LACA-25301/302/303，批次里的三张 jpg 就是专辑封，据此定位到官方页与曲目表），1 首是 シャニソン 2026-08-01 的夏季乐曲「泡沫に染まる」（8 人、每个常设组合各一人）。曲库 243→272 首、切片 1458→1632 个，全部 6 段、L0 无降级。

最大的发现是这批素材的形态：29 个文件是**无任何标签的 WAV**（format.tags 与 stream.tags 全空），曲名/演唱者/专辑只存在于文件名与人脑里，而 `scan()` 的输入契约是「每目录恰好 1 个 mp3 + 1 个 jpg + 有 ID3 title」。两条路——放宽 scan 接受 wav，或在前面补一层规范化——选了后者：切片最终是 80kbps mono Opus，320kbps CBR mp3 的插入损失远低于该阈值，而「所有 mp3 同形」这条隐含前提（含 `slice.ts` 里 `-map 0:a:0` 跳过内嵌封面流那条注释的前提）值钱得多。于是有了 `ingest` 这个新 stage：人只判断曲名/演唱者/专辑（写进 data/ingest.json），转码/命名/ID3 写入/完整性校验归工具。

ingest 的两条设计约束是有代价换来的。**不进 `all`**：`all` 的语义是 songs/ → assets/，而 ingest 的产物是 songs/ 本身，塞进去等于「重建曲库」隐含改写曲库源。**规划期整批拒绝**：`planIngest()` 在「源目录里有未列入的 wav」时直接不执行——漏一首曲子不会以任何方式显形，曲库只会静默少一首，没人会去数 272 和 271 的差别。同组的另五条（源文件/封面缺失、角色名不在 units.json、character 与 performers 二选一、曲名重复或带 (Off Vocal) 后缀、album key 不存在）同理，一条坏数据只挡它自己、不牵连同批其它曲目（有单测钉住）。

验证的核心是 sliceId 稳定性：构建前把 manifest.private 的 songId→sliceId[] 抽成快照**写到仓库外**（它就是答案表，asset-secrecy 明令不得入库），构建后逐条 diff → 旧 243 首**零变化**，174 条新 id 全是新的。这同时验证了「扩容量级不碰老曲」：不 bump STAGE_VERSIONS、不 --force，analyze 缓存命中 243/272、slice 跳过 1458/1632，零重编码。防作弊自检 min=max=151504B、跨度 0B，新曲切片与老曲字节数完全相同，大小旁路没有因为扩容被打开。

数字清扫这次一次做完（历史上 233/234/244 三个值在同仓不同文件里漂移过）：LIBRARY 272/1632、app.test.ts 断言、records.ts 两处注释、Records.tsx 屏上文案、PRODUCT/NOTICE/DEPLOY/PROGRESS、docker-compose 注释、prepare-audio 六处源码注释与 albums.json、六份 spec；并订正 PROGRESS 里停在 2026-09-03 的测试计数 304→412。剩三条 grep 命中是有意保留的历史叙述（library.ts 的「原本写死 234 首」、PROGRESS 增量耗时行、Backdrop 的颜色分量）。

规划里写错两处，按实测落笔：以为要靠 normalizeName() 兜住 `関根 瞳` 这种带空格署名，实测 units.json 里是无空格写法、带空格的是现役旧署名；批次封面是专辑封（9/9/10 首共用三张），查过现役曲库有 67 组缩略图字节完全相同，共用封面是既有常态而非本次引入。另发现 assets/audit-ratings.json 有 1 条 sliceId 已失效，不在本次快照里、是该本地草稿本来的陈旧条目，未动。

顺带把 buildMeta 里的「角色→CV 成员」查找提成 resolveUnit.ts#memberOf()，让 ingest 与显示名生成共用同一次查找（否则 CV 表会有第二份读法）。审查中发现一处**既有死代码未动**、留给用户决定：apps/web/src/screens/Lobby.tsx:13 的 `import { LIBRARY }` 从 a29320e 起就没再被用过。

人工验收由用户在本机完成：:5179 实机走查（首页数据组 272/1632、窄屏不溢出、新曲专辑封显示、新曲名在牌面不裁）+ :5178 抽检台试听确认 29 首无人声。服务已关，无残留进程。遗留：线上 VPS 的 assets/ 同步属部署动作。

### Git Commits

| Hash | Message |
|------|---------|
| `9210fb9` | chore(task): 09-10 上线新曲任务的规划产物与取证 |
| `10825d5` | feat(prepare-audio): 新增 ingest 环节，把上线暂存区的音源规范化进 songs/ |
| `47ecfc8` | chore(web,server): 曲库规模同步为 272 首 / 1632 切片 |
| `06e5834` | docs: 同步扩容后的曲库数字与体积 |
| `31c4bdb` | docs(spec): 记录 ingest 环节与「规划期必须拒绝漏列 wav」的判据 |
| `e68bb77` | chore(task): 记录新曲上线的验收结果与人工确认 |
| `d03666b` | chore(task): archive 09-10-upcoming-tracks-ingest |

### Testing

- [OK] pnpm -r typecheck 5/5 干净；pnpm -r test 412 passed（shared 17 / game-core 62 / web 195 / server 114 / prepare-audio 24）
- [OK] pnpm assets all：analyze 缓存命中 243/272、slice 跳过 1458/1632、selfCheck 字节数 151504 min=max 跨度 0B、assertPublicManifestClean 通过
- [OK] sliceId 快照 diff：旧 243 首零变化、新 174 条全新增；assets/slices 1632 个 opus、assets/thumb 272 张
- [OK] pnpm assets stress：简单 3000 题 / 困难 6000 题无重复选项、答案始终在选项内，曲库覆盖 100% / 98%
- [OK] 端到端抽题：单机 82 轮、1v1 22 局后 29 首新曲全部覆盖；PORT=5199 下 /api/health=272、/api/clip 返回 200 audio/ogg 151504B no-store

### Status

[OK] **Completed**

### Next Steps

- 线上 VPS 的 assets/ 同步（部署动作，需访问凭证）


## Session 17: 删除上线暂存目录与失效导入，发布 v0.2.2
<!-- trellis-session: v=2 fp=2f7919824402a438 -->

**Date**: 2026-09-10
**Task**: 删除上线暂存目录与失效导入，发布 v0.2.2
**Package**: prepare-audio
**Branch**: `main`

### Summary

小尾巴一轮：删掉大厅里失效的 LIBRARY 导入（a29320e 改版把大厅的「从 243 首里抽 30 首」换成「从曲库中随机抽取」之后，那个 import 就再没被用过，全文件只出现 1 次），并把上线暂存目录「闪猜歌即将上线曲目/」（29 个 WAV + 4 张封面，2.12GB）**移入回收站**（不是永久删除；删之前逐条核对 29 首都在 songs/Page26 里、且 manifest 里 29 首都在）。

删目录引出一个必须一起修的问题：批次表是留档不是待办清单。源目录清掉之后 `pnpm assets ingest` 会在已消费的批次上永远抛 ENOENT，逼人删掉留档才能让 CLI 跑通。改为新增 `ingest.ts#dirExists()`，源目录不存在时报「该批次应已消费，跳过」并计入汇总，不算失败。这里有个要点：**未列入 wav 的拒绝检查必须保留在「源目录存在」这条分支内**——两者都是「源目录里的东西」，但一个是漏歌（必须拦）、一个是已消费（必须放过）。已写入 pipeline-guidelines spec。

版本 0.2.2：六个 package.json 统一 bump，提交 → 推 main → 打 tag → 推 tag → 发 release。release 正文照 v0.2.1 的格式（💡 本次更新重点 + 📝 全部更新与对应提交，按分类列 commit hash），另加一条自建实例的提醒：仓库不含音频，拉代码后要重新同步 assets/ 才会真的可玩。CI 与 Build and push image（main 与 v0.2.2 两条）全部 success。

顺带发现仓库有一个外部 PR #1「Add i18n support and complete localization for user-facing text」（mitian233），当前 CONFLICTING —— 大概率与本次升级后的文案/常量冲突有关，未介入。

### Git Commits

| Hash | Message |
|------|---------|
| `40124da` | chore: 删掉大厅里失效的 LIBRARY 导入，ingest 容忍已消费的批次 |
| `47b26ef` | chore(release): bump version to 0.2.2 |

### Testing

- [OK] pnpm -r typecheck 5/5 干净；prepare-audio 24 tests passed
- [OK] pnpm assets ingest 在已消费批次上输出「源目录不存在——该批次应已消费，跳过」并正常退出 0
- [OK] 删目录前核对：29 首 WAV 全部在 songs/Page26（29 个目录、每个 2 个文件）且全部在 manifest 里
- [OK] GitHub Actions：CI success、Build and push image 的 main 与 v0.2.2 两条都 success

### Status

[OK] **Completed**

### Next Steps

- VPS：docker compose pull && docker compose up -d，再 rsync 本地 assets/（240MB）——用户用 ssh 凭证自行处理
