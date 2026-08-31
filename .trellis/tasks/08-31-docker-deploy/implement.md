# 执行计划：Docker Compose 部署

---

## 步骤 1 — 修复 `tsx` 的依赖归属

- [ ] `apps/server/package.json`：`tsx` 从 `devDependencies` 移到 `dependencies`
- [ ] 加一行注释或在 PR 描述里说明：**这不是为容器化让步，是修一个既存缺陷**——
      `@scg/shared`/`@scg/game-core` 导出裸 TS，服务端运行时本来就需要转译器
- [ ] `pnpm install` 更新 lock

**验证**：`pnpm --filter @scg/server start` 仍能起。

---

## 步骤 2 — `.dockerignore`

- [ ] 新建，至少排除：`songs/` `assets/` `node_modules/` `.git/` `.trellis/`
      `emoji/` `opening-greeting/` `bg-video.mp4` `design-extract-output/`
      `.claude/` `.agents/` `.pi/` `.zcode/` `.impeccable/` `.playwright-mcp/`
      `apps/*/dist` `**/*.tsbuildinfo`
- [ ] **`assets/` 的排除是硬要求**，不是体积优化：它运行时挂载进来，进镜像就违反 R1

**验证**：`docker build` 的 `transferring context` 应在几 MB 量级，不是 GB。

---

## 步骤 3 — Dockerfile

- [ ] 三阶段 `deps` / `build` / `runtime`，基础镜像 `node:22-bookworm-slim`
- [ ] corepack 启用 pnpm，`--frozen-lockfile`
- [ ] 目录层级严格保持 `/app/apps/server/src`、`/app/apps/web/dist`
      （`catalog.ts:8` 上溯三级取 REPO_ROOT，拍平就找错路）
- [ ] runtime 阶段不 root 运行
- [ ] `CMD` 走 `pnpm --filter @scg/server start`（保持与本地一致）

**验证**：本地 `docker build` 通过；`docker run` 挂上 assets 后 `/api/health` 有曲目数。

---

## 步骤 4 — compose + Caddyfile

- [ ] `docker-compose.yml`：`app`（不映射端口）+ `caddy`（80/443）
- [ ] `./assets:/app/assets:ro`
- [ ] `caddy_data` / `caddy_config` 命名卷（证书持久化，否则撞速率限制）
- [ ] `TRUST_PROXY=1`、`PORT=5179`
- [ ] healthcheck 打 `/api/health`
- [ ] `restart: unless-stopped`
- [ ] `Caddyfile`：`flush_interval -1` + `read_timeout 120s`，**不配 `encode`**
- [ ] `.env.example` 放域名等可变项

**验证**：本机 `docker compose up` 起得来（TLS 部分本机验不了，留到 VPS）。

---

## 步骤 5 — GitHub Actions

- [ ] `.github/workflows/ci.yml`：typecheck 全量 + **自洽测试子集**
- [ ] **注释写清测试边界**：server 的 `app`/`ambience`/`ws.lobby`/`ws.room`
      需要 `assets/manifest.*.json`，CI 上没有曲库也不该有
- [ ] `.github/workflows/release.yml`：buildx 构建并推 `ghcr.io`
- [ ] 用 `GITHUB_TOKEN` 登录 GHCR，不额外配 secret

**验证**：workflow 语法自检；真实跑要等仓库推上去。

---

## 步骤 6 — VPS 侧操作手册

- [ ] 在 `DEPLOY.md` 新增一节「Docker Compose 部署」，含：
      首次部署步骤、assets 同步方式、更新流程、回滚方式
- [ ] assets 同步：本机没有 `rsync`（Windows），给 `scp -r` 或 WSL 两条路径
- [ ] 明确列出**哪些目录不要传上 VPS**（`songs/` 1.8GB、`emoji/`、
      `opening-greeting/`、`design-extract-output/`、各 AI 工具目录）

---

## 验证（每步之后）

```bash
pnpm -r typecheck
pnpm --filter @scg/server test     # 本地有曲库，能全跑
```

## 评审门

步骤 3 完成后先本地 `docker build` + `docker run` 实测通过再往下——
镜像层级如果错了，后面 compose 和 CI 都是白搭。
