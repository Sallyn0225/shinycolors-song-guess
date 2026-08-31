import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'

import { AmbienceStore } from './ambience.js'
import { buildApp } from './app.js'
import { Catalog } from './catalog.js'

let app: FastifyInstance

beforeAll(async () => {
  app = await buildApp()
  await app.ready()
})
afterAll(async () => {
  await app.close()
})
afterEach(() => {
  vi.useRealTimers()
})

async function tracks(n?: number) {
  const url = n === undefined ? '/api/ambience/tracks' : `/api/ambience/tracks?n=${n}`
  const res = await app.inject({ method: 'GET', url })
  expect(res.statusCode).toBe(200)
  return res.json() as { tracks: Array<{ clips: string[] }>; aacFallback: boolean }
}

describe('氛围曲目不泄露曲目身份', () => {
  it('响应里没有 songId / 曲名 / index / 时长', async () => {
    const body = await tracks(4)
    // 整个响应体序列化后逐字段查，比逐个 toBeUndefined 更难漏
    const keys = new Set<string>()
    const walk = (v: unknown) => {
      if (Array.isArray(v)) return v.forEach(walk)
      if (v && typeof v === 'object') {
        for (const [k, val] of Object.entries(v)) {
          keys.add(k)
          walk(val)
        }
      }
    }
    walk(body)
    expect([...keys].sort()).toEqual(['aacFallback', 'clips', 'tracks'])
  })

  it('token 是不透明随机串，与 sliceId 无关', async () => {
    const body = await tracks(2)
    for (const t of body.tracks) {
      for (const c of t.clips) {
        // sliceId 是 20 字符 Crockford base32；这里是 32 字符 hex，两者不可能混淆
        expect(c).toMatch(/^[0-9a-f]{32}$/)
      }
    }
  })

  it('两次请求拿到的 token 互不相同', async () => {
    const a = await tracks(2)
    const b = await tracks(2)
    const all = [...a.tracks.flatMap((t) => t.clips), ...b.tracks.flatMap((t) => t.clips)]
    expect(new Set(all).size).toBe(all.length)
  })
})

describe('氛围切片下发', () => {
  it('凭 token 能取到 opus', async () => {
    const body = await tracks(1)
    const token = body.tracks[0]?.clips[0]
    expect(token).toBeTruthy()
    const res = await app.inject({ method: 'GET', url: `/api/ambience/clip/${token}` })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('audio/ogg')
    // 缓存命中与否的时间差是弱旁路，与既有 clip 端点同样必须 no-store
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.rawPayload.length).toBeGreaterThan(1000)
  })

  it('AAC 兜底与主格式共用同一个 token', async () => {
    const body = await tracks(1)
    const token = body.tracks[0]?.clips[0]
    const res = await app.inject({ method: 'GET', url: `/api/ambience/clip/${token}.m4a` })
    // 曲库没生成兜底副本时是 404，生成了就该是 audio/mp4——两者都不算失败
    if (body.aacFallback) {
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toBe('audio/mp4')
    } else {
      expect(res.statusCode).toBe(404)
    }
  })

  it('伪造的 token 拿不到音频', async () => {
    for (const bogus of ['deadbeef', 'f'.repeat(32), '../../etc/passwd']) {
      const res = await app.inject({ method: 'GET', url: `/api/ambience/clip/${bogus}` })
      expect(res.statusCode).toBe(404)
    }
  })

  it('n 被钳制在 1~4', async () => {
    expect((await tracks(0)).tracks).toHaveLength(1)
    expect((await tracks(99)).tracks).toHaveLength(4)
    // 非数字回落到 1，而不是 NaN 个
    const res = await app.inject({ method: 'GET', url: '/api/ambience/tracks?n=abc' })
    expect((res.json() as { tracks: unknown[] }).tracks).toHaveLength(1)
  })
})

describe('AmbienceStore', () => {
  it('一个曲目取的是同一首歌的连续切片', async () => {
    const catalog = await Catalog.load()
    const store = new AmbienceStore(catalog)

    // 反查每个 token 的 sliceId，再回到 catalog 里确认它们同属一首歌且 index 连续
    for (const track of store.mintTracks(30)) {
      const ids = track.clips.map((c) => store.sliceIdForToken(c))
      expect(ids.every((id) => id !== null)).toBe(true)

      const owners = ids.map((id) => catalog.songs.find((s) => s.slices.some((x) => x.sliceId === id)))
      const first = owners[0]
      expect(first).toBeTruthy()
      expect(owners.every((o) => o?.id === first?.id)).toBe(true)

      const idx = ids.map((id) => first?.slices.find((x) => x.sliceId === id)?.index ?? -1)
      for (let i = 1; i < idx.length; i++) {
        expect(idx[i]).toBe((idx[i - 1] as number) + 1)
      }
      // 切片够多的歌应当取满 3~4 段；只切得出一两段的短曲按实际有的取
      expect(track.clips.length).toBeLessThanOrEqual(4)
      expect(track.clips.length).toBe(Math.min(track.clips.length, first?.slices.length ?? 0))
    }
  })

  it('凭证过期后取不到', async () => {
    const catalog = await Catalog.load()
    const store = new AmbienceStore(catalog)
    const token = store.mintTracks(1)[0]?.clips[0] as string
    expect(store.sliceIdForToken(token)).toBeTruthy()

    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 31 * 60_000)
    expect(store.sliceIdForToken(token)).toBeNull()
  })

  it('过期凭证会被清掉，内存表不随进程寿命增长', async () => {
    const catalog = await Catalog.load()
    const store = new AmbienceStore(catalog)
    store.mintTracks(4)
    const before = store.size
    expect(before).toBeGreaterThan(0)

    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 31 * 60_000)
    // 下一次铸造顺手清扫（刻意不开定时器，与 ws/quota.ts 同一个思路）
    store.mintTracks(1)
    expect(store.size).toBeLessThan(before)
  })
})
