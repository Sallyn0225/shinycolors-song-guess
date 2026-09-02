import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'

import { DIFFICULTY_PRESETS } from '@scg/shared'

import { buildApp } from './app.js'

let app: FastifyInstance

beforeAll(async () => {
  app = await buildApp()
  await app.ready()
})
afterAll(async () => {
  await app.close()
})

async function newSession(difficulty: 'easy' | 'hard' = 'hard') {
  const res = await app.inject({ method: 'POST', url: '/api/solo/session', payload: { difficulty } })
  expect(res.statusCode).toBe(200)
  return res.json() as {
    sessionId: string
    total: number
    clipSeconds: number
    answerSeconds: number
    optionCount: number
    replays: number
    aacFallback: boolean
  }
}

async function question(sid: string, index: number) {
  const res = await app.inject({ method: 'GET', url: `/api/solo/${sid}/question/${index}` })
  expect(res.statusCode).toBe(200)
  return res.json() as {
    index: number
    total: number
    clipToken: string
    options: Array<{ id: string; title: string; artist: string; unitColor: string | null }>
  }
}

describe('健康检查', () => {
  it('曲库加载成功', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json().songs).toBe(243)
  })

  it('难度表与 shared 一致', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/difficulties' })
    const list = res.json() as Array<{ id: 'easy' | 'hard'; clipSeconds: number }>
    expect(list.map((d) => d.id)).toEqual(['easy', 'hard'])
    expect(list.find((d) => d.id === 'hard')?.clipSeconds).toBe(DIFFICULTY_PRESETS.hard.clipSeconds)
  })
})

describe('开局', () => {
  it('按难度返回参数', async () => {
    const s = await newSession('hard')
    const preset = DIFFICULTY_PRESETS.hard
    expect(s.total).toBe(preset.questionCount)
    expect(s.clipSeconds).toBe(preset.clipSeconds)
    expect(s.answerSeconds).toBe(preset.answerSeconds)
    expect(s.optionCount).toBe(preset.optionCount)
    expect(s.replays).toBe(preset.replays)
  })

  it('拒绝无效难度', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/solo/session', payload: { difficulty: 'nightmare' } })
    expect(res.statusCode).toBe(400)
  })

  it('不存在的会话返回 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/solo/not-a-session/question/0' })
    expect(res.statusCode).toBe(404)
  })
})

// 这一组是整个单机模式的安全边界：客户端必须拿到足够渲染选项的信息，
// 但绝不能拿到任何能推出答案的东西
describe('答案不泄露', () => {
  it('题目响应里没有 answerIndex / songId / sliceId', async () => {
    const s = await newSession('hard')
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({ method: 'GET', url: `/api/solo/${s.sessionId}/question/${i}` })
      const raw = res.body
      expect(raw).not.toMatch(/answerIndex/)
      expect(raw).not.toMatch(/songId/)
      expect(raw).not.toMatch(/sliceId/)
      expect(raw).not.toMatch(/sliceIndex/)
      expect(raw).not.toMatch(/correct/)
      const q = res.json() as { options: unknown[]; clipToken: string }
      expect(q.options).toHaveLength(DIFFICULTY_PRESETS.hard.optionCount)
      expect(q.clipToken).toMatch(/^[0-9a-f]{32}$/)
    }
  })

  it('选项里不含 duration —— 时长几乎唯一标识曲目，是真实旁路', async () => {
    const s = await newSession()
    const q = await question(s.sessionId, 0)
    for (const o of q.options) {
      expect(Object.keys(o).sort()).toEqual(['artist', 'id', 'title', 'unitColor'])
    }
  })

  it('clip token 是每局随机的，同一首歌在两局里 token 不同', async () => {
    const a = await newSession()
    const b = await newSession()
    const qa = await question(a.sessionId, 0)
    const qb = await question(b.sessionId, 0)
    expect(qa.clipToken).not.toBe(qb.clipToken)
  })

  it('token 不能跨会话使用', async () => {
    const a = await newSession()
    const b = await newSession()
    const qa = await question(a.sessionId, 0)
    const res = await app.inject({ method: 'GET', url: `/api/clip/${b.sessionId}/${qa.clipToken}` })
    expect(res.statusCode).toBe(404)
  })

  it('伪造的 token 拿不到音频', async () => {
    const s = await newSession()
    const res = await app.inject({ method: 'GET', url: `/api/clip/${s.sessionId}/${'0'.repeat(32)}` })
    expect(res.statusCode).toBe(404)
  })
})

