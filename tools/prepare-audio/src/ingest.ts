import fs from 'node:fs/promises'
import path from 'node:path'

import { DATA_DIR } from './config.js'
import { memberOf, type UnitTables } from './resolveUnit.js'
import { Progress } from './util/cache.js'
import { probe } from './util/ffprobe.js'
import { win32Long } from './util/paths.js'
import { mapConcurrent, run } from './util/proc.js'

/**
 * 素材准入：把暂存区的音源规范化成 `songs/` 认的形状。
 *
 * 为什么有这一层：`scan()` 的输入契约是「每个曲目目录恰好 1 个 mp3 + 1 个 jpg，
 * 且 mp3 有 ID3 title」。而新素材往往是**没有任何标签的 WAV**（这一批 29 个文件
 * 的 format.tags 与 stream.tags 全空），曲名 / 演唱者 / 专辑只存在于文件名与人脑里。
 * 与其放宽 scan 去接受第二种音源格式（会把 srcSize 的语义、格式分支、文档全搅一遍），
 * 不如在这里一次性把素材规范成和曲库既有曲目**完全同形**的东西。
 *
 * 分工：
 *  - 人判断的东西（曲名 / 演唱者 / 专辑 / 封面）写在 `data/ingest.json`；
 *  - 机械的东西（转码参数、目录与文件名、ID3 写入、完整性校验）归这里；
 *  - 「这素材是不是真的没人声」机器判不了，也不在本模块职责内（见 pipeline spec）。
 *
 * 这个 stage **不进 `all`**：`all` 的语义是 `songs/` → `assets/`，而本模块的产物是
 * `songs/` 本身，属于人工把关的准入步骤。
 */

const OFF_VOCAL_SUFFIX = ' (Off Vocal)'
const MP3_BITRATE = '320k'
const MP3_SAMPLE_RATE = 44_100
/** 转码不应改变时长；给编码器补帧留的余量 */
const DURATION_TOLERANCE_SEC = 0.2

export interface IngestTrackSpec {
  /** 源目录下的相对路径（`/` 分隔） */
  file: string
  /** 规范曲名，不带 ` (Off Vocal)` 后缀 */
  title: string
  /** `albums` 的 key */
  album: string
  /** 单人曲：角色名（与 units.json 的写法一致，比对前会归一化） */
  character?: string
  /** 合同曲：角色名数组，顺序即署名顺序 */
  performers?: string[]
  /** 源目录下的封面 jpg 相对路径 */
  cover: string
}

export interface IngestBatchSpec {
  id: string
  /** 暂存区目录，仓库根相对 */
  sourceDir: string
  /** 产物落到 `songs/` 下哪个 Page 目录 */
  page: string
  /** key → 官方专辑名，写进 ID3 album */
  albums: Record<string, string>
  tracks: IngestTrackSpec[]
}

interface IngestFile {
  batches?: IngestBatchSpec[]
  [key: string]: unknown
}

/** 一条规划好的转码任务（未执行） */
export interface IngestJob {
  title: string
  /** ID3 artist：`角色名 (CV.声優名)`，多人用 `/` 连接 */
  artist: string
  album: string
  srcWav: string
  srcCover: string
  outDir: string
  outMp3: string
  outJpg: string
}

export interface IngestPlan {
  jobs: IngestJob[]
  problems: string[]
}

export async function loadIngestBatches(): Promise<IngestBatchSpec[]> {
  const raw = await fs.readFile(path.join(DATA_DIR, 'ingest.json'), 'utf8')
  return (JSON.parse(raw) as IngestFile).batches ?? []
}

/** 递归列出源目录下的全部文件，返回 `/` 分隔的相对路径 */
export async function listSourceFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  async function walk(cur: string, prefix: string): Promise<void> {
    const entries = await fs.readdir(win32Long(cur), { withFileTypes: true })
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      if (e.isDirectory()) await walk(path.join(cur, e.name), rel)
      else out.push(rel)
    }
  }
  await walk(dir, '')
  return out.sort()
}

/**
 * 批次表 → 转码任务清单。纯函数（文件清单由调用方传入），所以六条校验都能单测。
 *
 * 最重要的一条是「源目录里有未列入的 wav」：漏掉一首曲子不会以任何方式显形，
 * 曲库只会静默少一首，而没人会去数 272 和 271 的差别。宁可拒绝执行。
 */
