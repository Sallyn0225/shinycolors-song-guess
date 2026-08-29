#!/usr/bin/env tsx
import fs from 'node:fs/promises'
import path from 'node:path'

import { ASSETS_ROOT, CACHE_DIR, CANONICAL_MTIME, STAGE_VERSIONS, defaultConcurrency } from './config.js'
import { scan } from './scan.js'
import { buildMeta } from './buildMeta.js'
import { analyzeSong, gainForTrack } from './analyze.js'
import { planSlices } from './planSlices.js'
import { encodeSlice, slicePath, specsFor } from './slice.js'
import { coverPath, encodeCovers, thumbPath } from './covers.js'
import { loadTables } from './resolveUnit.js'
import { assertPublicManifestClean, writeManifests } from './manifest.js'
import { serveDevConsole } from './devserver.js'
import { buildReview, writeReview, REVIEW_MD, REVIEW_JSON } from './review.js'
import { ANALYSIS_DIR, SCAN_JSON, SLICE_DIR_CACHE } from './pipeline.js'
import { previewSoloRound, stressSolo } from './preview.js'
import { StageCache, Progress } from './util/cache.js'
import { mapConcurrent } from './util/proc.js'
import { probe } from './util/ffprobe.js'
import type { AnalysisResult, SliceSpec, SongMeta } from './types.js'

const STAGES = [
  'scan',
  'analyze',
  'slice',
  'covers',
  'manifest',
  'audit',
  'review',
  'preview',
  'stress',
  'all',
] as const
type Stage = (typeof STAGES)[number]

interface Args {
  stage: Stage
  concurrency: number
  force: boolean
  only: string | null
  /** 重新生成全部 sliceId。用于「换 id 打断攻击者积累的对照表」——只需 rename，不重新编码 */
  rotateIds: boolean
}

function parseArgs(argv: string[]): Args {
  const stage = (argv[0] ?? 'all') as Stage
  if (!STAGES.includes(stage)) {
    console.error(`未知 stage: ${stage}\n可用: ${STAGES.join(' | ')}`)
    process.exit(2)
  }
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag)
    return i >= 0 ? (argv[i + 1] ?? null) : null
  }
  return {
    stage,
    concurrency: Number(get('--concurrency') ?? defaultConcurrency()),
    force: argv.includes('--force'),
    only: get('--only'),
    rotateIds: argv.includes('--rotate-ids'),
  }
}

function fmtMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`
}

/** 读取上一次 scan 的结果；没有就现场跑一次 */
async function loadMeta(args: Args): Promise<SongMeta[]> {
  try {
    const raw = await fs.readFile(SCAN_JSON, 'utf8')
    const parsed = JSON.parse(raw) as { songs: SongMeta[] }
    if (parsed.songs?.length) return parsed.songs
  } catch {
    /* 落到下面重新扫描 */
  }
  process.stdout.write(`[scan] 未找到缓存，先扫描一次…\n`)
  await stageScan(args)
  const raw = await fs.readFile(SCAN_JSON, 'utf8')
  return (JSON.parse(raw) as { songs: SongMeta[] }).songs
}

function applyOnly(songs: SongMeta[], only: string | null): SongMeta[] {
  if (!only) return songs
  const needle = only.toLowerCase()
  return songs.filter((s) => s.title.toLowerCase().includes(needle) || s.id.includes(needle))
}

async function stageScan(args: Args): Promise<void> {
  const t0 = performance.now()
  process.stdout.write(`[scan] 扫描 songs/ …\n`)

  const { songs, issues } = await scan({ concurrency: args.concurrency })
  process.stdout.write(`[scan] ${songs.length} 首，耗时 ${fmtMs(performance.now() - t0)}\n`)

  const meta = await buildMeta(songs)

  process.stdout.write(`\n[scan] 演唱者决议来源分布：\n`)
  const order = [
    'override',
    'artist-exact',
    'artist-split',
    'artist-cv',
    'seiyuu-table',
    'album-series',
    'album-pattern',
    'album-exact',
    'title-paren',
    'unresolved',
  ]
  for (const src of order) {
    const n = meta.sourceCounts[src]
    if (n) process.stdout.write(`  ${String(n).padStart(4)}  ${src}\n`)
  }
  const resolved = songs.length - (meta.sourceCounts['unresolved'] ?? 0)
  process.stdout.write(
    `  → 覆盖率 ${resolved}/${songs.length} = ${((resolved / songs.length) * 100).toFixed(1)}%\n`,
  )

  if (meta.confusableGroups.size > 0) {
    process.stdout.write(`\n[scan] 易混淆组（同组内抽题/发牌时最多取 1 首）：\n`)
    for (const [key, group] of meta.confusableGroups) {
      process.stdout.write(`  ${group.length} 首 · ${key}\n`)
    }
  }

  if (meta.unresolved.length > 0) {
    process.stdout.write(`\n[scan] 演唱者未决议（需人工确认，写进 data/overrides.json）：\n`)
    for (const s of meta.unresolved) {
      process.stdout.write(`  ${s.title}  ||artist=${s.rawArtist}  ||album=${s.album}\n`)
    }
  }

  if (issues.length > 0) {
    process.stdout.write(`\n[scan] ⚠ 结构问题 ${issues.length} 条：\n`)
    for (const i of issues) process.stdout.write(`  ${i.dirName}: ${i.problem}\n`)
  }

  await fs.mkdir(CACHE_DIR, { recursive: true })
  await fs.writeFile(
    SCAN_JSON,
    JSON.stringify({ generatedAt: new Date().toISOString(), songs: meta.songs }, null, 2),
    'utf8',
  )
  process.stdout.write(`\n[scan] 写出 ${path.relative(ASSETS_ROOT, SCAN_JSON)}\n`)

  if (issues.length > 0) process.exitCode = 1
}

async function stageAnalyze(args: Args): Promise<AnalysisResult[]> {
  const all = await loadMeta(args)
  const songs = applyOnly(all, args.only)
  const cache = new StageCache<AnalysisResult>(ANALYSIS_DIR, STAGE_VERSIONS.analyze)
  const bar = new Progress('analyze', songs.length)

  const failures: Array<{ title: string; error: string }> = []
  let cacheHits = 0

  const results = await mapConcurrent(songs, args.concurrency, async (song) => {
    try {
      if (!args.force) {
        const hit = await cache.get(song.id, song.srcSize, song.srcMtimeMs)
        if (hit) {
          cacheHits++
          bar.tick(`⟨缓存 ${song.title}⟩`)
          return hit
        }
      }
      const res = await analyzeSong(song)
      await cache.set(song.id, song.srcSize, song.srcMtimeMs, res)
      bar.tick(`⟨${song.title}⟩`)
      return res
    } catch (err) {
      failures.push({ title: song.title, error: String(err) })
      bar.tick(`⟨失败 ${song.title}⟩`, false)
      return null
    }
  })

  bar.finish()
  if (cacheHits > 0) process.stdout.write(`[analyze] 缓存命中 ${cacheHits}/${songs.length}\n`)

  const ok = results.filter((r): r is AnalysisResult => r !== null)

  // ── 响度分布 ─────────────────────────────────────────
  const lufs = ok.map((r) => r.integratedLufs).sort((a, b) => a - b)
  const peaks = ok.map((r) => r.truePeakDbfs).sort((a, b) => a - b)
  const gains = ok.map(gainForTrack).sort((a, b) => a - b)
  const pick = (arr: number[], q: number) => arr[Math.min(arr.length - 1, Math.floor(arr.length * q))] ?? 0
  process.stdout.write(
    `[analyze] mono integrated  min=${lufs[0]?.toFixed(1)} 中位=${pick(lufs, 0.5).toFixed(1)} max=${lufs[lufs.length - 1]?.toFixed(1)} LUFS\n`,
  )
  process.stdout.write(
    `[analyze] mono true peak   min=${peaks[0]?.toFixed(1)} 中位=${pick(peaks, 0.5).toFixed(1)} max=${peaks[peaks.length - 1]?.toFixed(1)} dBFS\n`,
  )
  process.stdout.write(
    `[analyze] 归一化增益        min=${gains[0]?.toFixed(1)} 中位=${pick(gains, 0.5).toFixed(1)} max=${gains[gains.length - 1]?.toFixed(1)} dB\n`,
  )
  const boosted = gains.filter((g) => g > 0).length
  process.stdout.write(
    `[analyze] 需要增益(>0dB)的曲目：${boosted} 首${boosted === 0 ? '（全部是衰减，无削波风险，不需要 limiter）' : ''}\n`,
  )

  // ── 切片规划的降级分布 ────────────────────────────────
  const byId = new Map(songs.map((s) => [s.id, s]))
  const degrade = new Map<number, string[]>()
  let shortPlans = 0
  for (const r of ok) {
    const song = byId.get(r.songId)
    if (!song) continue
    const plan = planSlices(song.durationSec, r.silences)
    if (plan.slices.length < 6) shortPlans++
    const arr = degrade.get(plan.degradeLevel) ?? []
    arr.push(`${song.title} (${plan.slices.length}段)`)
    degrade.set(plan.degradeLevel, arr)
  }
  process.stdout.write(`\n[analyze] 切片规划降级分布：\n`)
  for (const level of [...degrade.keys()].sort((a, b) => a - b)) {
    const list = degrade.get(level) as string[]
    process.stdout.write(`  L${level}: ${list.length} 首\n`)
    if (level >= 3) for (const t of list) process.stdout.write(`        ⚠ ${t}\n`)
  }
  if (shortPlans > 0) process.stdout.write(`  ⚠ 不足 6 段的曲目：${shortPlans} 首\n`)

  if (failures.length > 0) {
    process.stdout.write(`\n[analyze] ⚠ 失败 ${failures.length} 首：\n`)
    for (const f of failures) process.stdout.write(`  ${f.title}: ${f.error}\n`)
    process.exitCode = 1
  }

  return ok
}

async function stageSlice(args: Args): Promise<Map<string, SliceSpec[]>> {
  const all = await loadMeta(args)
  const songs = applyOnly(all, args.only)
  const analyses = await stageAnalyze(args)
  const analysisById = new Map(analyses.map((a) => [a.songId, a]))

  const specCache = new StageCache<SliceSpec[]>(SLICE_DIR_CACHE, STAGE_VERSIONS.slice)

  // 先把全部切片规格定下来（含复用已有的 sliceId），再并发编码
  const jobs: Array<{ song: SongMeta; spec: SliceSpec }> = []
  const specsBySong = new Map<string, SliceSpec[]>()

  for (const song of songs) {
    const analysis = analysisById.get(song.id)
    if (!analysis) continue
    const cached = args.rotateIds ? null : await specCache.get(song.id, song.srcSize, song.srcMtimeMs)
    const specs = specsFor(song, analysis, cached?.map((s) => s.sliceId))
    specsBySong.set(song.id, specs)
    await specCache.set(song.id, song.srcSize, song.srcMtimeMs, specs)
    for (const spec of specs) jobs.push({ song, spec })
  }

  const bar = new Progress('slice', jobs.length)
  const failures: Array<{ title: string; index: number; error: string }> = []
  let skipped = 0

  await mapConcurrent(jobs, args.concurrency, async ({ song, spec }) => {
    const out = slicePath(spec.sliceId)
    if (!args.force) {
      try {
        const st = await fs.stat(out)
        if (st.size > 0) {
          skipped++
          bar.tick(`⟨已存在⟩`)
          return
        }
      } catch {
        /* 不存在，继续编码 */
      }
    }
    try {
      await encodeSlice(song, spec)
      bar.tick(`⟨${song.title} #${spec.index}⟩`)
    } catch (err) {
      failures.push({ title: song.title, index: spec.index, error: String(err) })
      bar.tick(`⟨失败 ${song.title} #${spec.index}⟩`, false)
    }
  })

  bar.finish()
  if (skipped > 0) process.stdout.write(`[slice] 跳过已存在 ${skipped}/${jobs.length}\n`)

  if (failures.length > 0) {
    process.stdout.write(`[slice] ⚠ 失败 ${failures.length} 个：\n`)
    for (const f of failures.slice(0, 20)) {
      process.stdout.write(`  ${f.title} #${f.index}: ${f.error}\n`)
    }
    process.exitCode = 1
  }

  await normalizeMtimes(jobs.map((j) => slicePath(j.spec.sliceId)))
  await selfCheck(jobs.map((j) => slicePath(j.spec.sliceId)))

  return specsBySong
}

