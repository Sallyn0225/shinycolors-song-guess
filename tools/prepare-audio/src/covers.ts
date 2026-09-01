import fs from 'node:fs/promises'
import path from 'node:path'

import { COVERS, THUMB_DIR } from './config.js'
import type { ScannedSong } from './types.js'
import { run } from './util/proc.js'
import { win32Long } from './util/paths.js'

/**
 * 把封面压成 WebP 一档：160px 的 thumb。
 *
 * 曾有 480px 的 cover 档，但全站没有一处以超过 160px 的尺寸显示过它
 * （单机揭晓槽 56·u、歌牌揭晓 30·u，都不及旁边选项条 58·u 的 thumb），
 * 已随揭晓处改用 /thumb/ 一并删除。
 *
 * 阶段名与文件名保留 `covers` 是为了不破坏既有 CLI（`pnpm assets covers`）与文档；
 * 函数名如实反映「只编一张」。
 *
 * 源图有 3000² 和 1600² 两种尺寸且不保证严格方形，所以用
 * `force_original_aspect_ratio=increase` + `crop` 做等比填充裁切，而不是直接 scale。
 *
 * 封面**绝不在出题时下发**——只在答案揭晓后按 songId 拉取。
 */
async function encodeOne(src: string, dest: string, px: number): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true })
  await run(
    'ffmpeg',
    [
      '-hide_banner',
      '-v', 'error',
      '-i', win32Long(src),
      '-vf', `scale=${px}:${px}:force_original_aspect_ratio=increase,crop=${px}:${px}`,
      '-c:v', 'libwebp',
      '-quality', String(COVERS.quality),
      '-compression_level', '6',
      '-preset', 'picture',
      '-map_metadata', '-1',
      '-fflags', '+bitexact',
      '-y',
      win32Long(dest),
    ],
    { timeoutMs: 60_000 },
  )
}

export function thumbPath(songId: string): string {
  return path.join(THUMB_DIR, `${songId}.webp`)
}

export async function encodeThumb(song: ScannedSong): Promise<void> {
  await encodeOne(song.jpgPath, thumbPath(song.id), COVERS.thumbPx)
}
