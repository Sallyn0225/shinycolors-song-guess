# 修正 DEPLOY.md CDN 一节：thumb 不走 PUBLIC_ASSET_BASE

## Goal

DEPLOY.md 的 CDN 一节宣称「把 `assets/cover` 和 `assets/thumb` 同步上去即可」，
即两者都会随 `PUBLIC_ASSET_BASE` 走 CDN。实际只有 cover 走：cover 的 URL 由服务端经
`coverUrl()`（`apps/server/src/config.ts`）下发、会拼上前缀；而 thumb 是客户端写死的
相对路径 `/thumb/${id}.webp`（三处：`OptionBar.tsx` / `Result.tsx` / `shareCard.ts`），
设了环境变量也不受影响。照文档操作会把 thumb 同步上 OSS 却发现流量没走 CDN——
部署陷阱。

## Requirements

1. DEPLOY.md「CDN」一节改为只承诺 cover 走 CDN；明确指出 thumb 是客户端相对路径、
   始终走本进程，并说明为什么当前体量下可接受（总量 2.4MB / 244 个 / 单个 ~10KB，
   带长缓存头）。
2. DEPLOY.md「环境变量」表中 `PUBLIC_ASSET_BASE` 的说明同步修正（删去「缩略图」）。
3. `apps/server/src/config.ts` 中 `assetBase` 的注释同步修正（「封面/缩略图」→ 只有封面），
   不改任何行为。

## Constraints

- **不改客户端代码**、不引入 `thumbUrl`——thumb 体量小，收益不值得动三处客户端与
  消息结构。若未来有实测压力再立独立任务。
- 切片不能走 CDN 的三条理由段落保持原样（它是对的）。

## Acceptance Criteria

- [ ] DEPLOY.md CDN 一节不再宣称同步 `assets/thumb` 上去即可生效
- [ ] DEPLOY.md 环境变量表与 config.ts 注释与 CDN 一节口径一致
- [ ] 除 config.ts 注释外无任何行为变更（纯文档 + 注释）
