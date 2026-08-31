# 设计：Docker Compose 部署

> ## 实机部署后的修正（两处，均为原设计漏掉的现实）
>
> ### 一、`WORKDIR` 必须是 `apps/server`，不能是 `/app`
>
> 首次部署直接崩：`ERR_MODULE_NOT_FOUND: Cannot find package 'tsx' imported from /app/`。
>
> `node --import tsx` 里的 `tsx` 是**裸标识符**，Node 从 CWD 开始解析。pnpm 默认
> 不做提升，`tsx` 装在 `/app/apps/server/node_modules` 下，`/app/node_modules`
> 根本不存在。原设计只想着「目录层级不能变」（那是对的），却没想到
> 层级对了不代表模块解析路径对。
>
> 改 CWD 是安全的：`catalog.ts` 用 `fileURLToPath(import.meta.url)` 取绝对路径再
> 上溯三级得到 REPO_ROOT，`config.ts` 的 webRoot 同理，都不依赖 CWD。
>
> **更根本的教训是 CI 缺口**：当时 CI 只构建不运行，「构建通过」什么都不保证。
> 已补冒烟测试——用两首假歌的合成曲库把容器真跑起来，覆盖
> 模块解析 → tsx 转译 → `Catalog.load()` → 静态注册 → HTTP 响应，
> 外加压缩与 SIGTERM 优雅关闭，冒烟不过就不推镜像。
> 这也顺带兑现了本文档原先记为「未来工作」的合成曲库 fixture。
>
> ### 二、宿主机可能已经有反代占着 80/443
>
> 目标 VPS 上跑着一个系统级 Caddy（`/usr/bin/caddy --config /etc/caddy/Caddyfile`，
> 六个站点）、1Panel，以及五个其他 compose 项目。原设计无条件起自带 Caddy，
> 在这种机器上抢不到端口，真起来了也会和现有站点打架。
>
> 改法：`caddy` 服务挪进 `profiles: ["caddy"]` 默认不启用；`app` 从 `expose`
> 改为发布到 `127.0.0.1:${APP_PORT:-5179}`。
>
> 原文「不映射端口比 `HOST=127.0.0.1` 更彻底」**只在反代同处一个 compose 网络时成立**——
> 系统级反代够不着容器名，只能经宿主机回环。绑回环而非 `0.0.0.0`，公网依然进不来。
>
> 另外 `${DOMAIN:?}` 的必填写法要改成 `${DOMAIN:-}`：compose 对整个文件做插值，
> profile 没启用也照样求值，必填写法会让不带 caddy 的 `up -d` 直接报错。


## 一、`tsx` 必须移到 `dependencies`

这不是偏好，是被 workspace 的形态逼出来的。

`@scg/shared` 与 `@scg/game-core` 的 package.json：

```json
"main": "./src/index.ts",
"exports": { ".": "./src/index.ts" }
```

**导出的是裸 TypeScript。** 所以 `apps/server` 在运行时必然需要一个能转译 TS 的
加载器，而 `"start": "tsx src/index.ts"` 正是如此。可是 `tsx` 现在挂在
`devDependencies` 里 —— 只要有人执行一次 `pnpm install --prod`，服务就起不来。

**这是一个既存的潜在缺陷，容器化只是第一个撞上它的场景。**

两条路：

| 方案 | 代价 |
|---|---|
| **A. `tsx` 移到 `dependencies`** | 运行时镜像多带 esbuild（~10MB），启动时转译约 1 秒 |
| B. 加 `tsc` 构建管线 | 要给 3 个包配 outDir 与 project references，并改 `exports` 指向产物。改动面大，且破坏「dev 与 prod 跑同一份代码」 |

**选 A。** 这个项目的既定形态就是服务端直接跑 TS（`dev` 与 `start` 都走 tsx），
容器里保持一致比省那 10MB 重要得多。

## 二、镜像

### 基础镜像：`node:22-bookworm-slim`

不用 alpine：`tsx` 依赖 esbuild 的平台二进制（`pnpm-workspace.yaml` 里专门为它
开了 `allowBuilds`），musl 上虽然通常可用，但为了省那 40MB 去赌一个构建期的
平台差异不划算。60GB 磁盘上这点体积无意义。

### 多阶段

```
deps    →  装全部依赖（含 dev，web 构建需要 vite/tsc）
build   →  pnpm --filter @scg/web build  →  apps/web/dist
runtime →  只装 prod 依赖 + 拷源码 + 从 build 拷 dist
```

### 目录层级不能变

