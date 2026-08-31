# CDN 接入与带宽优化

父任务：`08-31-public-release-and-deploy`

## 问题

VPS 出站 5 Mbps ≈ 600 KB/s。当前一次冷访问要 **5.0 MB**，独占整条线 8 秒；
三人同时首访就是 25 秒黑屏。这是实际会被玩家感知到的唯一性能问题。

月流量 500 GB 反而宽松（≈ 12,500 人·小时），不是主要矛盾。

## 目标

按收益排序，不是按顺序执行的清单：

| # | 项 | 省下 | 代价 |
|---|---|---|---|
| 1 | 服务端响应压缩 | 每次冷访问 ~240 KB（JS 327K → ~90K） | 极小，无代码改动风险 |
| 2 | `bg/loop.mp4` 4.15 MB 瘦身 + 改懒加载 | 首屏的 83% | 转码 + 一处组件改动 |
| 3 | `sfx/` 6 个 WAV 300 KB 转 opus | ~270 KB | 转码 + 一处 fetch 路径改动 |
| 4 | 接入 EdgeOne | 卸掉首屏与封面的重复分发 | ¥4.8~6.8/月 + 接入配置 |

## 验收标准

- [ ] `/assets/*.js`、`/assets/*.css`、`/api/*` 的 JSON 响应带 `content-encoding`
- [ ] **切片响应不带 `content-encoding`**（`/api/clip/*`、`/api/ambience/clip/*`），
      且仍是 `cache-control: no-store`、无 `Last-Modified`
- [ ] 封面 `/cover/*`、`/thumb/*`（webp）不被压缩——已是压缩格式，再压是纯 CPU 浪费
- [ ] 冷启动首屏总字节 **< 2 MB**（当前 5.0 MB），用 DevTools 空缓存实测
- [ ] `pnpm -r test && pnpm -r typecheck` 全绿
- [ ] EdgeOne 接入后 `/ws` 能建立且记忆阶段 30 秒不中断
- [ ] EdgeOne 上 `/api/clip/*` 与 `/api/ambience/clip/*` 显式配置为不缓存

## 约束

来自 `.trellis/spec/server/backend/secrecy-and-anticheat.md`，不可协商：

- **切片绝不能走 CDN。** 一次性 token 必须由本进程校验；CDN 既取消了这层校验，
  又会缓存同一切片供反复取用。`PUBLIC_ASSET_BASE` 只适用于封面与缩略图。
- 切片响应保持 `no-store` 且无 `Last-Modified`（mtime 泄漏构建顺序 = 曲名字典序）。
- private manifest 不经 HTTP。

来自 `DEPLOY.md`：页面与 `/ws` 必须同源同端口。

## 不做

- 不为省流量降低对局切片的码率（80 kbps 是听辨质量下限，动它会改变游戏难度）
- 不做环境 BGM 的低码率副本（`ambience.ts:380` 已在页面隐藏时淡出停拉，
  实际稳态没有理论值那么糟；要做也是独立任务，涉及 `prepare-audio` 管线）
- 不生成 AAC 兜底副本
