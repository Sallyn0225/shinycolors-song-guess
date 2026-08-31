# 执行计划：CDN 接入与带宽优化

四步彼此独立，可分次交付。**第 1 步是本轮范围**，用户明确要求先装压缩层。

---

## 步骤 1 — 服务端响应压缩 ← 本轮

- [ ] `pnpm --filter @scg/server add @fastify/compress`
- [ ] `apps/server/src/app.ts` 注册插件

  位置很重要：**必须在 `@fastify/static` 之前注册**，`global: true` 的 onSend hook
  才能覆盖静态资源的响应。放在 `buildApp()` 里 `addContentTypeParser` 之后、
  第一个 `fastifyStatic` 之前。

  ```ts
  await app.register(fastifyCompress, {
    global: true,
    customTypes: /^application\/javascript(?:;|$)/u,
  })
  ```

  注释要写清三件事（这个仓库的注释风格是解释「为什么」）：
  1. 为什么在应用层而不是 Caddy/CDN —— 局域网形态没有反代
  2. 为什么音频自动被排除 —— mime-db 的 `compressible` 语义，且切片是热路径
  3. 为什么不动 brotli quality —— 2C4G 上 11 级是几百毫秒换几个百分点
  4. 压缩不引入新旁路的结论（切片不压 / token 熵满 / 曲名本就明文）

- [ ] `apps/server/src/app.test.ts` 加断言，**两个方向都要**：
  - 正向：带 `accept-encoding: gzip, br` 请求前端 JS 与一个 JSON 端点，
    响应有 `content-encoding`
  - 反向（**这条是红线防线**）：请求 `/api/ambience/clip/:token`，
    响应**无** `content-encoding`，且仍有 `cache-control: no-store`、无 `last-modified`

  > `app.inject()` 不会自动解压，直接读 header 即可。
  > 取一个可用 token：先 `GET /api/ambience/tracks?n=1` 拿 `tracks[0].clips[0]`。

- [ ] 验证：
  ```bash
  pnpm --filter @scg/server test
  pnpm --filter @scg/server typecheck
  pnpm -r test && pnpm -r typecheck
  ```
- [ ] 实测压缩率：起服务后 `curl -sH 'accept-encoding: br' -o /dev/null -w '%{size_download}\n' <url>/assets/index-*.js`，
      确认 327 KB → 100 KB 量级

**回滚点**：单次 `git revert` 即可，插件注册是加法，不改任何既有逻辑。

---

## 步骤 2 — `bg/loop.mp4` 瘦身与懒加载

- [ ] 用 `public/bg/README.md` 里的命令，CRF 38 → 42 重转，目标 < 1.2 MB；
      逐档主观验收画质，README 的参数表要同步更新
- [ ] 抽一张 poster 静帧转 webp（~30 KB）
- [ ] `ui/Backdrop.tsx`：`preload="auto"` → `preload="none"` + `poster`，
      首屏渲染完成后再触发加载
- [ ] 验证：DevTools 空缓存首屏总字节 < 2 MB

**依赖**：无。可与步骤 1 并行。

---

## 步骤 3 — `sfx/` 转 opus

- [ ] 6 个 WAV → opus，沿用 `greet/` 那套「opus 主 + m4a 兜底」的既定做法
- [ ] `sfx.ts:109` 的 fetch 路径与兜底逻辑跟着改，**不要用 `canPlayType` 判断**
- [ ] `public/sfx/CREDITS.md` 保留（CC0 署名要求）
- [ ] 验证：六个音效在 Chrome 与 Safari 都能放

**依赖**：无。

---

## 步骤 4 — EdgeOne 接入

**前置**：步骤 1~3 完成（先把字节降下来，再决定套餐是否够用），
且 `08-31-docker-deploy` 已上线可访问的源站。

- [ ] 购买个人版，站点接入，域名解析切 CNAME
- [ ] 站点加速 > 网络优化 > **WebSocket 开关打开**，回源超时 > 120s
- [ ] 规则引擎配置三条例外（见 design.md）：
      `/api/clip/*` 与 `/api/ambience/clip/*` 不缓存直接回源，`/ws` 走 WS
- [ ] 逐条验证 `research/cdn-selection.md` 的「待验证」清单（5 项）
- [ ] 跑一遍 `DEPLOY.md` 的检查清单，重点：wss 连通、记忆阶段 30 秒不掉线、
      切片响应仍 `no-store` 且无 `Last-Modified`

**回滚点**：DNS 切回源站 IP 即可，不涉及代码。

---

## 评审门

步骤 1 完成后先报告实测压缩率再继续——如果 JS 没被压缩，
说明 `@fastify/static` 的 content-type 与预期不符，需要先查清而不是继续往下做。
