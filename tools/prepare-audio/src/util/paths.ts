import path from 'node:path'

/**
 * Windows 长路径前缀。曲库里最深的一条是 403 字符（Summer Night Paradise），
 * 远超 MAX_PATH (260)。
 *
 * 本机 LongPathsEnabled=1，Node v24 和 ffmpeg 实测都能直接处理，所以这是**防御性**的，
 * 不是必须。但换一台没开长路径的机器就会炸，所以保留。
 *
 * 注意 `\\?\` 会关闭路径规范化：正斜杠、`.`/`..` 相对段、结尾的点都会失败，
 * 所以必须先 path.resolve()。
 */
export function win32Long(p: string): string {
  if (process.platform !== 'win32') return p
  const abs = path.resolve(p)
  if (abs.length < 240) return abs
  if (abs.startsWith('\\\\?\\')) return abs
  if (abs.startsWith('\\\\')) return '\\\\?\\UNC\\' + abs.slice(2)
  return '\\\\?\\' + abs
}