/**
 * 把全部切片的 mtime 统一成一个常量。
 *
 * 不做这一步，「构建顺序 = 曲名字典序」就会经 mtime 泄漏出去——攻击者按 mtime 排一遍
 * 就能还原整张 sliceId → 曲目 对照表。HTTP 层还要相应地只发内容哈希 ETag、禁 Last-Modified。
 */
async function normalizeMtimes(files: string[]): Promise<void> {
  await mapConcurrent(files, 32, async (f) => {
    try {
      await fs.utimes(f, CANONICAL_MTIME, CANONICAL_MTIME)
    } catch {
      /* 文件可能编码失败而不存在，selfCheck 会抓 */
    }
  })
}

/** 构建后自检。任何一条不过就 exit 1——这几条都是「静默上线就泄题」的类型 */
async function selfCheck(files: string[]): Promise<void> {
  process.stdout.write(`\n[slice] 防作弊自检…\n`)
  const problems: string[] = []

  const stats = await mapConcurrent(files, 32, async (f) => {
    try {
      return await fs.stat(f)
    } catch {
      return null
    }
  })
  const present = stats.filter((s): s is NonNullable<typeof s> => s !== null)
  if (present.length !== files.length) {
    problems.push(`缺失切片文件 ${files.length - present.length} 个`)
  }

  // 1. mtime 必须全部一致
  const mtimes = new Set(present.map((s) => Math.round(s.mtimeMs)))
  if (mtimes.size > 1) problems.push(`mtime 未统一：出现 ${mtimes.size} 个不同值（会泄漏构建顺序）`)

  // 2. CBR 生效：字节数应高度集中
  const sizes = present.map((s) => s.size).sort((a, b) => a - b)
  const spread = (sizes[sizes.length - 1] ?? 0) - (sizes[0] ?? 0)
  process.stdout.write(
    `  字节数 min=${sizes[0]} max=${sizes[sizes.length - 1]} 跨度=${spread}B（唯一值 ${new Set(sizes).size} 个）\n`,
  )
  if (spread > 4096) problems.push(`切片字节数跨度 ${spread}B 过大，CBR 可能未生效（会泄漏曲目身份）`)

  // 3. 抽样确认没有残留 tag
  const sample = files.filter((_, i) => i % Math.max(1, Math.floor(files.length / 12)) === 0).slice(0, 12)
  for (const f of sample) {
    try {
      const info = await probe(f)
      const leaked = Object.entries(info.tags).filter(
        ([k]) => !['encoder'].includes(k.toLowerCase()),
      )
      if (leaked.length > 0) {
        problems.push(`切片残留元数据 ${path.basename(f)}: ${JSON.stringify(Object.fromEntries(leaked))}`)
      }
    } catch {
      /* 已在缺失检查里覆盖 */
    }
  }

  if (problems.length === 0) {
    process.stdout.write(`  ✓ mtime 已统一 / CBR 生效 / 抽检 ${sample.length} 个切片无残留 tag\n`)
  } else {
    process.stdout.write(`  ✗ 自检未通过：\n`)
    for (const p of problems) process.stdout.write(`    - ${p}\n`)
    process.exitCode = 1
  }
}