`catalog.ts:8` 用 `resolve(here, '..','..','..')` 从 `apps/server/src` 上溯三级
得到 REPO_ROOT。因此容器内必须是：

```
/app
├── apps/server/src/     ← 源码
├── apps/web/dist/       ← 前端产物（config.ts:34 默认在这里找）
├── packages/
├── node_modules/
└── assets/              ← 运行时只读挂载，不进镜像
```

拍平目录或改 WORKDIR 都会让 `Catalog.load()` 找错路径，且**报错是「曲库为空」
而不是「路径不对」**，很难查。

### `.dockerignore` 是必需品不是优化

不写的话构建上下文包含 `songs/`(1.8GB) + `assets/`(228MB) + `node_modules/`(141MB)
+ `.git/`，光传上下文就够呛。必须排除，且要**显式排除 `assets/`**——
它是运行时挂载进来的，进了镜像就违反 R1。

## 三、compose

```
app    (无 published 端口，只在内部网络 expose 5179)
caddy  (80/443)
```

`app` 不映射端口到宿主机 —— 比设 `HOST=127.0.0.1` 更彻底，端口根本不在宿主机
网络命名空间里。容器内仍监听 `0.0.0.0`，因为要让同网络的 caddy 连得上。

### 挂载

| 挂载 | 模式 | 理由 |
|---|---|---|
| `./assets:/app/assets` | **ro** | 服务端只读；只读挂载是免费的加固 |
| `caddy_data` / `caddy_config` | rw | 证书要持久化，否则每次重启都重新申请，会撞 Let's Encrypt 速率限制 |

### 环境变量

`TRUST_PROXY=1` —— 有 Caddy 在前，且**不开的话按 IP 的三项配额会退化成全局配额**
（`DEPLOY.md` 论证过），表现是「几个人一起玩时有人建不了房」，不报错。

### healthcheck

`/api/health`。注意它会返回曲目数，所以健康 = 曲库确实挂载成功了，
比单纯探端口有意义。

## 四、Caddyfile

```caddy
example.com {
  reverse_proxy app:5179 {
    flush_interval -1
    transport http { read_timeout 120s }
  }
}
```

对照 `DEPLOY.md` 的三条硬要求：

1. **Upgrade/Connection** —— Caddy 自动处理，不用写
2. **读超时 120s** —— `read_timeout 120s`，必须大于 25s 心跳且覆盖记忆阶段的 30s 静默
3. **关缓冲** —— `flush_interval -1`

**故意不配 `encode`。** 压缩已经在 Fastify 应用层（`app.ts`），配了不会出错
（Caddy 见到 `Content-Encoding` 会跳过），但会让下一个人以为那才是生效的那层，
下次调压缩级别改错地方。

## 五、CI

### 测试边界

| 能在 CI 跑 | 不能 |
|---|---|
| `apps/web`(5) `game-core`(3) `shared`(1) `prepare-audio`(2) `server/ws/quota`(1) | `server`: `app` / `ambience` / `ws.lobby` / `ws.room` |

那 4 个走 `buildApp()` → `Catalog.load()` → 读 `assets/manifest.*.json`。
CI 上没有曲库，也不该有（那就是分发音源）。

workflow 里**必须写注释说明这个边界**，否则下一个人会以为是漏配了。

> 更好的长期解法是造一份合成曲库 fixture 让这 4 个测试也能在 CI 跑。
> 那要动测试基础设施，不在本任务范围，记在这里备查。

### 构建与推送

前端构建不需要 `assets/`（`apps/web/public` 的素材已入库），所以镜像构建在
Actions 里完全自洽。VPS 侧只有一次 `docker compose pull`。

> **注意**：镜像里含 `apps/web/dist`，也就含那些第三方素材。这与仓库公开的
> 选择一致（父任务 PRD 已记录），但 GHCR 包的可见性要与仓库一起考虑。
> 私有包的免费额度有限制，公开前先确认当前额度，不要照抄任何记忆里的数字。

## 风险

| 风险 | 处置 |
|---|---|
| 目录层级被改导致 `Catalog.load()` 找错路 | 验收里显式验 `/api/health` 返回曲目数 |
| 忘了挂 assets，容器起来但曲库为空 | healthcheck 用 `/api/health` 而非探端口 |
| Caddy 证书未持久化撞速率限制 | `caddy_data` 命名卷 |
| `pnpm install --prod` 后 tsx 缺失 | 本设计的第一节就是解这个 |
| 镜像里混进 `assets/` | `.dockerignore` 显式排除 + 验收项 |
