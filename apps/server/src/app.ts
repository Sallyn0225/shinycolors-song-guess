import path from 'node:path'
import fs from 'node:fs/promises'

import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify'
import fastifyCompress from '@fastify/compress'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import { z } from 'zod'

import { DIFFICULTIES, DIFFICULTY_PRESETS, KARUTA_DEFAULTS, type Difficulty } from '@scg/shared'

import { AmbienceStore } from './ambience.js'
import { ASSETS_ROOT, Catalog } from './catalog.js'
import { SERVER_CONFIG, type RoomQuotas } from './config.js'
import { SoloSessionStore } from './soloSessions.js'
import { Hub, type Socket } from './ws/hub.js'
import { IpQuota } from './ws/quota.js'

const difficultySchema = z.enum(DIFFICULTIES as unknown as [Difficulty, ...Difficulty[]])
const createSessionSchema = z.object({ difficulty: difficultySchema })
const answerSchema = z.object({ choice: z.number().int() })

type ClipFormat = 'opus' | 'aac'

/** 切片路径：按 id 前 2 字符分片，避免单目录上千文件 */
function slicePath(sliceId: string, format: ClipFormat = 'opus'): string {
  const ext = format === 'aac' ? 'm4a' : 'opus'
  return path.join(ASSETS_ROOT, 'slices', sliceId.slice(0, 2), `${sliceId}.${ext}`)
}

const CLIP_MIME: Record<ClipFormat, string> = { opus: 'audio/ogg', aac: 'audio/mp4' }

/**
 * 把切片字节发出去。
 *
 * `no-store` 不只是省心：缓存命中与否的时间差本身就是一条弱旁路。
 * 也绝不能带 `Last-Modified` —— 构建顺序就是曲名字典序，按时间排一遍就能还原对照表。
 */
async function sendClip(reply: FastifyReply, sliceId: string, format: ClipFormat) {
  if (!/^[0-9A-Z]{20}$/.test(sliceId)) return reply.code(404).send({ error: '无效的切片凭证' })
  try {
    const data = await fs.readFile(slicePath(sliceId, format))
    return reply
      .header('content-type', CLIP_MIME[format])
      .header('cache-control', 'no-store')
      .send(data)
  } catch {
    return reply.code(404).send({ error: '切片不存在' })
  }
}

/** URL 里的 `.m4a` 后缀选兜底格式。放在路径里而不是查询串，CDN 才好按扩展名分流 */
function formatOf(token: string): { token: string; format: ClipFormat } {
  return token.endsWith('.m4a')
    ? { token: token.slice(0, -4), format: 'aac' }
    : { token, format: 'opus' }
}