async function stageCovers(args: Args): Promise<void> {
  const songs = applyOnly(await loadMeta(args), args.only)
  const bar = new Progress('covers', songs.length)
  const failures: string[] = []

  await mapConcurrent(songs, args.concurrency, async (song) => {
    if (!args.force) {
      try {
        const st = await fs.stat(coverPath(song.id))
        if (st.size > 0) {
          bar.tick('⟨已存在⟩')
          return
        }
      } catch {
        /* 继续生成 */
      }
    }
    try {
      await encodeCovers(song)
      bar.tick(`⟨${song.title}⟩`)
    } catch (err) {
      failures.push(`${song.title}: ${String(err)}`)
      bar.tick(`⟨失败 ${song.title}⟩`, false)
    }
  })
  bar.finish()

  const all = [...songs.map((s) => thumbPath(s.id)), ...songs.map((s) => coverPath(s.id))]
  await normalizeMtimes(all)
  const sizes = await mapConcurrent(all, 32, async (f) => {
    try {
      return (await fs.stat(f)).size
    } catch {
      return 0
    }
  })
  const total = sizes.reduce((a, b) => a + b, 0)
  process.stdout.write(`[covers] 共 ${all.length} 张，${(total / 1024 / 1024).toFixed(1)} MB\n`)

  if (failures.length > 0) {
    for (const f of failures.slice(0, 10)) process.stdout.write(`  ⚠ ${f}\n`)
    process.exitCode = 1
  }
}

