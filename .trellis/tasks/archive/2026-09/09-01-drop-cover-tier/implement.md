# 执行计划：删除 480px 封面档

六步。第 1 步是纯核对不改代码，第 2–4 步必须一起完成（中间态过不了 typecheck），
第 5–6 步可分次交付。

---

## 步骤 0：核对红线注释的去处（不改代码）

`apps/server/src/config.ts:74-75` 的「切片绝不能走 CDN」论证会随 `assetBase` 一起被删。
动手前先睁眼确认它在别处存续：

- [ ] `DEPLOY.md:282-288` —— 三条理由的完整版（一次性 token / `no-store` 缓存旁路 /
      批量预下载在日志里要显眼）
- [ ] `.trellis/spec/server/backend/secrecy-and-anticheat.md` —— 红线条目

两处都在才继续。缺任一条，先把论证补到 `DEPLOY.md`，再回来做第 3 步。

---

## 步骤 1：前端两处揭晓改用 thumb

先做前端，这样即使后面几步分次交付，「省流量」这个收益也已经到手。

- [ ] `apps/web/src/screens/Play.tsx:308`
      `src={result.song.coverUrl}` → `` src={`/thumb/${result.song.id}.webp`} ``
- [ ] `apps/web/src/screens/Karuta.tsx:728`
      `src={revealed.coverUrl}` → `` src={`/thumb/${revealed.songId}.webp`} ``

**不动**这两处的 `width`/`height`/`className`/`loading`。

写法与 `OptionBar.tsx:114`、`Result.tsx:199` 对齐（同一句模板字符串，不抽助手函数）。

验证：`pnpm --filter @scg/web dev` 跑一局单机 + 一局歌牌，图片正常显示、尺寸无变化。
此时服务端还在发 `coverUrl`，只是没人用了。

---

## 步骤 2：删协议字段

- [ ] `packages/shared/src/protocol.ts:162` —— `RevealView` 删 `coverUrl: string`
- [ ] `apps/web/src/api.ts:41` —— `AnswerResult.song` 删 `coverUrl: string`

---

## 步骤 3：服务端删 `/cover` 与 `PUBLIC_ASSET_BASE`

- [ ] `apps/server/src/config.ts`
  - 删 `assetBase` 字段（`:70-77`，含整段注释）
  - 删 `coverUrl()`（`:147-150`）
- [ ] `apps/server/src/app.ts`
  - 删 `/cover/` 静态注册整段（`:132-142`）。**保持 `/thumb/` 那段的
    `decorateReply: false` 不动** —— 全仓无 `reply.sendFile` 调用，无人装饰是正确状态
  - `:14` import 去掉 `coverUrl`
  - `:252-253` 注释「`/cover` 与 `/thumb` 是 webp」→ 只说 `/thumb`
  - `:386` 删 `coverUrl: coverUrl(song.id),`
- [ ] `apps/server/src/ws/room.ts` —— `:37` import、`:587`、`:665` 三处
- [ ] `apps/web/vite.config.ts:15` —— 删 `/cover` 代理

验证：`pnpm typecheck` 应当全绿（步骤 1–3 是一个原子改动，到这里才自洽）。

---

## 步骤 4：测试

- [ ] `apps/server/src/app.test.ts:194`
      `expect(body.song.coverUrl).toBe(...)` →
      `expect(body.song).not.toHaveProperty('coverUrl')`
      （改成反向断言而不是删掉，挡住将来有人加回来）
- [ ] `apps/server/src/app.test.ts:196`（答案必在选项里）**不动**，在它上方补一句注释：
      这条断言同时是「揭晓槽能命中选项条已下载的 thumb」的唯一自动化依据
- [ ] `apps/server/src/app.test.ts` 新增：`GET /cover/<id>.webp` 返回 404
- [ ] `apps/server/src/ws/room.test.ts:250`
      `expect(res.result.revealed.coverUrl).toMatch(/^\/cover\//)` 删除
- [ ] `apps/web/src/features/narrate.test.ts:12` —— fixture 里删 `coverUrl`

验证：`pnpm test`。

---

## 步骤 5：资产工具不再生成 480px

- [ ] `tools/prepare-audio/src/config.ts`
  - `:16-17` 删 `COVER_DIR`
  - `:69-73` `COVERS` 删 `coverPx`
