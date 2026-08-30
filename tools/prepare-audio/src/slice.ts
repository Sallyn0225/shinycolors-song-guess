import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

import { SLICE, SLICES_DIR } from './config.js'
import type { AnalysisResult, ScannedSong, SliceSpec } from './types.js'
import { gainForTrack } from './analyze.js'
import { planSlices } from './planSlices.js'
import { run } from './util/proc.js'
import { win32Long } from './util/paths.js'

/** Crockford base32（去掉 I/L/O/U，避免歧义） */
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/**
 * 生成 20 字符（约 100 bit）的随机切片 id。
 *
 * 用 CSPRNG 随机串而不是 `HMAC(secret, songId:index)`：
 *  - 随机方案没有密钥可泄露（HMAC 一旦泄密钥，1404 个 id 全可离线重算）
 *  - **轮换只是一次 rename**：重生成 id + fs.rename + 改 manifest，秒级完成，
 *    不需要重新编码。这让「定期换 id 打断攻击者积累的对照表」真正可行。
 */
export function newSliceId(): string {
  // 每个字符独立取一个随机字节。256 能被 32 整除，所以 %32 无模偏。
  const bytes = randomBytes(20)
  let out = ''
  for (let i = 0; i < 20; i++) out += B32[(bytes[i] as number) % 32]
  return out
}

export function slicePath(sliceId: string): string {
  // 分 256 个子目录：避免单目录 1400+ 文件，且目录列举不暴露任何分组
  return path.join(SLICES_DIR, sliceId.slice(0, 2), `${sliceId}.opus`)
}

/** AAC 兜底副本，与 opus 同名同目录，只差扩展名 */
export function aacPath(sliceId: string): string {
  return path.join(SLICES_DIR, sliceId.slice(0, 2), `${sliceId}.m4a`)
}

/** 由分析结果 + 时长规划出该曲的全部切片规格（不含编码） */
export function specsFor(song: ScannedSong, analysis: AnalysisResult, existingIds?: string[]): SliceSpec[] {
  const plan = planSlices(song.durationSec, analysis.silences)
  const gainDb = gainForTrack(analysis)
  return plan.slices.map((s, i) => ({
    // 复用已有 id：重跑构建不会让 URL 无谓变动（真要轮换走 --rotate-ids）
    sliceId: existingIds?.[i] ?? newSliceId(),
    index: i,
    startSec: s.startSec,
    durationSec: SLICE.durationSec,
    gainDb,
    degradeLevel: plan.degradeLevel,
  }))
}

/**
 * 编码单个切片。
 *
 * 几条不能省的参数：
 *  - `-ss` 放 `-i` 前 → 输入 seek，快 2 倍以上。`-accurate_seek` 默认开启，所以是采样精确的。
 *    用 `-t`（相对时长）而不是 `-to`（输入 seek 后语义会变）。
 *  - `-map 0:a:0` → 全部 234 个 mp3 都内嵌了 mjpeg 封面流，不 map 会出错。
 *  - `-map_metadata -1 -fflags +bitexact` → **否则 ffmpeg 会把源 ID3 的 title/artist
 *    原样复制进 Opus 的 Vorbis comment，等于把答案直接写进切片文件**。
 *  - `-vbr off`（硬 CBR）→ 所有切片字节数几乎相同，消灭「按文件大小认曲」的旁路。
 *    代价是复杂段落质量略逊，故码率取 80k 而非 64k。
 */
function filterFor(spec: SliceSpec): string {
  const fadeOutStart = (spec.durationSec - SLICE.fadeOutSec).toFixed(3)
  return [
    `volume=${spec.gainDb.toFixed(2)}dB`,
    `afade=t=in:st=0:d=${SLICE.fadeInSec}`,
    `afade=t=out:st=${fadeOutStart}:d=${SLICE.fadeOutSec}`,
  ].join(',')
}

export async function encodeSlice(song: ScannedSong, spec: SliceSpec): Promise<string> {
  const out = slicePath(spec.sliceId)
  await fs.mkdir(path.dirname(out), { recursive: true })

  const filter = filterFor(spec)

  await run(
    'ffmpeg',
    [
      '-hide_banner',
      '-v', 'error',
      '-ss', spec.startSec.toFixed(3),
      '-t', String(spec.durationSec),
      '-i', win32Long(song.mp3Path),
      '-map', '0:a:0',
      '-af', filter,
      '-ac', '1',
      '-ar', String(SLICE.sampleRate),
      '-c:a', 'libopus',
      '-b:a', `${SLICE.bitrateKbps}k`,
      '-vbr', 'off',
      '-application', 'audio',
      '-map_metadata', '-1',
      '-fflags', '+bitexact',
      '-y',
      win32Long(out),
    ],
    { timeoutMs: 60_000 },
  )

  return out
}

/**
 * 编码 AAC 兜底副本。
 *
 * 参数与 opus 那份保持一致（同一段、同增益、同淡入淡出、同样清元数据），
 * 唯一的不同是 aac 编码器**给不了硬 CBR**——所以编完还要 `padAac` 把字节数补齐，
 * 否则文件大小就是曲目指纹，等于把 `-vbr off` 挡掉的旁路又开回来。
 */
export async function encodeSliceAac(song: ScannedSong, spec: SliceSpec): Promise<string> {
  const out = aacPath(spec.sliceId)
  await fs.mkdir(path.dirname(out), { recursive: true })

  await run(
    'ffmpeg',
    [
      '-hide_banner',
      '-v', 'error',
      '-ss', spec.startSec.toFixed(3),
      '-t', String(spec.durationSec),
      '-i', win32Long(song.mp3Path),
      '-map', '0:a:0',
      '-af', filterFor(spec),
      '-ac', '1',
      '-ar', String(SLICE.sampleRate),
      '-c:a', 'aac',
      '-b:a', `${SLICE.aacBitrateKbps}k`,
      '-map_metadata', '-1',
      '-fflags', '+bitexact',
      // moov 提前：客户端不必等整个文件下完才能开始解码
      '-movflags', '+faststart',
      '-y',
      win32Long(out),
    ],
    { timeoutMs: 60_000 },
  )

  await padAac(out)
  return out
}

/**
 * 在文件尾追加一个 `free` box，把体积补到 `SLICE.aacPadToBytes`。
 *
 * `free` 在 MP4 规范里就是「这段没内容，跳过」，追加在 moov/mdat 之后不影响任何解码器
 * （已实测 ffmpeg 解出来仍是 15.000s）。box 头本身占 8 字节，所以目标值必须比最大文件大至少 8。
 */
export async function padAac(file: string): Promise<void> {
  const size = (await fs.stat(file)).size
  const pad = SLICE.aacPadToBytes - size
  if (pad === 0) return
  if (pad < 8) {
    throw new Error(
      `AAC 切片 ${path.basename(file)} 有 ${size} 字节，超过 SLICE.aacPadToBytes=${SLICE.aacPadToBytes}；` +
        `请调大该常量后重跑（字节数不统一会泄漏曲目身份）`,
    )
  }
  const box = Buffer.alloc(pad)
  box.writeUInt32BE(pad, 0)
  box.write('free', 4, 'ascii')
  await fs.appendFile(file, box)
}