async function stageManifest(args: Args): Promise<void> {
  const songs = await loadMeta(args)
  const tables = await loadTables()

  const analysisCache = new StageCache<AnalysisResult>(ANALYSIS_DIR, STAGE_VERSIONS.analyze)
  const specCache = new StageCache<SliceSpec[]>(SLICE_DIR_CACHE, STAGE_VERSIONS.slice)

  const analyses = new Map<string, AnalysisResult>()
  const specs = new Map<string, SliceSpec[]>()
  const missing: string[] = []

  for (const s of songs) {
    const a = await analysisCache.get(s.id, s.srcSize, s.srcMtimeMs)
    const sp = await specCache.get(s.id, s.srcSize, s.srcMtimeMs)
    if (!a || !sp) {
      missing.push(s.title)
      continue
    }
    analyses.set(s.id, a)
    specs.set(s.id, sp)
  }

  if (missing.length > 0) {
    process.stdout.write(`[manifest] ⚠ ${missing.length} 首缺少 analyze/slice 缓存，请先跑 analyze + slice\n`)
    for (const m of missing.slice(0, 10)) process.stdout.write(`    ${m}\n`)
    process.exitCode = 1
    return
  }

  const { publicCount, sliceCount } = await writeManifests({ songs, tables, analyses, specs })
  process.stdout.write(`[manifest] public ${publicCount} 首 / private 含 ${sliceCount} 个切片映射\n`)

  const problems = await assertPublicManifestClean()
  if (problems.length === 0) {
    process.stdout.write(`  ✓ public manifest 边界检查通过（无 sliceId / duration / 源路径等泄题字段）\n`)
  } else {
    for (const p of problems) process.stdout.write(`  ✗ ${p}\n`)
    process.exitCode = 1
  }
}

async function stageReview(args: Args): Promise<void> {
  const songs = await loadMeta(args)
  const tables = await loadTables()
  const rows = await buildReview(songs, tables)
  const counts = await writeReview(rows)

  process.stdout.write(`[review] 🔴 高风险 ${counts.high} 首 / 🟡 中风险 ${counts.mid} 首 / 🟢 低风险 ${counts.low} 首\n`)
  process.stdout.write(`[review] 写出 ${path.relative(process.cwd(), REVIEW_MD)}\n`)
  process.stdout.write(`[review]     ${path.relative(process.cwd(), REVIEW_JSON)}\n`)

  const high = rows.filter((r) => r.risk === '高')
  if (high.length > 0) {
    process.stdout.write(`\n[review] 高风险明细（我按 album 改写了演唱者，但缺少「原 artist 是作曲者」的佐证）：\n`)
    for (const r of high) {
      process.stdout.write(`  ${r.title}\n`)
      process.stdout.write(`      文件 artist = ${r.fileArtist}   lrc 作曲/編曲 = ${r.lrcCredits || '（无）'}\n`)
      process.stdout.write(`      我判定为   = ${r.resolvedArtist}   依据 ${r.source}\n`)
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  switch (args.stage) {
    case 'scan':
      await stageScan(args)
      break
    case 'analyze':
      await stageAnalyze(args)
      break
    case 'slice':
      await stageSlice(args)
      break
    case 'covers':
      await stageCovers(args)
      break
    case 'manifest':
      await stageManifest(args)
      break
    case 'audit':
      await serveDevConsole()
      break
    case 'review':
      await stageReview(args)
      break
    case 'preview':
      await previewSoloRound(
        (args.only === 'easy' || args.only === 'hard' ? args.only : 'hard') as 'easy' | 'hard',
        process.argv.includes('--seed') ? (process.argv[process.argv.indexOf('--seed') + 1] ?? 'demo') : 'demo',
      )
      break
    case 'stress':
      await stressSolo()
      break
    case 'all':
      await stageScan(args)
      await stageSlice(args)
      await stageCovers(args)
      await stageManifest(args)
      break
    default:
      console.error(`stage "${args.stage}" 尚未实现`)
      process.exit(2)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
