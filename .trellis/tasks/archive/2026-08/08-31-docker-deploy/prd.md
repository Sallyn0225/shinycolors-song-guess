# Docker Compose 部署

父任务：`08-31-public-release-and-deploy`

## 目标

一条可重复的部署路径：VPS 上 `docker compose up -d` 起服务，域名 https 可访问，
镜像由 GitHub Actions 构建并推 GHCR，VPS 只负责拉取。

## 关键前提（已核实，不是假设）

| 事实 | 出处 | 后果 |
|---|---|---|
| `@scg/shared` / `@scg/game-core` 的 `exports` 直接指向 `./src/index.ts` | 两个包的 package.json | **运行时必须能转译 TS**，`tsx` 是运行时依赖而非开发依赖 |
| `REPO_ROOT = resolve(<server/src>, '..','..','..')` | `catalog.ts:8` | 容器内目录层级不能变：源码必须在 `/app/apps/server/src` |
| `webRoot` 默认 `REPO_ROOT/apps/web/dist` | `config.ts:34` | 前端产物必须在 `/app/apps/web/dist` |
| 4 个 server 测试需要曲库才能跑 | `app` / `ambience` / `ws.lobby` / `ws.room`，另 12 个测试文件自洽 | **CI 不能无脑跑 `pnpm -r test`** |
| 前端构建不需要 `assets/` | `apps/web/public` 的素材已入库 | 镜像构建完全自洽，可在 Actions 里完成 |
| 服务端已有应用层压缩 | `08-31-cdn-and-bandwidth` 步骤 1 | **Caddy 不要再配 `encode`** |

## 需求

### R1 — assets 不进镜像

`assets/` 228MB。进镜像有两个独立的问题：每次改代码重建都要重新落一遍
这 228MB 的层（5Mbps 上行不可接受），且它是商业音源的派生物，不该进镜像仓库。

用 bind mount，且**只读**——服务端只读不写。

### R2 — 镜像在 Actions 构建，VPS 只拉取

VPS 是 2C4G/5Mbps。在上面跑 `pnpm install` + `vite build` 意味着每次部署都要
拉一遍上百 MB 的依赖。改成 Actions 构建 + GHCR 托管后，VPS 侧只有一次镜像拉取。

### R3 — CI 必须诚实地处理「测试需要曲库」

`.trellis/spec/server/backend/quality-guidelines.md` 已写明测试需要
`assets/manifest.*.json`，「失败是环境问题不是代码问题」。CI 上没有曲库，
所以 workflow 只能跑自洽的那 12 个测试文件，并**在文件里写清为什么**，
否则下一个人会以为是漏配。

### R4 — 反向代理的三条硬要求

来自 `DEPLOY.md`，漏一条就是线上故障：

1. 转发 `Upgrade`/`Connection`，否则 WS 握手退化成普通 GET
2. 读超时 > 心跳间隔，取 **120s**（记忆阶段有 30 秒静默）
3. 关响应缓冲，否则起播指令被推迟，两端听到的时刻对不齐

## 验收标准

- [ ] `docker compose up -d` 起来后 `/api/health` 返回曲目数
- [ ] 页面可访问，DevTools → WS 里那条连接是 **wss**
- [ ] 建房 / 进房 / 开局跑通，记忆阶段挂满 30 秒不掉线
- [ ] 容器内 `/app/assets` 是只读挂载，镜像里**不含** `assets/`
- [ ] 镜像构建不需要 `assets/`，`.dockerignore` 排除了 `songs/` `assets/` `node_modules/` `.git/`
- [ ] Actions workflow 跑 typecheck 全量 + 自洽测试，且注释说明了为什么跳过 server 的 4 个
- [ ] Caddyfile **没有** `encode`（压缩已在应用层）
- [ ] `SIGTERM` 能优雅关闭（`index.ts` 已实现，验证容器 stop 不硬切对局）

## 不做

- 不做多机 / 编排 / 自动扩缩
- 不引入数据库（房间在内存、重启即丢是既有设计）
- 不在本任务里做 CDN（归 `08-31-cdn-and-bandwidth`）
- 不改任何游戏逻辑
