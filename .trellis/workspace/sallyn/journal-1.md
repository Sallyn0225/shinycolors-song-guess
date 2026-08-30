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