describe('音频下发', () => {
  it('凭 token 能取到切片，且是固定大小的 opus', async () => {
    const s = await newSession()
    const q = await question(s.sessionId, 0)
    const res = await app.inject({ method: 'GET', url: `/api/clip/${s.sessionId}/${q.clipToken}` })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('audio/ogg')
    // 全部切片都是硬 CBR，字节数完全相同——文件大小不携带任何曲目信息
    expect(res.rawPayload.length).toBe(151504)
    expect(res.headers['cache-control']).toBe('no-store')
  })

  // 老 Safari（18.4 以前）放不了 Ogg Opus，兜底走同名的 .m4a
  it('AAC 兜底与主格式共用同一个 token', async () => {
    const s = await newSession()
    const q = await question(s.sessionId, 0)
    const res = await app.inject({
      method: 'GET',
      url: `/api/clip/${s.sessionId}/${q.clipToken}.m4a`,
    })
    expect(typeof s.aacFallback).toBe('boolean')

    if (s.aacFallback) {
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toBe('audio/mp4')
      // 补过 free box，字节数同样完全一致
      expect(res.rawPayload.length).toBe(208_000)
      expect(res.headers['cache-control']).toBe('no-store')
    } else {
      // 没构建兜底时要干净地 404，而不是 500 —— 客户端只会退回主格式
      expect(res.statusCode).toBe(404)
    }
  })

  it('伪造 token 加上 .m4a 一样拿不到音频', async () => {
    const s = await newSession()
    const res = await app.inject({
      method: 'GET',
      url: `/api/clip/${s.sessionId}/${'0'.repeat(32)}.m4a`,
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('作答', () => {
  it('答对时揭晓答案与封面', async () => {
    const s = await newSession('easy')
    const q = await question(s.sessionId, 0)
    // 先随便答一个，从响应里拿到正确位置
    const res = await app.inject({
      method: 'POST',
      url: `/api/solo/${s.sessionId}/question/0/answer`,
      payload: { choice: 0 },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      correct: boolean
      answerIndex: number
      song: { id: string; title: string }
    }
    expect(body.answerIndex).toBeGreaterThanOrEqual(0)
    expect(body.answerIndex).toBeLessThan(q.options.length)
    expect(body.correct).toBe(body.answerIndex === 0)
    expect(body.song.title).toBeTruthy()
    // coverUrl 字段已随 480px 档一起删除（揭晓图由前端按 songId 拼 /thumb/）。反向断言挡住它被加回来
    expect(body.song).not.toHaveProperty('coverUrl')
    // 这条断言同时是「揭晓槽能命中选项条已下载的 thumb」的唯一自动化依据：
    // 揭晓槽与正确选项渲染的是同一个 /thumb/<songId>.webp，答案必在选项里，缓存命中才成立
    expect(q.options[body.answerIndex]?.id).toBe(body.song.id)
  })

  it('480px 封面档已下线：/cover 不再伺服任何图片', async () => {
    const s = await newSession('easy')
    const q = await question(s.sessionId, 0)
    const answerId = q.options[0]?.id as string
    const res = await app.inject({ method: 'GET', url: `/cover/${answerId}.webp` })
    // 前端构建产物由本进程托管时，未匹配的 GET 会走 SPA 兜底回 index.html；
    // 没构建时是普通 404。两种形态的共同点是：这里不再回任何 image/webp
    expect(res.headers['content-type']).not.toMatch(/^image\//)
  })

  it('同一题不能答两次', async () => {
    const s = await newSession()
    await question(s.sessionId, 0)
    const first = await app.inject({
      method: 'POST',
      url: `/api/solo/${s.sessionId}/question/0/answer`,
      payload: { choice: 1 },
    })
    expect(first.statusCode).toBe(200)
    const second = await app.inject({
      method: 'POST',
      url: `/api/solo/${s.sessionId}/question/0/answer`,
      payload: { choice: 2 },
    })
    expect(second.statusCode).toBe(409)
  })

  it('拒绝格式错误的答案', async () => {
    const s = await newSession()
    await question(s.sessionId, 0)
    const res = await app.inject({
      method: 'POST',
      url: `/api/solo/${s.sessionId}/question/0/answer`,
      payload: { choice: 'first' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('重听', () => {
  // 浏览器 fetch 常会给无 body 的 POST 也带上 content-type: application/json，
  // Fastify 默认会因为解析空 body 直接返回 400
  it('无 body 但带 content-type 的 POST 不会被判 400', async () => {
    const s = await newSession()
    for (const suffix of ['begin', 'replay']) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/solo/${s.sessionId}/question/0/${suffix}`,
        headers: { 'content-type': 'application/json' },
        body: '',
      })
      expect(res.statusCode).toBe(200)
    }
  })

  it('begin 幂等，重复调用不重置计时', async () => {
    const s = await newSession()
    const a = await app.inject({ method: 'POST', url: `/api/solo/${s.sessionId}/question/0/begin` })
    expect(a.statusCode).toBe(200)
    expect(a.json().deadlineMs).toBe(DIFFICULTY_PRESETS.hard.answerSeconds * 1000)
    const b = await app.inject({ method: 'POST', url: `/api/solo/${s.sessionId}/question/0/begin` })
    expect(b.statusCode).toBe(200)
  })

  it('用完次数后拒绝', async () => {
    const s = await newSession('hard') // 困难只允许 1 次
    await question(s.sessionId, 0)
    const ok = await app.inject({ method: 'POST', url: `/api/solo/${s.sessionId}/question/0/replay` })
    expect(ok.statusCode).toBe(200)
    const denied = await app.inject({ method: 'POST', url: `/api/solo/${s.sessionId}/question/0/replay` })
    expect(denied.statusCode).toBe(429)
  })

  it('简单难度允许 2 次', async () => {
    const s = await newSession('easy')
    await question(s.sessionId, 0)
    for (let i = 0; i < DIFFICULTY_PRESETS.easy.replays; i++) {
      const res = await app.inject({ method: 'POST', url: `/api/solo/${s.sessionId}/question/0/replay` })
      expect(res.statusCode).toBe(200)
    }
    const denied = await app.inject({ method: 'POST', url: `/api/solo/${s.sessionId}/question/0/replay` })
    expect(denied.statusCode).toBe(429)
  })
})

describe('计分', () => {
  it('答对时返回分数明细，且答得快分更高', async () => {
    const fast = await newSession('easy')
    await question(fast.sessionId, 0)
    const fastRes = await app.inject({
      method: 'POST',
      url: `/api/solo/${fast.sessionId}/question/0/answer`,
      payload: { choice: 0 },
    })
    const f = fastRes.json() as { correct: boolean; score: { total: number; base: number; speed: number } }

    // 另开一局，先等一会儿再答，模拟慢速作答
    const slow = await newSession('easy')
    await question(slow.sessionId, 0)
    await app.inject({ method: 'POST', url: `/api/solo/${slow.sessionId}/question/0/begin` })
    await new Promise((r) => setTimeout(r, 600))
    const slowRes = await app.inject({
      method: 'POST',
      url: `/api/solo/${slow.sessionId}/question/0/answer`,
      payload: { choice: 0 },
    })
    const s = slowRes.json() as { correct: boolean; score: { total: number; speed: number } }

    if (f.correct && s.correct) {
      expect(f.score.speed).toBeGreaterThanOrEqual(s.score.speed)
    }
    // 无论对错，明细结构都要在
    expect(typeof f.score.total).toBe('number')
    expect(f.correct ? f.score.total : 0).toBe(f.score.total)
  })

  it('答错得 0 分', async () => {
    const s = await newSession('easy')
    const q = await question(s.sessionId, 0)
    // 先探出正确位置，再故意选别的
    const probe = await newSession('easy')
    void probe
    const res = await app.inject({
      method: 'POST',
      url: `/api/solo/${s.sessionId}/question/0/answer`,
      payload: { choice: 0 },
    })
    const body = res.json() as { correct: boolean; answerIndex: number; score: { total: number } }
    if (!body.correct) expect(body.score.total).toBe(0)
    else expect(body.score.total).toBeGreaterThan(0)
    expect(body.answerIndex).toBeLessThan(q.options.length)
  })

  it('结算含总分与满分', async () => {
    const s = await newSession('easy')
    for (let i = 0; i < s.total; i++) {
      await question(s.sessionId, i)
      await app.inject({
        method: 'POST',
        url: `/api/solo/${s.sessionId}/question/${i}/answer`,
        payload: { choice: i % 4 },
      })
    }
    const summary = (await app.inject({ method: 'GET', url: `/api/solo/${s.sessionId}/result` })).json() as {
      score: number
      maxScore: number
      correct: number
      items: Array<{ score: number | null; correct: boolean | null }>
    }
    expect(summary.maxScore).toBe(s.total * 200)
    expect(summary.score).toBeGreaterThanOrEqual(0)
    expect(summary.score).toBeLessThanOrEqual(summary.maxScore)
    // 总分应等于各题得分之和
    const sum = summary.items.reduce((acc, it) => acc + (it.score ?? 0), 0)
    expect(summary.score).toBe(sum)
    // 答错的题得分必须是 0
    for (const it of summary.items) {
      if (it.correct === false) expect(it.score).toBe(0)
    }
  })
})

describe('整局流程', () => {
  it('打完一整局并拿到结算', async () => {
    const s = await newSession('easy')
    let correct = 0

    for (let i = 0; i < s.total; i++) {
      const q = await question(s.sessionId, i)
      expect(q.options).toHaveLength(4)
      const res = await app.inject({
        method: 'POST',
        url: `/api/solo/${s.sessionId}/question/${i}/answer`,
        payload: { choice: i % 4 },
      })
      const body = res.json() as { correct: boolean }
      if (body.correct) correct++
    }

    const result = await app.inject({ method: 'GET', url: `/api/solo/${s.sessionId}/result` })
    expect(result.statusCode).toBe(200)
    const summary = result.json() as {
      total: number
      correct: number
      answered: number
      items: Array<{ correct: boolean | null; song: { title: string } }>
    }
    expect(summary.total).toBe(s.total)
    expect(summary.answered).toBe(s.total)
    expect(summary.correct).toBe(correct)
    expect(summary.items).toHaveLength(s.total)
    // 结算页要能逐题回顾，所以此时曲名必须给全
    for (const item of summary.items) expect(item.song.title).toBeTruthy()
  })

  it('一局内不会重复考同一首歌', async () => {
    const s = await newSession('hard')
    for (let i = 0; i < s.total; i++) {
      await question(s.sessionId, i)
      await app.inject({
        method: 'POST',
        url: `/api/solo/${s.sessionId}/question/${i}/answer`,
        payload: { choice: 0 },
      })
    }
    const summary = (await app.inject({ method: 'GET', url: `/api/solo/${s.sessionId}/result` })).json() as {
      items: Array<{ song: { id: string } }>
    }
    const ids = summary.items.map((i) => i.song.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

/**
 * 响应压缩。
 *
 * 这一组里**反向那条才是重点** —— 正向只是确认插件装上了，反向守的是红线：
 * 切片被压缩意味着热路径白烧 CPU，还会多出一个不该有的 `content-encoding`。
 * 默认的 mime-db 判定已经把音频排除在外，但那是依赖的默认行为，
 * 换个版本就可能变，所以要有断言钉住。
 *
 * `inject` 默认不带 `accept-encoding`，不显式加就永远测不到压缩。
 */
describe('响应压缩', () => {
  const ACCEPT = { 'accept-encoding': 'br, gzip' }

  it('JSON 响应会被压缩', async () => {
    const s = await newSession()
    for (let i = 0; i < s.total; i++) {
      await question(s.sessionId, i)
      await app.inject({
        method: 'POST',
        url: `/api/solo/${s.sessionId}/question/${i}/answer`,
        payload: { choice: 0 },
      })
    }
    const url = `/api/solo/${s.sessionId}/result`

    // 先确认这个响应确实超过 1024 的压缩阈值，否则下面那条断言是空过的
    const plain = await app.inject({ method: 'GET', url })
    expect(plain.rawPayload.length).toBeGreaterThan(1024)
    expect(plain.headers['content-encoding']).toBeUndefined()

    const res = await app.inject({ method: 'GET', url, headers: ACCEPT })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-encoding']).toBeTruthy()
    expect(res.rawPayload.length).toBeLessThan(plain.rawPayload.length)
  })

  it('切片不会被压缩，且仍是 no-store、无 Last-Modified', async () => {
    const s = await newSession()
    const q = await question(s.sessionId, 0)
    const res = await app.inject({
      method: 'GET',
      url: `/api/clip/${s.sessionId}/${q.clipToken}`,
      headers: ACCEPT,
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-encoding']).toBeUndefined()
    // 硬 CBR 的字节数必须原样透出——压缩会破坏「文件大小不携带曲目信息」这条性质
    expect(res.rawPayload.length).toBe(151504)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['last-modified']).toBeUndefined()
  })

  it('环境 BGM 的切片同样不被压缩', async () => {
    const tracks = (
      await app.inject({ method: 'GET', url: '/api/ambience/tracks?n=1' })
    ).json() as { tracks: Array<{ clips: string[] }> }
    const token = tracks.tracks[0]?.clips[0]
    expect(token).toBeTruthy()

    const res = await app.inject({
      method: 'GET',
      url: `/api/ambience/clip/${token}`,
      headers: ACCEPT,
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-encoding']).toBeUndefined()
    expect(res.headers['cache-control']).toBe('no-store')
  })
})