export function planIngest(opts: {
  batch: IngestBatchSpec
  tables: UnitTables
  /** 源目录下的全部文件（`/` 分隔相对路径） */
  files: string[]
  repoRoot: string
  songsRoot: string
}): IngestPlan {
  const { batch, tables, files, repoRoot, songsRoot } = opts
  const present = new Set(files)
  const problems: string[] = []
  const jobs: IngestJob[] = []
  const claimed = new Set<string>()
  const titleOwner = new Map<string, string>()
  const dirOwner = new Map<string, string>()

  for (const [i, t] of batch.tracks.entries()) {
    const where = `${batch.id}#${i + 1} ${t.title ?? '(无曲名)'}`
    const trackProblems: string[] = []

    if (!t.file || !present.has(t.file)) {
      trackProblems.push(`找不到源文件『${t.file}』`)
    } else {
      claimed.add(t.file)
    }
    if (!t.cover || !present.has(t.cover)) trackProblems.push(`找不到封面『${t.cover}』`)

    const hasCharacter = typeof t.character === 'string' && t.character.length > 0
    const performers = Array.isArray(t.performers) ? t.performers : []
    if (hasCharacter === (performers.length > 0)) {
      trackProblems.push('character 与 performers 必须二选一（不能都空或都写）')
    }

    const characters = hasCharacter ? [t.character as string] : performers
    const credits: string[] = []
    for (const c of characters) {
      const member = memberOf(tables, c)
      if (!member) trackProblems.push(`角色名『${c}』不在 units.json 里（拼写要与人名表一致）`)
      else credits.push(`${member.character} (CV.${member.cv})`)
    }

    const album = batch.albums[t.album]
    if (!album) trackProblems.push(`album key『${t.album}』不在 batch.albums 里`)

    if (!t.title) trackProblems.push('缺少曲名')
    else if (/\(Off Vocal\)/i.test(t.title)) trackProblems.push('曲名里不要带 (Off Vocal) 后缀，转码时会自动加')

    const prevTitle = t.title ? titleOwner.get(t.title) : undefined
    if (prevTitle) trackProblems.push(`曲名与 ${prevTitle} 重复`)
    else if (t.title) titleOwner.set(t.title, where)

    if (trackProblems.length > 0) {
      problems.push(...trackProblems.map((p) => `${where}: ${p}`))
      continue
    }

    // 署名里的 `/` 是 ID3 的多人分隔符，落到目录名要换成 `_`（现役目录同规则）
    const artist = credits.join('/')
    const stem = `${t.title}${OFF_VOCAL_SUFFIX} - ${artist.replace(/\//g, '_')}`
    const outDir = path.join(songsRoot, batch.page, stem)

    const prevDir = dirOwner.get(outDir)
    if (prevDir) {
      problems.push(`${where}: 输出目录与 ${prevDir} 重复`)
      continue
    }
    dirOwner.set(outDir, where)

    jobs.push({
      title: t.title as string,
      artist,
      album: album as string,
      srcWav: path.join(repoRoot, batch.sourceDir, t.file),
      srcCover: path.join(repoRoot, batch.sourceDir, t.cover),
      outDir,
      outMp3: path.join(outDir, `${stem}.mp3`),
      outJpg: path.join(outDir, `${stem}.jpg`),
    })
  }

  const unlisted = files.filter((f) => f.toLowerCase().endsWith('.wav') && !claimed.has(f))
  if (unlisted.length > 0) {
    problems.push(
      `源目录里有 ${unlisted.length} 个未列入的 wav（漏一首 = 曲库静默少一首）：\n` +
        unlisted.map((f) => `    ${f}`).join('\n'),
    )
  }

  return { jobs, problems }
}

export interface IngestRunResult {
  encoded: number
  skipped: number
  failures: string[]
}

async function fileExists(p: string): Promise<boolean> {
  return fs
    .stat(p)
    .then((s) => s.size > 0)
    .catch(() => false)
}

