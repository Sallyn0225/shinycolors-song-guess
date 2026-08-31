# syntax=docker/dockerfile:1

# 不用 alpine：tsx 依赖 esbuild 的平台二进制（pnpm-workspace.yaml 专门为它开了
# allowBuilds）。musl 上通常也能跑，但为省 40MB 去赌一个构建期的平台差异不划算。
ARG NODE_IMAGE=node:22-bookworm-slim

# ─────────────────────────────────────────────────────────────
# deps —— 装全部依赖（含 dev，前端构建要 vite/tsc）
# ─────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS deps
ENV PNPM_HOME=/pnpm PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# 先只拷清单再装依赖：源码一改就失效的层放在后面，依赖层才能被缓存命中
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json      apps/server/
COPY apps/web/package.json         apps/web/
COPY packages/shared/package.json  packages/shared/
COPY packages/game-core/package.json packages/game-core/
COPY tools/prepare-audio/package.json tools/prepare-audio/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ─────────────────────────────────────────────────────────────
# build —— 只构建前端。**不需要 assets/**：apps/web/public 的素材已入库，
# 所以镜像构建完全自洽，可以在 GitHub Actions 里跑完
# ─────────────────────────────────────────────────────────────
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/ apps/
RUN pnpm --filter @scg/web build

# ─────────────────────────────────────────────────────────────
# runtime —— 只带 prod 依赖 + 源码 + 前端产物
# ─────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runtime
ENV PNPM_HOME=/pnpm PATH=$PNPM_HOME:$PATH \
    NODE_ENV=production \
    PORT=5179 \
    HOST=0.0.0.0
RUN corepack enable
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json      apps/server/
COPY apps/web/package.json         apps/web/
COPY packages/shared/package.json  packages/shared/
COPY packages/game-core/package.json packages/game-core/
COPY tools/prepare-audio/package.json tools/prepare-audio/

# 只装 server 及其 workspace 依赖的生产依赖。
# tsx 在这里是**生产依赖**——@scg/shared 与 @scg/game-core 的 exports 直接指向
# ./src/index.ts，导出的是裸 TypeScript，运行时必须有转译器。
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter "@scg/server..."

# 目录层级不能变：catalog.ts 用 resolve(<server/src>, '..','..','..') 上溯三级取
# REPO_ROOT，config.ts 默认在 REPO_ROOT/apps/web/dist 找前端。拍平目录会让
# Catalog.load() 找错路径，而且报的是「曲库为空」不是「路径不对」，很难查。
COPY tsconfig.base.json ./
COPY packages/shared/    packages/shared/
COPY packages/game-core/ packages/game-core/
COPY apps/server/        apps/server/
COPY --from=build /app/apps/web/dist apps/web/dist

# assets/ 不进镜像，运行时只读挂载到这里。先建出来，
# 没挂载时启动会明确报「曲库为空」而不是路径不存在
RUN mkdir -p /app/assets && chown -R node:node /app
USER node

EXPOSE 5179

# 直接 exec node，不经 pnpm/sh —— SIGTERM 必须原样送到 node，
# index.ts 靠它做优雅关闭；中间隔一层进程可能吞掉信号，正在进行的对局会被硬切。
CMD ["node", "--import", "tsx", "/app/apps/server/src/index.ts"]
