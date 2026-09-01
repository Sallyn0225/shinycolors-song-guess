# 设计：删除 480px 封面档

## 一、为什么是「删一档」而不是「把 480 调小」

把 `coverPx` 从 480 降到 240 也能省一半字节，但**留着两档就留着两个 URL**。
两个 URL 的直接后果是单机揭晓槽拿不到 OptionBar 已经下载好的那张图：
一张图被下载两次，前后差几百毫秒，还是同一张脸。

只有合并到一档，「揭晓槽 = 选项条已下载的同一个资源」才成立。这是本任务省下的
44 KB 里真正干净的那部分 —— 不是压得更狠，是根本不再发这个请求。

## 二、协议：删字段，不改名

`RevealView.coverUrl`（`packages/shared/src/protocol.ts:162`）与
`AnswerResult.song.coverUrl`（`apps/web/src/api.ts:41`）两处都**删除**，不是改名成
`thumbUrl`。

理由：这个字段存在的唯一意义是让服务端有机会拼上 `PUBLIC_ASSET_BASE`。前缀没了之后
URL 完全由 `songId` 决定，而客户端另外三处（`OptionBar.tsx:114`、`Result.tsx:199`、
`shareCard.ts:567`）本来就是自己拼的。保留一个只会返回 `/thumb/${id}.webp` 的字段，
等于在同一个应用里维持两套拼法，下一个人改路径时必然漏掉一边。

两处消费点都已经拿得到 id：

- `Play.tsx` — `result.song.id`
- `Karuta.tsx` — `revealed.songId`（`Karuta.tsx:436` 已经在用它做 `answer-missed` 判定）

客户端与服务端同镜像发布（`Dockerfile` 一起构建），删字段没有兼容期问题。
`.trellis/spec/shared/backend/protocol-and-contracts.md` 也没有版本化要求。

## 三、`assetBase` 的注释是要搬家的，不是要删的

`apps/server/src/config.ts:70-76` 这段注释里有两件不同的东西：

```
封面的外部前缀，可以指向 CDN。只作用于服务端下发的 coverUrl ——     ← 随字段一起死
缩略图是前端写死的相对路径 /thumb/…，不受它影响，永远走本进程。      ← 随字段一起死

切片绝不能走 CDN：clip token 是一次性的、必须由本进程校验，          ← 红线，必须活下来
放到 CDN 上等于取消了这层校验，还会因为缓存让同一个切片被反复取到。
```

后半段是 `secrecy-and-anticheat.md` 列为不可协商的红线。删字段前必须先确认它在
`DEPLOY.md:282-288`（三条理由的完整版）与 spec 里存续 —— 那两处确实都有，所以
`config.ts` 这一处可以直接随字段删除，**但删之前要真的去看一眼**，不能默认。

这是本任务唯一一处「删代码会顺手删掉论证」的地方。

## 四、`covers` 这个名字保留

阶段名 `covers`（`pnpm assets covers`）、文件名 `tools/prepare-audio/src/covers.ts`
都不改：「封面」这个概念还在，只是从两档变一档。改名会波及 CLI、README、
`.trellis/spec/prepare-audio/backend/*` 三处，纯 churn。

文件内部的 `encodeCovers()` 改成 `encodeThumb()` —— 它从「编两张」变成「编一张」，
复数名会误导。在 `covers.ts` 顶部注释里写清「阶段名保留 covers 是为了不破坏既有 CLI
与文档」。

`stageCovers()` 的幂等检查（`index.ts:465`）现在 stat 的是 `coverPath(song.id)`，
必须改成 `thumbPath(song.id)`；不改的话 `--force` 之外的增量跑会因为 `coverPath` 永远
stat 失败而每次全量重编。同一函数 `:484` 的体积统计与 `:494` 的输出文案一并收敛到 thumb。

## 五、静态路由：`/cover/` 整段删除

`apps/server/src/app.ts:132-142` 的 `fastifyStatic` 注册整段删除。注意 `/thumb/` 那段
（`:143-152`）带 `decorateReply: false` —— 那是因为它是第二个注册的实例，
**cover 那段删掉后 thumb 变成第一个**。`@fastify/static` 允许多实例中只有一个装饰
`reply.sendFile`；本仓库没有任何地方调用 `reply.sendFile`，所以保持 `decorateReply: false`
不动是安全的，也不要顺手改成 `true`。

`:252-253` 的注释「`/cover` 与 `/thumb` 是 webp，已经是压缩格式」要改成只说 `/thumb`。

`apps/web/vite.config.ts:15` 的 `/cover` 代理同步删除。

## 六、验证「零字节」这件事怎么落到测试里

自动化测试能钉住的是**契约**，钉不住浏览器缓存：

- `app.test.ts` 加一条 `GET /cover/<id>.webp → 404`，证明这一档确实下线了。
- `app.test.ts:194` 原本断言 `body.song.coverUrl === '/cover/...'`，改为断言
  `song` 上**不存在** `coverUrl` 键（`expect(body.song).not.toHaveProperty('coverUrl')`），
  比直接删掉断言更有价值 —— 它挡住「以后有人又加回来」。
- `app.test.ts:196`（答案必在选项里）**不要动**，它是「揭晓槽能命中选项条缓存」这个
  结论的唯一自动化依据。在它旁边补一句注释说明这层依赖，否则将来有人重构时看不出
  这条断言还兼着一份职责。

缓存命中本身走人工验收（PRD 的第一条 AC，DevTools Network 面板）。

## 七、风险与回滚

| 风险 | 处理 |
|---|---|
| 删 `assetBase` 时把切片红线注释一起删掉 | §三，改之前先核对 DEPLOY.md 与 spec |
| `stageCovers` 幂等键忘了改，增量跑退化成全量 | §四，改完跑一次不带 `--force` 的 `pnpm assets covers` 验证输出「⟨已存在⟩」 |
| 既有 `assets/cover/` 残留在本地与 VPS 上白占 10.58 MB | 收尾步骤单独处理，线上删除需确认 |
| DPR 3 手机上 1.34× 放大 | 已在 PRD「已知取舍」判定接受 |

**回滚**：`git revert` 后需要重新生成 480px 档（`pnpm assets covers --force`）。
源 jpg 内嵌在 `songs/` 的 mp3 里，没有丢失，重生成可行 —— 但这意味着回滚不是纯代码操作，
要留出一次 7 秒左右的构建。
