import { ANALYZE, SLICE } from './config.js'
import type { AnalysisResult, ScannedSong } from './types.js'
import { run } from './util/proc.js'
import { win32Long } from './util/paths.js'

const RE_INTEGRATED = /^\s*I:\s*(-?[\d.]+|-inf)\s*LUFS/
const RE_LRA = /^\s*LRA:\s*(-?[\d.]+)\s*LU\s*$/
const RE_PEAK = /^\s*Peak:\s*(-?[\d.]+|-inf)\s*dBFS/
const RE_SILENCE_START = /silence_start:\s*(-?[\d.]+)/
const RE_SILENCE_END = /silence_end:\s*(-?[\d.]+)/

function toNum(s: string): number {
  if (s === '-inf') return -Infinity
  const n = Number(s)
  return Number.isFinite(n) ? n : -Infinity
}

/**
 * 一次 ffmpeg 调用同时拿到响度和静音区间。
 *
 * 两个关键点：
 *
 * 1. **必须在 mono 降混后测量**。输出是 `-ac 1`，而立体声测出的响度与 mono 差 1~1.5 dB
 *    （实测 Lit up my sky：stereo I=-8.7 / mono I=-10.1，true peak +0.47 → +3.2）。
 *    测量链路不匹配输出链路，等于给每首歌加一个随机误差，把归一化的意义抵消掉。
 *
 * 2. **不用 `loudnorm` 的双遍分析**。实测 loudnorm 分析遍 7376ms/首，而 ebur128 只要 ~300-550ms
 *    且给出完全相同的 integrated 值。而且 loudnorm 的 dynamic 模式会做动态压缩，
 *    把安静的前奏推到副歌音量——那会制造「响度提示」，等于泄题。
 */
export async function analyzeSong(song: ScannedSong): Promise<AnalysisResult> {
  let integrated = -Infinity
  let truePeak = -Infinity
  let lra = 0
  const silences: Array<[number, number]> = []
  let pendingStart: number | null = null

  const filter = [
    `aresample=${SLICE.sampleRate}`,
    'aformat=channel_layouts=mono',
    'ebur128=framelog=quiet:peak=true',
    `silencedetect=noise=${ANALYZE.silenceNoiseDb}dB:d=${ANALYZE.silenceMinDurSec}`,
  ].join(',')

  await run(
    'ffmpeg',
    ['-hide_banner', '-nostats', '-i', win32Long(song.mp3Path), '-map', '0:a:0', '-af', filter, '-f', 'null', '-'],
    {
      timeoutMs: 120_000,
      onStderrLine: (line) => {
        const mStart = RE_SILENCE_START.exec(line)
        if (mStart?.[1] !== undefined) {
          pendingStart = Number(mStart[1])
          return
        }
        const mEnd = RE_SILENCE_END.exec(line)
        if (mEnd?.[1] !== undefined) {
          const end = Number(mEnd[1])
          silences.push([pendingStart ?? 0, end])
          pendingStart = null
          return
        }
        const mI = RE_INTEGRATED.exec(line)
        if (mI?.[1] !== undefined) {
          integrated = toNum(mI[1])
          return
        }
        const mLra = RE_LRA.exec(line)
        if (mLra?.[1] !== undefined) {
          lra = Number(mLra[1])
          return
        }
        const mPeak = RE_PEAK.exec(line)
        if (mPeak?.[1] !== undefined) truePeak = toNum(mPeak[1])
      },
    },
  )

  // 静音一直延续到文件末尾时不会有配对的 silence_end
  if (pendingStart !== null) silences.push([pendingStart, song.durationSec])

  if (!Number.isFinite(integrated)) {
    throw new Error(`ebur128 未能测出 integrated loudness：${song.title}`)
  }

  return {
    songId: song.id,
    integratedLufs: integrated,
    truePeakDbfs: Number.isFinite(truePeak) ? truePeak : -99,
    lra,
    silences: silences.sort((a, b) => a[0] - b[0]),
  }
}

/**
 * 计算该曲的归一化增益。
 *
 * 取两项的较小者：
 *  - 达到目标响度所需的增益
 *  - 让真峰不超过 ceiling 所需的增益
 *
 * 实测全库 integrated 在 -10.9~-7.5 LUFS（mono 后更低），true peak 普遍已 > 0 dBFS
 * （削顶母带），所以目标 -16 LUFS 时基本全是衰减，不需要 limiter。
 */
export function gainForTrack(a: AnalysisResult): number {
  const toTarget = SLICE.targetLufs - a.integratedLufs
  const toCeiling = SLICE.ceilingDbfs - a.truePeakDbfs
  return Math.min(toTarget, toCeiling)
}
