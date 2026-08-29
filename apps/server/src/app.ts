import path from 'node:path'
import fs from 'node:fs/promises'

import Fastify, { type FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import { z } from 'zod'

import { DIFFICULTIES, DIFFICULTY_PRESETS, KARUTA_DEFAULTS, type Difficulty } from '@scg/shared'

import { ASSETS_ROOT, Catalog } from './catalog.js'
import { SoloSessionStore } from './soloSessions.js'
import { Hub, type Socket } from './ws/hub.js'

const difficultySchema = z.enum(DIFFICULTIES as unknown as [Difficulty, ...Difficulty[]])
const createSessionSchema = z.object({ difficulty: difficultySchema })
const answerSchema = z.object({ choice: z.number().int() })

/** 切片路径：按 id 前 2 字符分片，避免单目录上千文件 */
function slicePath(sliceId: string): string {
  return path.join(ASSETS_ROOT, 'slices', sliceId.slice(0, 2), `${sliceId}.opus`)
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })

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

  const catalog = await Catalog.load()
  const solo = new SoloSessionStore(catalog)

  // 封面：只在答案揭晓后才会被请求，不做额外鉴权
  await app.register(fastifyStatic, {
    root: path.join(ASSETS_ROOT, 'cover'),
    prefix: '/cover/',
    // 内容不可变；**关掉 Last-Modified**，否则构建顺序（= 曲名字典序）会经 mtime 泄漏
    lastModified: false,
    etag: true,
    cacheControl: true,
    maxAge: '365d',
    immutable: true,
  })
  await app.register(fastifyStatic, {
    root: path.join(ASSETS_ROOT, 'thumb'),
    prefix: '/thumb/',
    decorateReply: false,
    lastModified: false,
    etag: true,
    cacheControl: true,
    maxAge: '365d',
    immutable: true,
  })

  // ── 联机 1v1 ───────────────────────────────────────────
  const hub = new Hub(catalog)
  await app.register(fastifyWebsocket)

  await app.register(async (scope) => {
    // @fastify/websocket v11 直接把 WebSocket 作为第一个参数传进来
    scope.get('/ws', { websocket: true }, (socket) => {
      const s = socket as unknown as Socket
      hub.connect(s)
      socket.on('message', (data: Buffer) => hub.handle(s, data.toString()))
      socket.on('close', () => hub.disconnect(s))
      socket.on('error', () => hub.disconnect(s))
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
      const sliceId = room.sliceIdForToken(req.params.token)
      if (!sliceId || !/^[0-9A-Z]{20}$/.test(sliceId)) {
        return reply.code(404).send({ error: '无效的切片凭证' })
      }
      try {
        const data = await fs.readFile(slicePath(sliceId))
        return reply
          .header('content-type', 'audio/ogg')
          .header('cache-control', 'no-store')
          .send(data)
      } catch {
        return reply.code(404).send({ error: '切片不存在' })
      }
    },
  )

  app.addHook('onClose', async () => hub.dispose())

  app.get('/api/health', async () => ({ ok: true, songs: catalog.songs.length }))

  app.get('/api/karuta/rules', async () => ({
    ...KARUTA_DEFAULTS,
    roundWindowSeconds: DIFFICULTY_PRESETS[KARUTA_DEFAULTS.difficulty].clipSeconds,
  }))

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
          coverUrl: `/cover/${song.id}.webp`,
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
    const sliceId = session.clipTokens.get(req.params.token)
    if (!sliceId || !/^[0-9A-Z]{20}$/.test(sliceId)) {
      return reply.code(404).send({ error: '无效的切片凭证' })
    }
    try {
      const data = await fs.readFile(slicePath(sliceId))
      return reply
        .header('content-type', 'audio/ogg')
        // 不缓存：缓存命中的时间差本身也是一条弱旁路
        .header('cache-control', 'no-store')
        .send(data)
    } catch {
      return reply.code(404).send({ error: '切片不存在' })
    }
  })

  return app
}
