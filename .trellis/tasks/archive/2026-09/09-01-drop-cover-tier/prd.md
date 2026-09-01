# 删除 480px 封面档，缩略图接管揭晓与 CDN 前缀

## Goal

封面资产现在有两档：`assets/thumb`（160px）和 `assets/cover`（480px）。480px 这一档
**没有任何一处以超过 160px 的尺寸被显示过** —— 单机揭晓槽 `56·u`、歌牌揭晓 `30·u`，
而同屏的选项条早就在用 160px 的 thumb 显示到 `58·u`。它比它旁边那张缩略图还小，却背着
6.7–10 倍于显示尺寸的源图。

删掉这一档，揭晓处改用 `/thumb/`；`PUBLIC_ASSET_BASE` 随之一并删除。

## 事实依据

实测（2026-09-01，244 首）：

| | 源图边长 | 数量 | 总体积 | 单张均值 |
|---|---|---|---|---|
| `assets/cover` | 480px | 244 | **10.58 MB** | 44.4 KB |
| `assets/thumb` | 160px | 244 | 1.85 MB | 7.7 KB |

`--u` 取值区间 0.78–1.28px（`apps/web/src/index.css:54,58`），各处实际渲染尺寸：

| 位置 | 用的哪档 | CSS 尺寸 | 设计单位 |
|---|---|---|---|
| `Play.tsx:312` 单机揭晓槽 | **cover** | 44–72px | `56·u` |
| `Karuta.tsx:732` 歌牌揭晓 | **cover** | 23–38px | `30·u` |
| `OptionBar.tsx:119` 答题选项 | thumb | 45–74px | `58·u` |
| `Result.tsx:204` 结算逐题行 | thumb | 31–50px | `40·u` |
| `shareCard.ts:567` 分享卡 | thumb | 44px | 卡面坐标 |

**单机模式下换成 thumb 是零字节的**：`app.test.ts:196` 已经钉死「揭晓的答案必须确实在选项里」
（`q.options[body.answerIndex]?.id === body.song.id`），而 `Play.tsx:373` 的
`showThumb={phase === 'revealed'}` 让四个选项在揭晓的同一帧渲染各自的 `/thumb/<id>.webp`。
揭晓槽改用同一个 URL 后是浏览器缓存命中，不产生新请求。

歌牌模式没有选项缩略图，是一次真实请求，但 44 KB → 7.7 KB。

## Requirements

### R1 揭晓处改用缩略图

1. 单机揭晓槽（`Play.tsx:308`）与歌牌揭晓（`Karuta.tsx:728`）的图片源改为
   `/thumb/<songId>.webp`。
2. 显示尺寸（`56·u` / `30·u`）与形状（`.cut-hex`）**一律不动**，这次只换字节不换版面。

### R2 删掉 480px 这一档产物

1. `tools/prepare-audio` 的 `covers` 阶段不再生成 480px，`assets/cover` 不再被创建。
2. 服务端不再挂载 `/cover/` 静态路由。
3. 协议里的 `coverUrl` 字段删除 —— 前缀能力没了之后它完全可由 `songId` 推导，
   而另外三处（选项 / 结算 / 分享卡）本来就是自己拼的。留着等于两套拼法。

### R3 删掉 PUBLIC_ASSET_BASE

1. 删除 `SERVER_CONFIG.assetBase`、`coverUrl()`，以及 `.env.example` / `docker-compose.yml` /
   `DEPLOY.md` / `PROGRESS.md` 中的对应条目。
2. **「切片绝不能走 CDN」的论证不许跟着一起消失。** 它现在挂在 `config.ts:74-75` 的
   `assetBase` 注释上，删字段等于删论证。必须先确认这条红线在 `DEPLOY.md:282-288` 与
   `.trellis/spec/server/backend/secrecy-and-anticheat.md` 中完整存续，再动 `config.ts`。

### R4 文档与 spec 同步

改动会让至少 9 处文档与 spec 的陈述变成假话，逐条列在 `implement.md`。其中
`.trellis/spec/server/backend/secrecy-and-anticheat.md:18`（「只挂载 cover 和 thumb」）
和 `.trellis/spec/prepare-audio/backend/asset-secrecy.md:114`（下架单曲要删 cover 文件）
是**会被人当操作手册照做的**，不是措辞问题。

### R5 清理既有产物

本地与线上已经存在的 `assets/cover/`（244 个文件）不会被工具自动清理。
线上删除属于部署动作，需单独确认后执行。

## Acceptance Criteria

- [ ] 单机跑完一局：揭晓槽显示封面且尺寸与改动前一致；DevTools Network 里
      `/thumb/<answerId>.webp` 只有一次网络请求，揭晓槽那次是 `(memory cache)` 或 `(disk cache)`
- [ ] 歌牌跑完一局：揭晓处显示封面，尺寸与改动前一致
- [ ] `GET /cover/<任意 id>.webp` 返回 404
- [ ] `pnpm assets covers --force` 跑完，`assets/cover` 目录不被创建；阶段输出的体积
      数字只统计 thumb
- [ ] 全仓 grep 无残留：`coverUrl`、`PUBLIC_ASSET_BASE`、`coverPx`、`COVER_DIR`、`coverPath`
- [ ] `pnpm typecheck` 与 `pnpm test` 全绿
- [ ] `DEPLOY.md`「切片绝对不能走 CDN」三条理由完整保留

## Constraints

- **不改任何显示尺寸。** `.sc-revealslot` 的高度地板 64u 是按 56u 的图算出来的
  （`.trellis/spec/web/frontend/quality-guidelines.md:350`），改尺寸会连带重算版面预算。
- **不引入 `thumbUrl()` 助手。** `PUBLIC_ASSET_BASE` 删掉后没有前缀要注入，5 处都是
  同一句模板字符串，与现有三处写法保持一致即可。这与今天归档的
  `09-01-fix-deploy-cdn-doc` 的结论方向一致。
- 客户端与服务端同镜像发布，删协议字段不需要兼容期。

## 已知取舍

**DPR 3 的手机上揭晓槽会有 1.34× 放大。** 最坏情形是视口宽 480–767px（`--u` 取到上钳位
1.28）的 3 倍屏：`56·u` = 71.7 CSS px = 215 设备像素，而源图 160px。

判定为可接受：同一屏上紧挨着的选项条（`58·u` = 74 CSS px）用的就是同一张 thumb，
不会出现「一张清楚一张糊」的对比，孤立看也没有参照物。

## 不做

- 不动 `thumbPx=160`。要提清晰度是另一件事，且会同时改变全部 5 处的字节数。
- 不给 thumb 做 `srcset` / 多档响应式。当前只有一个显示尺寸区间，两档回到了本任务要删的
  那个问题上。
- 不动切片、氛围、开场头像等其它资产路径。

## 被本任务推翻的既有决定

`.trellis/tasks/archive/2026-09/09-01-fix-deploy-cdn-doc` 的结论是「thumb 保持相对路径，
不引入 thumbUrl，`PUBLIC_ASSET_BASE` 只作用于 cover」。本任务把 cover 删了，那个前缀
从此没有作用对象 —— 不是推翻它的论证，是抽掉了它的前提。线上（283guess.hmhnk.top）
是整站挂 EdgeOne 的形态，图片本来就随站走边缘缓存，独立前缀在实际部署里从未生效过。
