import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'

import { ASSETS_ROOT, STAGE_VERSIONS } from './config.js'
import { AUDIT_PAGE } from './pages/auditPage.js'
import { REVIEW_PAGE } from './pages/reviewPage.js'
import { buildReview, writeReview, type ReviewRow } from './review.js'
import { clearOverride, listOverrides, setOverride } from './overridesStore.js'
import { rebuildManifests, reresolve, writeScanJson, SLICE_DIR_CACHE } from './pipeline.js'
import { slicePath } from './slice.js'
import { StageCache } from './util/cache.js'
import type { SliceSpec, SongMeta } from './types.js'
import type { UnitTables } from './resolveUnit.js'

const RATINGS_FILE = path.join(ASSETS_ROOT, 'audit-ratings.json')

export interface Rating {
  sliceId: string
  songId: string
  title: string
  sliceIndex: number
  startSec: number
  /** 3=一听就认出 2=想一下能认 1=完全认不出 */
  score: 1 | 2 | 3
  /** 评分时最后播放的时长（秒）。用来回答「6 秒到底够不够」 */
  ratedAtSeconds: number | null
  /** 本题听过的全部时长档位 */
  heardSeconds: number[]
  at: string
}

/** 给编辑界面用的一行：复核结果 + 编辑所需的额外字段 */
interface EditableRow extends ReviewRow {
  performers: string[]
  isOverridden: boolean
  /** 试听用的切片 id */
  sampleSliceId: string | null
}

interface ServerState {
  songs: SongMeta[]
  tables: UnitTables
  rows: EditableRow[]
  /** 全部切片的扁平表，抽检用 */
  flatSlices: Array<{
    sliceId: string
    songId: string
    title: string
    unit: string | null
    sliceIndex: number
    startSec: number
  }>
}