export interface BuildAppOptions {
  /**
   * 覆盖房间配额。生产环境不传，走 `SERVER_CONFIG.rooms`。
   *
   * 存在的意义是测试：正常对局的用例要宽松额度才跑得完，
   * 而验证限流的用例要极紧额度才触发得了 —— 靠环境变量做不到在同一个进程里两者并存。
   */
  rooms?: Partial<RoomQuotas>
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    // 反代后面才认 X-Forwarded-*；直接暴露时开它等于让任何人伪造来源 IP
    trustProxy: SERVER_CONFIG.trustProxy,
  })

  // 有些 POST 没有 body（begin / replay），但浏览器仍可能带上 content-type: application/json。
  // Fastify 默认会去解析空 body 然后返回 400，所以这里把空 body 当作 {}。
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const raw = typeof body === 'string' ? body.trim() : ''
    if (raw === '') return done(null, {})
    try {
      done(null, JSON.parse(raw))
    } catch {
      done(new Error('JSON 格式无效'), undefined)
    }
  })

  /**
   * 响应压缩。
   *
   * **必须注册在 `@fastify/static` 之前** —— `global: true` 装的是 onSend 钩子，
   * 晚于静态插件注册就盖不住它发出的响应，而前端 JS 正是最大的那一块
   * （未压缩 327KB，压完 100KB 量级）。
   *
   * 为什么在应用层而不是 Caddy 的 `encode` 或 CDN：这个项目有三种部署形态，
   * 局域网开黑（`DEPLOY.md` 开头那条 `pnpm start`）**没有反代也没有 CDN**。
   * 装在应用层，一次配置三种形态都生效；装在反代上，局域网那种白丢 240KB。
   * 反过来说，Caddyfile 里就不要再配 `encode` 了 —— 不会出错（见到
   * `Content-Encoding` 会跳过），但会让人误以为那才是生效的那层。
   *
   * **音频不会被压到**，这一点对本项目是硬要求而非优化：插件默认按 mime-db 的
   * `compressible` 判定，`audio/ogg`、`audio/mp4`、`image/webp` 全部为否 ——
   * 它们本来就是压缩格式，再压一遍只会变大。切片是热路径（每回合一次 148KB），
   * 被压等于白烧 CPU，还会给 `sendClip()` 的响应加上一个不该有的 `content-encoding`。
   * `app.test.ts` 里有一条反向断言守着这件事。
   *
   * `customTypes` 补的是唯一一个漏网的：默认正则只认 `text/javascript`，
   * 不认 `application/javascript`。现代 mime-db 把 `.js` 判为前者，所以默认能压，
   * 但那是 `@fastify/static` → `@fastify/send` → `mime` 的**隐式版本行为**。
   * 显式写出来，结果就不随依赖升级漂移。它是追加而非替换：
   * `shouldCompress` 先查自定义谓词，再回落 mime-db。
   *
   * brotli 质量保持默认的 4。**不要调到 11** —— 在 2C4G 上压 327KB 要几百毫秒，
   * 换来的只有几个百分点。
   *
   * 旁路复核（`secrecy-and-anticheat.md` 要求每次改动都过一遍）：压缩引入的是
   * 长度旁路，逐条看都不成立 —— 切片不压，无影响；`/api/ambience/tracks` 的响应体
   * 是随机 token，熵满压不动，长度恒定；单机题目响应的长度随曲名变化，
   * 但曲名本来就是明文下发的选项（`optionView` 的既定设计），不是新信息。
   * BREACH 需要把攻击者可控的内容反射进含机密的同一响应体，本项目没有这种端点。
   */
  await app.register(fastifyCompress, {
    global: true,
    customTypes: /^application\/javascript(?:;|$)/u,
  })

  const catalog = await Catalog.load()
  const solo = new SoloSessionStore(catalog)
  const ambience = new AmbienceStore(catalog)
  const ambienceQuota = new IpQuota()

  // 缩略图：只在答案揭晓后才会被请求，不做额外鉴权
  await app.register(fastifyStatic, {
    root: path.join(ASSETS_ROOT, 'thumb'),
    prefix: '/thumb/',
    decorateReply: false,
    // 内容不可变；**关掉 Last-Modified**，否则构建顺序（= 曲名字典序）会经 mtime 泄漏
    lastModified: false,
    etag: true,
    cacheControl: true,
    maxAge: '365d',
    immutable: true,
  })

  // ── 联机 1v1 ───────────────────────────────────────────
  const hub = new Hub(catalog, { ...SERVER_CONFIG.rooms, ...opts.rooms })
  await app.register(fastifyWebsocket)

  await app.register(async (scope) => {
    // @fastify/websocket v11 直接把 WebSocket 作为第一个参数传进来
    scope.get('/ws', { websocket: true }, (socket, req) => {
      const s = socket as unknown as Socket
      // 按 IP 的房间配额全靠这个值。**没开 TRUST_PROXY 时它是反代自己的地址**，
      // 所有连接会挤进同一个配额桶——更严格，但会误伤，见 DEPLOY.md
      hub.connect(s, req.ip)

      /**
       * 协议级心跳。
       *
       * 客户端每 2 秒有一次业务 ping，但那是应用层消息——有的反向代理只按帧层面的
       * 活跃度算空闲，还有一类情况业务 ping 完全救不了：对端**拔网线**不会发 FIN，
       * 连接会一直半开着占着座位，直到 TCP keepalive（默认 2 小时）才发现。
       * 这里用 ping/pong 在一个心跳周期内清掉它，座位才能及时进入掉线宽限。
       */
      let alive = true
      socket.on('pong', () => {
        alive = true
      })
      const beat = setInterval(() => {
        if (!alive) {
          socket.terminate()
          return
        }
        alive = false
        try {
          socket.ping()
        } catch {
          socket.terminate()
        }
      }, SERVER_CONFIG.wsHeartbeatMs)
      beat.unref?.()

      const done = () => {
        clearInterval(beat)
        hub.disconnect(s)
      }
      socket.on('message', (data: Buffer) => hub.handle(s, data.toString()))
      socket.on('close', done)
      socket.on('error', done)
    })
  })

  /**
   * 房间内的切片。token 每回合随机生成、仅该房间有效，
   * 客户端永远看不到 sliceId，也就无法跨局积累「切片 ↔ 曲目」对照表。
   */
  app.get<{ Params: { code: string; token: string } }>(
    '/api/room/:code/clip/:token',
    async (req, reply) => {
      const room = hub.roomByCode(req.params.code)
      if (!room) return reply.code(404).send({ error: '房间不存在' })
      const { token, format } = formatOf(req.params.token)
      const sliceId = room.sliceIdForToken(token)
      if (!sliceId) return reply.code(404).send({ error: '无效的切片凭证' })
      return sendClip(reply, sliceId, format)
    },
  )

  app.addHook('onClose', async () => hub.dispose())

  app.get('/api/health', async () => ({ ok: true, songs: catalog.songs.length }))

  // ── 前端静态资源（可选）──────────────────────────────────
  //
  // 构建过 apps/web 就由本进程一起伺服。公网部署时这很关键：
  // 页面和 /ws 同源同端口，wss 就跟着页面的 https 走，不用再单独配一个静态站点，
  // 也就没有跨源和「http 页面连 wss」这类问题。
  if (SERVER_CONFIG.webRoot) {
    await app.register(fastifyStatic, {
      root: SERVER_CONFIG.webRoot,
      prefix: '/',
      decorateReply: false,
      // Vite 产物文件名带内容哈希，可以放心长缓存；index.html 单独处理
      index: false,
      lastModified: false,
      etag: true,
      cacheControl: true,
      maxAge: '365d',
      immutable: true,

      /**
       * 优先发构建期压好的 `.br`（`apps/web/scripts/precompress.mjs` 生成）。
       *
       * 运行时压缩用的是 brotli 默认质量 4 —— 那个默认值是对的，因为它压的是
       * **每一次请求**，2C4G 上不能用 11 级。但这些产物是不可变的静态文件，
       * 构建时压一次就能用到下次发版。实测同一个 JS：q4 → 101,956，q11 → 86,216。
       *
       * 两个插件在这里是**互补而不是打架**的：命中 `.br` 时本插件会自己带上
       * `content-encoding: br`，而 `@fastify/compress` 的 onSend 见到已有的
       * Content-Encoding 就直接放行；没有 `.br`（比如客户端不支持 br，
       * 或某类文件没被预压）时本插件回落到原文件，再由运行时压缩接手。
       *
       * **只在这一处开。** `/thumb` 是 webp，已经是压缩格式，
       * 给它开只会让每个请求多一次注定失败的 `.br` 探路。
       */
      preCompressed: true,

      /**
       * 命中 `.br` 时补 `Vary: Accept-Encoding`。
       *
       * **这一条不是可选的加固，是 `preCompressed` 带来的正确性缺口。**
       * 开了它之后同一个 URL 会按 `Accept-Encoding` 返回不同字节，而
       * `@fastify/static` 自己不加 Vary；平时补这个头的是 `@fastify/compress`，
       * 可它见到已有的 `content-encoding` 就直接放行了 —— 于是两个插件
       * 各自都合理，交界处却漏出一个没有 Vary 的可变响应。
       *
       * 后果要有共享缓存才会显形：把 br 的响应体发给不支持 br 的客户端，
       * 对方拿到一坨乱码。当前 Caddy 不做缓存所以是潜伏的，
       * 但一旦前面挂上 CDN 就会立刻中招。
       *
       * 只在 `.br` 上加：其余文件（webp/m4a/mp4）本来就不随编码变化，
       * 给它们加只会平白拆散缓存键。
       */
      setHeaders(res, filePath) {
        if (filePath.endsWith('.br')) res.setHeader('vary', 'accept-encoding')
      },
    })

    const indexHtml = path.join(SERVER_CONFIG.webRoot, 'index.html')
    // index.html **绝不能缓存** —— 缓存住了就等于把用户永久钉在某一次构建上，
    // 而它引用的带哈希文件名早就换了，表现是白屏
    const sendIndex = async (reply: FastifyReply) =>
      reply
        .header('content-type', 'text/html; charset=utf-8')
        .header('cache-control', 'no-cache')
        .send(await fs.readFile(indexHtml))

    // 上面按 index:false 注册，根路径要自己接；否则 fastify-static 把它当目录，回 403
    app.get('/', async (_req, reply) => sendIndex(reply))

    // SPA 兜底：不是 API 的 GET 一律回 index.html，刷新任意路径都不会 404
    app.setNotFoundHandler(async (req, reply) => {
      if (req.method !== 'GET' || req.url.startsWith('/api/')) {
        return reply.code(404).send({ error: '不存在' })
      }
      return sendIndex(reply)
    })
  }

  // 原样透传。曾经在这里用 hard.clipSeconds 覆盖 roundWindowSeconds，
  // 等于把「联机窗口独立于单机片段长度」的解耦又绑了回去——调联机窗口改不动接口返回值
  app.get('/api/karuta/rules', async () => KARUTA_DEFAULTS)

  app.get('/api/difficulties', async () =>
    DIFFICULTIES.map((d) => ({ ...DIFFICULTY_PRESETS[d] })),
  )

  // ── 单机 ──────────────────────────────────────────────

  app.post('/api/solo/session', async (req, reply) => {
    const parsed = createSessionSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: '难度参数无效' })
    const preset = DIFFICULTY_PRESETS[parsed.data.difficulty]
    const session = solo.create(parsed.data.difficulty)
    return {
      sessionId: session.id,
      difficulty: session.difficulty,
      total: session.questions.length,
      clipSeconds: preset.clipSeconds,
      answerSeconds: preset.answerSeconds,
      optionCount: preset.optionCount,
      replays: preset.replays,
      // 有兜底副本时客户端才会在 Opus 解码失败后去试 AAC
      aacFallback: catalog.aacFallback,
    }
  })

  app.get<{ Params: { sid: string; index: string } }>(
    '/api/solo/:sid/question/:index',
    async (req, reply) => {
      const session = solo.get(req.params.sid)
      if (!session) return reply.code(404).send({ error: '会话不存在或已过期' })
      const index = Number(req.params.index)
      if (!Number.isInteger(index)) return reply.code(400).send({ error: '题号无效' })
      const view = solo.serveQuestion(session, index)
      if (!view) return reply.code(404).send({ error: '题目不存在' })
      return view
    },
  )

  app.post<{ Params: { sid: string; index: string } }>(
    '/api/solo/:sid/question/:index/begin',
    async (req, reply) => {
      const session = solo.get(req.params.sid)
      if (!session) return reply.code(404).send({ error: '会话不存在或已过期' })
      const started = solo.begin(session, Number(req.params.index))
      if (!started) return reply.code(404).send({ error: '题目不存在' })
      return started
    },
  )

  app.post<{ Params: { sid: string; index: string } }>(
    '/api/solo/:sid/question/:index/replay',
    async (req, reply) => {
      const session = solo.get(req.params.sid)
      if (!session) return reply.code(404).send({ error: '会话不存在或已过期' })
      const result = solo.useReplay(session, Number(req.params.index))
      if (!result.ok) return reply.code(429).send({ error: '重听次数已用完', ...result })
      return result
    },
  )

  app.post<{ Params: { sid: string; index: string } }>(
    '/api/solo/:sid/question/:index/answer',
    async (req, reply) => {
      const session = solo.get(req.params.sid)
      if (!session) return reply.code(404).send({ error: '会话不存在或已过期' })
      const parsed = answerSchema.safeParse(req.body)
      if (!parsed.success) return reply.code(400).send({ error: '答案格式无效' })

      const index = Number(req.params.index)
      const result = solo.answer(session, index, parsed.data.choice)
      if (!result) return reply.code(409).send({ error: '题目不存在或已作答' })

      const { record, answerIndex, song } = result
      return {
        correct: record.correct,
        answerIndex,
        elapsedMs: record.elapsedMs,
        score: record.score,
        song: {
          id: song.id,
          title: song.title,
          artist: song.artist,
          unit: song.unit,
          unitColor: song.unitColor,
        },
      }
    },
  )

  app.get<{ Params: { sid: string } }>('/api/solo/:sid/result', async (req, reply) => {
    const session = solo.get(req.params.sid)
    if (!session) return reply.code(404).send({ error: '会话不存在或已过期' })
    return solo.summary(session)
  })

  /**
   * 音频切片。
   *
   * token 是**每局随机生成**的一次性凭证，客户端永远看不到 sliceId，
   * 因此无法跨局积累「切片 ↔ 曲目」对照表。
   */
  app.get<{ Params: { sid: string; token: string } }>('/api/clip/:sid/:token', async (req, reply) => {
    const session = solo.get(req.params.sid)
    if (!session) return reply.code(404).send({ error: '会话不存在或已过期' })
    const { token, format } = formatOf(req.params.token)
    const sliceId = session.clipTokens.get(token)
    if (!sliceId) return reply.code(404).send({ error: '无效的切片凭证' })
    return sendClip(reply, sliceId, format)
  })

  // ── 环境 BGM ──────────────────────────────────────────
  //
  // 首页 / 大厅 / 房间三屏铺的背景音乐。它**不能**走上面那条 `/api/clip/:sid/:token`——
  // 那里的 token 挂在单人对局会话上，而这三屏根本没有会话。
  //
  // 下发的内容里没有 songId、曲名、切片 index、时长中的任何一项，
  // 客户端只知道「这是一段能放的音频」。红线的完整论证见 `ambience.ts` 开头。

  app.get<{ Querystring: { n?: string } }>('/api/ambience/tracks', async (req, reply) => {
    if (ambienceQuota.hit(req.ip, 'ambience', 60_000, SERVER_CONFIG.ambienceTracksPerMin)) {
      return reply.code(429).send({ error: '请求过于频繁' })
    }
    // 一次最多 4 个曲目（约 3~4 分钟的量）。要更多就再来一次，
    // 免得一个请求就把内存表铸满一大片用不上的凭证
    const n = Math.min(4, Math.max(1, Number(req.query.n) || 1))
    return { tracks: ambience.mintTracks(n), aacFallback: catalog.aacFallback }
  })

  app.get<{ Params: { token: string } }>('/api/ambience/clip/:token', async (req, reply) => {
    const { token, format } = formatOf(req.params.token)
    const sliceId = ambience.sliceIdForToken(token)
    if (!sliceId) return reply.code(404).send({ error: '无效的切片凭证' })
    return sendClip(reply, sliceId, format)
  })

  return app
}
