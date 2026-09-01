# 贡献指南

感谢你愿意为这个项目花时间！这是个非官方粉丝作品，人手很少，所以先花两分钟读完这页，能省掉你我双方很多来回。

## 这个项目不收什么

先说不收的，免得你白做：

- **音源、切片、封面、曲库数据及其下载链接** —— 这些是商业音源的派生物，仓库不提供也不接受提供（见 [NOTICE](NOTICE)）。没有它，本地跑不起来完整游戏，这是预期行为。
- **官方素材的再分发** —— 角色图、语音、视频的版权归原权利人，PR 里不要新增这类素材。
- **绕开上一条的任何尝试** —— 包括「只是加个下载脚本」。
- **玩法大改** —— 不经讨论直接提一个新模式 / 新规则的实现 PR，大概率不会被合。先开 issue 说清动机和预期体验，聊得拢再动手。

除此之外都欢迎：bug 修复、性能优化、无障碍改进、已有玩法的体验打磨、测试补充、文档勘误。

## 动手前先读什么

按顺序：

1. **[README](README.md)** 的「核心设计约束」一节 —— 曲库保密、按反应时间判定这两条贯穿全局，很多「看起来能简化」的代码其实是在守它们。
2. **[PRODUCT.md](PRODUCT.md)** —— 玩家是谁、玩法定位，判断一个改动「该不该做」的依据在这里。
3. 要动的包对应的设计约束在 `.trellis/spec/` 下有逐包的规范文档（`web/frontend`、`server/backend`、`game-core/backend` 等），改代码前值得扫一眼。
4. 界面改动另读 **[DESIGN.md](DESIGN.md)**；部署相关改动另读 **[DEPLOY.md](DEPLOY.md)**。

## 本地环境搭建

```bash
# 前置：Node.js >= 20、pnpm、ffmpeg（音频处理管线需要）
pnpm install

# 构建曲库（需要你自备合法取得的 off vocal 音源放进 songs/）
pnpm assets all

# 前后端分离开发
pnpm --filter @scg/server dev   # 后端 :5179
pnpm --filter @scg/web dev       # 前端 :5173，开发时打开这个
```

没有音源也能参与：类型检查、大部分测试和前端构建都不依赖曲库（`apps/web/public` 的已入库素材足够 build）。只有 `apps/server` 里 4 个走真实曲库的测试文件跑不了——那是环境问题，不是代码问题。

## 提交前自检

CI 跑什么，你本地就先跑什么（见 [.github/workflows/ci.yml](.github/workflows/ci.yml)）：

```bash
pnpm -r typecheck                                   # 全量类型检查
pnpm --filter "!@scg/server" -r test                # 不依赖曲库的测试
pnpm --filter @scg/server exec vitest run src/ws/quota.test.ts
pnpm --filter @scg/web build                         # 前端构建
```

## 提交信息规范

用 conventional commits，subject 用中文，和现有 `git log` 保持一致：

```
fix(web): 移动端揭晓槽高度钉死，快玩不再一长一短
docs(spec): 高度预算节补「状态切换换宽导致重排」教训
feat(server): 房间列表加按 IP 配额
```

scope 用包名：`web` / `server` / `game-core` / `shared` / `prepare-audio` / `spec` 等。

## PR 流程

1. 玩法 / 行为类改动：先开 issue 或 discussion 对齐，再写代码。
2. fork 或从 `main` 拉分支，一个 PR 聚焦一件事。
3. 自检命令全过（上一节）。
4. PR 描述里写清「改了什么、为什么」，界面上能看出变化的附一张截图（移动端改动请附窄屏截图）。
5. 改动如果碰到了两条核心设计约束（曲库保密 / 反应时间判定），请在描述里明确说明你是如何继续守住它们的。

## 行为准则

同人社区，将心比心：对玩家、对其他贡献者都客气点。发现安全漏洞不要在 issue 里公开讨论，走 [SECURITY.md](SECURITY.md) 的私密渠道。