- [ ] `tools/prepare-audio/src/covers.ts`
  - 删 `coverPath()`
  - `encodeCovers()` → `encodeThumb()`，只编一张
  - 顶部注释（`:9-16`）改写：从「两档 160/480」改成一档；补一句「阶段名与文件名保留
    `covers` 是为了不破坏既有 CLI 与文档」
- [ ] `tools/prepare-audio/src/index.ts`
  - `:11` import
  - `:465` 幂等 stat 的目标 `coverPath` → `thumbPath`（**漏了这条会让增量跑退化成全量**）
  - `:484` `all` 只留 thumb
  - `:494` 输出文案

验证：
```bash
pnpm assets covers            # 增量：应当逐条打印「⟨已存在⟩」，不重编
pnpm assets covers --force    # 全量：输出体积应当在 1.9 MB 上下，不再是 12 MB
```
跑完确认 `assets/cover` 没有被重新创建。

---

## 步骤 6：文档与 spec

会因为这次改动变成假话的陈述，逐条：

**文档**

- [ ] `DEPLOY.md:119` —— 环境变量表删 `PUBLIC_ASSET_BASE` 一行
- [ ] `DEPLOY.md:264-280` —— CDN 一节前半段重写。现状形态是整站挂 EdgeOne，图片随站走
      边缘缓存，没有独立资源前缀。**`:282-288`「切片绝对不能走 CDN」三条理由一字不动**
- [ ] `.env.example:44-46`
- [ ] `docker-compose.yml:39-42`
- [ ] `PROGRESS.md:339` —— 产物体积「切片 202.9 MB + 封面 11.8 MB」按实际重测后改写
- [ ] `PROGRESS.md:340` —— 构建耗时里的封面一项
- [ ] `PROGRESS.md:355` —— 旋钮列表删 `PUBLIC_ASSET_BASE`
- [ ] `PRODUCT.md:91` —— 「`assets/cover`、`assets/thumb`：真实封面与缩略图」

**spec**（前两条是会被人当操作手册照做的，不是措辞问题）

- [ ] `.trellis/spec/server/backend/secrecy-and-anticheat.md:18` ——
      「only `assets/cover` and `assets/thumb` are mounted」只剩 thumb
- [ ] `.trellis/spec/prepare-audio/backend/asset-secrecy.md:114` ——
      下架单曲的删除清单里去掉 `cover/<songId>.webp`
- [ ] `.trellis/spec/prepare-audio/backend/index.md:18` —— 「cover/thumb webp」
- [ ] `.trellis/spec/prepare-audio/backend/pipeline-guidelines.md:41` —— 同上
- [ ] `.trellis/spec/web/frontend/quality-guidelines.md:346,350` —— 措辞 cover → thumb。
      **56u 与高度地板 64u 两个数字不变**，这次没动尺寸

---

## 收尾：清理既有产物

- [ ] 本地 `assets/cover/`（244 个文件，10.58 MB）删除。`assets/` 在 `.gitignore` 里，
      不进版本库
- [ ] 线上 `~/shinycolors-song-guess/assets/cover/` 删除（`docker-compose.yml:47` 是
      `./assets:/app/assets:ro`）。**属于部署动作，发布后单独确认再执行**

---

## 全量验证

```bash
pnpm typecheck
pnpm test
```

grep 应当全部为空：

```bash
rg 'coverUrl|PUBLIC_ASSET_BASE|coverPx|COVER_DIR|coverPath' --glob '!.trellis/tasks/**'
```

人工验收（PRD 的 AC 第一条）：dev 下跑一局单机，DevTools Network 面板确认
`/thumb/<answerId>.webp` 只有一次网络请求，揭晓槽那次显示为 `(memory cache)` /
`(disk cache)`。

## 回滚点

- 步骤 1 之后：`git revert` 即可，服务端还在发 `coverUrl`，`assets/cover` 也还在
- 步骤 5 之后：回滚需要 `pnpm assets covers --force` 重新生成 480px 档（约 7 秒），
  源图内嵌在 `songs/` 的 mp3 里没有丢失
- 收尾之后：同上，且线上要重新同步 `assets/cover`
