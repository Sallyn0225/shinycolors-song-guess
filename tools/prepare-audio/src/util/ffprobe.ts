import { runCapture } from './proc.js'
import { win32Long } from './paths.js'

export interface ProbeResult {
  durationSec: number
  bitRate: number | null
  sizeBytes: number
  tags: Record<string, string>
  streams: Array<{ codec_type?: string; codec_name?: string; channels?: number; sample_rate?: string }>
}

/**
 * 一次 ffprobe 拿齐 ID3 tag + 时长 + 流布局。
 *
 * 元数据一律以 ID3 为准，不解析目录名——目录名里有两个曲名被文件系统净化过
 * （`Tokyo自由系*ガール` → `_`，`1/3` → `1_3`），ID3 能无损还原。
 */
export async function probe(filePath: string): Promise<ProbeResult> {
  const json = await runCapture('ffprobe', [
    '-v',
    'error',
    '-of',
    'json',
    '-show_entries',
    'format=duration,bit_rate,size:format_tags:stream=index,codec_type,codec_name,channels,sample_rate',
    '--',
    win32Long(filePath),
  ])

  const parsed = JSON.parse(json) as {
    format?: { duration?: string; bit_rate?: string; size?: string; tags?: Record<string, string> }
    streams?: ProbeResult['streams']
  }

  const rawTags = parsed.format?.tags ?? {}
  // ffprobe 的 tag key 大小写不稳定，统一小写
  const tags: Record<string, string> = {}
  for (const [k, v] of Object.entries(rawTags)) tags[k.toLowerCase()] = v

  return {
    durationSec: Number(parsed.format?.duration ?? 0),
    bitRate: parsed.format?.bit_rate ? Number(parsed.format.bit_rate) : null,
    sizeBytes: Number(parsed.format?.size ?? 0),
    tags,
    streams: parsed.streams ?? [],
  }
}
