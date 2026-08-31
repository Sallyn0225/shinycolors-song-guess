# 设计：CDN 接入与带宽优化

## 一、响应压缩：装在应用层，不是 Caddy

### 归属决策（父任务 PRD 标记的交叠点，在此定案）

三个候选位置：Fastify 插件 / Caddy `encode` / EdgeOne。**选 Fastify。**

理由是这个项目有**三种部署形态**，只有应用层能覆盖全部：

| 形态 | 有 Caddy | 有 CDN | 来源 |
|---|---|---|---|
| 局域网开黑 `pnpm start` | ❌ | ❌ | `DEPLOY.md:6` 明确支持 |
| 单机 VPS + Caddy | ✅ | ❌ | 本次部署的第一阶段 |
| VPS + Caddy + EdgeOne | ✅ | ✅ | 本次部署的目标形态 |

装在 Caddy 上，局域网形态白丢 240 KB；装在 CDN 上，前两种形态都白丢。
**装在 Fastify 上，一次配置，三种形态都生效。**

推论：`docker-deploy` 子任务的 Caddyfile **不要再配 `encode`**。
双重压缩不会出错（Caddy 见到 `Content-Encoding` 会跳过），但配了会让人以为
那才是生效的那层，下次调压缩级别改错地方。

### 为什么默认配置就是对的

`@fastify/compress` 的默认可压缩判定：

```
/^text\/(?!event-stream)|(?:\+|\/)json(?:;|$)|(?:\+|\/)text(?:;|$)|(?:\+|\/)xml(?:;|$)|octet-stream(?:;|$)/u
```

实测这个项目涉及的全部 content-type：

```
压缩  text/javascript · text/css · text/html · application/json
不压  audio/ogg · audio/mp4 · audio/wav · image/webp · video/mp4
```

**音频与图片天然被排除**，这不是巧合而是 mime-db 的 `compressible` 语义——
已经是压缩格式的东西再压只会变大。对本项目尤其重要：`/api/clip/*` 是热路径，
每回合一次 148 KB，若被压缩就是纯 CPU 浪费（2C4G 上更明显），且会给
`sendClip()` 的响应加上一个不该有的 `content-encoding`。

### 唯一需要补的一处

`application/javascript` **不匹配**上面的正则（只有 `text/javascript` 匹配）。
现代 mime-db 把 `.js` 判为 `text/javascript`，所以默认能压；但这依赖
`@fastify/static` → `@fastify/send` → `mime` 的版本行为，是个隐式依赖。

用 `customTypes` 显式补上，让结果不随依赖版本漂移：

```ts
customTypes: /^application\/javascript(?:;|$)/u
```

`customTypes` 是**追加**而非替换——`shouldCompress` 先查自定义谓词，再回落 mime-db。

### 参数取值

| 项 | 值 | 理由 |
|---|---|---|
| `global` | `true` | 静态资源由 `@fastify/static` 发出，只有全局 hook 能覆盖 |
| `threshold` | `1024`（默认） | 小响应压了反而更大，且省不下 TCP 包 |
| brotli quality | 默认 `4` | **不要调到 11**。2C4G 上 11 级压 327 KB 要几百毫秒，而收益只有几个百分点 |
| `encodings` | 不指定 | 让插件按客户端 `Accept-Encoding` 协商，br > gzip |

### 保密红线复核

`secrecy-and-anticheat.md` 要求任何改动都要过一遍旁路。压缩引入的是**长度旁路**：

- 切片：不压缩，无影响 ✅
- `/api/ambience/tracks`：响应体是随机 token，熵满，压不动，长度恒定 ✅
- `/api/solo/:sid/question/:index`：含曲名的选项列表，压缩后长度随曲名内容变化。
  但**曲名本来就明文下发**（`optionView` 的既定设计），不构成新信息 ✅
- BREACH 需要攻击者能把可控内容反射进含机密的同一响应体——本项目无此类端点 ✅

结论：无新增泄漏面。这一条要写进代码注释，因为下一个人一定会问。

## 二、首屏瘦身

### `bg/loop.mp4`（4.15 MB → 目标 < 1.2 MB）

现状：960×540 · 24fps · 无音轨 · 64s · 519 kbps（`public/bg/README.md` 有完整转码命令）。
`ui/Backdrop.tsx:106` 用 `preload="auto"`，即**首屏无条件全量拉 4.15 MB**。

两处独立改动，都要做：

1. **转码更狠**：CRF 38 → 42~44，或分辨率降到 854×480。README 里那条命令
   已经用了 `veryslow` + `hqdn3d`，只需调 CRF 重跑。目标 < 1.2 MB。
2. **改加载策略**：`preload="auto"` → `preload="none"` + 一张 poster 静帧（webp，~30 KB），
   视频在首屏渲染完成后再异步开始加载。首屏关键路径上就只剩那张静帧。

> 换片不用改代码——README 明说同名覆盖即可。所以第 1 项是纯资产替换。

### `sfx/`（300 KB → ~30 KB）

6 个 WAV，`sfx.ts:109` 用 `fetch('/sfx/${name}.wav')` + `decodeAudioData`。
转成 opus 后改扩展名即可，`decodeAudioData` 同样能解。

**注意 Safari 兜底**：项目已有一套「Opus 主格式 + m4a 兜底」的既定做法
（见 `public/greet/README.md` 与 `audio.ts` 的 `prefetch`），sfx 若转 opus
应沿用同一套，而不是新发明一种。**不能用 `canPlayType` 提前判断——iOS 上它会说谎。**

## 三、EdgeOne 接入

选型依据见 `research/cdn-selection.md`。核心：**标准 CDN 不支持 WebSocket**，
只有 EdgeOne / ECDN 全站加速支持，因此整站挂 EdgeOne 是唯一能保持
「页面与 `/ws` 同源」的 CDN 形态。

### 必须在规则引擎里做的例外

```
/api/clip/*            → 不缓存，直接回源
/api/ambience/clip/*   → 不缓存，直接回源
/ws                    → WebSocket 开关开启，超时 > 120s
```

前两条不是性能调优而是**红线要求**：`secrecy-and-anticheat.md` 写明
「Clips must never be served from a CDN」。要验证 EdgeOne 确实不缓存，
而不是相信它会尊重 `no-store`。

### 兜底路径

若实测发现音频经 CDN 回源导致起播明显变慢，把 `/api/clip` 与 `/api/ambience`
挪到**不挂 CDN 的子域**。这不违反同源约束——那条约束只针对页面与 `/ws`，
音频是 `fetch` + `decodeAudioData`，跨域只需要 `Access-Control-Allow-Origin`。

## 风险

| 风险 | 处置 |
|---|---|
| 压缩意外命中音频路径 | 写一条断言音频响应**无** `content-encoding` 的测试，这是回归防线 |
| EdgeOne 剥掉或改写 `no-store` | 接入后用 curl 实测响应头，列入 `research/` 的待验证清单 |
| EdgeOne 个人版对 WS 有隐藏限制 | 先小流量验证再切正式域名 |
| 视频转码过头导致画质不可接受 | 主观验收，CRF 逐档试，保留原命令便于回滚 |