/**
 * 转码一条任务：WAV + 封面 jpg → mp3（ID3v2.3）+ 同名 jpg。
 *
 * 参数与曲库既有曲目对齐：320kbps CBR / 44.1kHz / stereo / 内嵌 mjpeg 封面流。
 * 封面流不是为了好看——`slice.ts` 的 `-map 0:a:0` 正是为了跳过它才写的，保持同形能让
 * 「所有 mp3 的流布局一致」这条隐含前提继续成立；`covers` stage 用的是旁边的 jpg，
 * 与内嵌封面无关。
 */
export async function encodeIngestJob(job: IngestJob): Promise<void> {
  await fs.mkdir(path.dirname(win32Long(job.outMp3)), { recursive: true })

  const src = await probe(job.srcWav)

  await run(
    'ffmpeg',
    [
      '-hide_banner',
      '-v',
      'error',
      '-i',
      win32Long(job.srcWav),
      '-i',
      win32Long(job.srcCover),
      '-map',
      '0:a:0',
      '-map',
      '1:v:0',
      '-c:a',
      'libmp3lame',
      '-b:a',
      MP3_BITRATE,
      '-ar',
      String(MP3_SAMPLE_RATE),
      '-ac',
      '2',
      '-c:v',
      'copy',
      '-disposition:v:0',
      'attached_pic',
      '-metadata:s:v',
      'title=Cover',
      '-metadata:s:v',
      'comment=Cover (front)',
      '-id3v2_version',
      '3',
      '-write_id3v1',
      '0',
      '-metadata',
      `title=${job.title}${OFF_VOCAL_SUFFIX}`,
      '-metadata',
      `artist=${job.artist}`,
      '-metadata',
      `album=${job.album}`,
      '-y',
      win32Long(job.outMp3),
    ],
    { timeoutMs: 120_000 },
  )

  await fs.copyFile(win32Long(job.srcCover), win32Long(job.outJpg))

  // 回读校验：写进去的标签 / 时长 / 封面流必须和我以为的一致。
  // 「标签没写进去」这类故障在 pipeline 里完全不显形，只有这里能抓。
  const out = await probe(job.outMp3)
  const expectTitle = `${job.title}${OFF_VOCAL_SUFFIX}`
  const wrong =
    out.tags['title'] !== expectTitle
      ? `title 期望 ${expectTitle}，实际 ${out.tags['title'] ?? '(空)'}`
      : out.tags['artist'] !== job.artist
        ? `artist 期望 ${job.artist}，实际 ${out.tags['artist'] ?? '(空)'}`
        : out.tags['album'] !== job.album
          ? `album 期望 ${job.album}，实际 ${out.tags['album'] ?? '(空)'}`
          : undefined
  if (wrong) throw new Error(`${job.title}: ${wrong}`)
  if (!out.streams.some((s) => s.codec_type === 'video')) {
    throw new Error(`${job.title}: 产物里没有内嵌封面流`)
  }
  const drift = Math.abs(out.durationSec - src.durationSec)
  if (drift > DURATION_TOLERANCE_SEC) {
    throw new Error(
      `${job.title}: 时长 ${out.durationSec.toFixed(2)}s 与源 ${src.durationSec.toFixed(2)}s 差 ${drift.toFixed(2)}s`,
    )
  }
}

/** 执行全部任务。默认幂等：产物已存在就跳过（`--force` 重转）。 */
export async function runIngest(
  jobs: IngestJob[],
  opts: { concurrency: number; force: boolean },
): Promise<IngestRunResult> {
  const bar = new Progress('ingest', jobs.length)
  const failures: string[] = []
  let encoded = 0
  let skipped = 0

  await mapConcurrent(jobs, opts.concurrency, async (job) => {
    try {
      if (!opts.force && (await fileExists(job.outMp3)) && (await fileExists(job.outJpg))) {
        skipped++
        bar.tick(`⟨已存在 ${job.title}⟩`)
        return
      }
      await encodeIngestJob(job)
      encoded++
      bar.tick(`⟨${job.title}⟩`)
    } catch (err) {
      failures.push(`${job.title}: ${String(err)}`)
      bar.tick(`⟨失败 ${job.title}⟩`, false)
    }
  })

  bar.finish()
  return { encoded, skipped, failures }
}