async function loadState(): Promise<ServerState> {
  const { songs, tables } = await reresolve()
  const baseRows = await buildReview(songs, tables)
  const overrides = await listOverrides()

  const specCache = new StageCache<SliceSpec[]>(SLICE_DIR_CACHE, STAGE_VERSIONS.slice)
  const specsBySong = new Map<string, SliceSpec[]>()
  const flatSlices: ServerState['flatSlices'] = []
  const byTitle = new Map(songs.map((s) => [s.title, s]))

  for (const s of songs) {
    const specs = await specCache.get(s.id, s.srcSize, s.srcMtimeMs)
    if (!specs) continue
    specsBySong.set(s.id, specs)
    for (const sp of specs) {
      flatSlices.push({
        sliceId: sp.sliceId,
        songId: s.id,
        title: s.title,
        unit: s.unit ? (tables.unitById.get(s.unit)?.name ?? s.unit) : null,
        sliceIndex: sp.index,
        startSec: sp.startSec,
      })
    }
  }

  const rows: EditableRow[] = baseRows.map((r) => {
    const song = byTitle.get(r.title)
    const specs = song ? specsBySong.get(song.id) : undefined
    return {
      ...r,
      performers: song?.performers ?? [],
      isOverridden: Object.prototype.hasOwnProperty.call(overrides, r.title),
      sampleSliceId: specs?.[0]?.sliceId ?? null,
    }
  })

  return { songs, tables, rows, flatSlices }
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

async function readBody<T>(req: http.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as T
}

export async function serveDevConsole(port = 5178): Promise<void> {
  let state = await loadState()

  let ratings: Rating[] = []
  try {
    ratings = JSON.parse(await fs.readFile(RATINGS_FILE, 'utf8')) as Rating[]
  } catch {
    /* 首次运行 */
  }

  /** 归属改动后重新决议并持久化 scan.json，让改动进入后续流水线 */
  async function refresh(): Promise<void> {
    state = await loadState()
    await writeScanJson(state.songs)
    await writeReview(state.rows)
  }

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`)
      const p = url.pathname

      if (p === '/' || p === '/index.html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(AUDIT_PAGE)
        return
      }
      if (p === '/review') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(REVIEW_PAGE)
        return
      }

      // ── 抽检 ────────────────────────────────────────────
      if (p === '/api/next') {
        const done = new Set(ratings.map((r) => r.sliceId))
        const pool = state.flatSlices.filter((f) => !done.has(f.sliceId))
        const src = pool.length ? pool : state.flatSlices
        const pick = src[Math.floor(Math.random() * src.length)]
        const dist: Record<number, number> = { 1: 0, 2: 0, 3: 0 }
        for (const r of ratings) dist[r.score] = (dist[r.score] ?? 0) + 1
        json(res, 200, { ...pick, rated: ratings.length, total: state.flatSlices.length, dist })
        return
      }

      if (p === '/api/rate' && req.method === 'POST') {
        const body = await readBody<Rating>(req)
        ratings = ratings.filter((r) => r.sliceId !== body.sliceId)
        ratings.push({ ...body, at: new Date().toISOString() })
        await fs.writeFile(RATINGS_FILE, JSON.stringify(ratings, null, 2), 'utf8')
        json(res, 200, { ok: true })
        return
      }

      if (p.startsWith('/clip/')) {
        const id = p.slice('/clip/'.length)
        if (!/^[0-9A-Z]{20}$/.test(id)) {
          res.writeHead(400).end('bad id')
          return
        }
        try {
          const data = await fs.readFile(slicePath(id))
          res.writeHead(200, { 'content-type': 'audio/ogg', 'cache-control': 'no-store' }).end(data)
        } catch {
          res.writeHead(404).end('not found')
        }
        return
      }

      // ── 归属编辑 ─────────────────────────────────────────
      if (p === '/api/review') {
        const units = state.tables.units.map((u) => ({ id: u.id, name: u.name, color: u.color }))
        const characters = state.tables.units.flatMap((u) =>
          u.members.map((m) => ({ name: m.character, cv: m.cv, unitName: u.name })),
        )
        json(res, 200, { rows: state.rows, units, characters })
        return
      }

      if (p === '/api/override' && req.method === 'POST') {
        const body = await readBody<{
          title: string
          unit: string | null
          performers: string[]
          note?: string
        }>(req)
        if (!body.title || !state.rows.some((r) => r.title === body.title)) {
          json(res, 400, { ok: false, error: `未知曲目：${body.title}` })
          return
        }
        if (body.unit && !state.tables.unitById.has(body.unit)) {
          json(res, 400, { ok: false, error: `未知组合：${body.unit}` })
          return
        }
        const unknown = (body.performers ?? []).filter(
          (c) => !state.tables.characterToUnit.has(c.normalize('NFKC').replace(/\s+/g, '').toLowerCase()),
        )
        if (unknown.length > 0) {
          json(res, 400, { ok: false, error: `未知角色名：${unknown.join('、')}` })
          return
        }
        await setOverride(body.title, {
          ...(body.unit ? { unit: body.unit } : {}),
          ...(body.performers?.length ? { performers: body.performers } : {}),
          ...(body.note ? { note: body.note } : {}),
        })
        await refresh()
        json(res, 200, { ok: true })
        return
      }

      if (p === '/api/override/clear' && req.method === 'POST') {
        const body = await readBody<{ title: string }>(req)
        await clearOverride(body.title)
        await refresh()
        json(res, 200, { ok: true })
        return
      }

      if (p === '/api/rebuild' && req.method === 'POST') {
        const result = await rebuildManifests(state.songs, state.tables)
        json(res, result.ok ? 200 : 500, result)
        return
      }

      res.writeHead(404).end('not found')
    })().catch((err) => {
      if (!res.headersSent) json(res, 500, { ok: false, error: String(err) })
      else res.end()
    })
  })

  await new Promise<void>((resolve) => server.listen(port, resolve))
  process.stdout.write(`\n  抽检     http://localhost:${port}/\n`)
  process.stdout.write(`  归属编辑  http://localhost:${port}/review\n\n`)
  process.stdout.write(
    `  ${state.songs.length} 首 · ${state.flatSlices.length} 个切片 · 已评 ${ratings.length} 个 · Ctrl+C 结束\n`,
  )
}
