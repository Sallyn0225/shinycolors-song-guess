/**
 * 构建期预压缩。
 *
 * 为什么不靠运行时压缩就够了：`@fastify/compress` 的 brotli 质量是默认的 4 ——
 * 那个默认值是对的，因为它压的是**每一次请求**，在 2C4G 上不能用 11 级。
 * 但前端产物是**不可变的静态文件**，压一次就能用到下次发版，
 * 完全没有理由省这点构建时间。实测同一个 JS：q4 → 101,956 字节，q11 → 86,216。
 *
 * 产物由 `@fastify/static` 的 `preCompressed` 直接伺服（见 server 的 app.ts）：
 * 命中就发 `.br` 并自己带上 `content-encoding: br`，`@fastify/compress` 看到
 * 这个头会跳过（它的 onSend 里 `responseEncoding && !== 'identity'` 那一段）。
 * 找不到 `.br` 则回落到原文件，再由运行时压缩接手 —— 两边都不会漏。
 *
 * **只生成 .br，不生成 .gz。** 不支持 brotli 的客户端如今极少，
 * 它们回落到运行时 gzip 即可；为它们多铺一套构建产物不划算。
 */
import { brotliCompressSync, constants } from 'node:zlib'
import { readFileSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')

/**
 * 只压文本类。
 *
 * `.html` 不在内：index.html 由 app.ts 里的 `sendIndex` 自己发（它要挂
 * `cache-control: no-cache`，不能走 static），`preCompressed` 管不到它。
 * 它只有 3KB，交给运行时压缩即可。
 *
 * 音频、图片、视频一律不压 —— 已经是压缩格式，再压只会变大。
 */
const EXT = new Set(['.js', '.css', '.svg', '.json', '.map'])

/** 小于这个尺寸压了也省不下一个 TCP 包，反而多一个文件 */
const MIN_BYTES = 1024

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* walk(p)
    else yield p
  }
}

let n = 0
let before = 0
let after = 0

for await (const file of walk(DIST)) {
  if (!EXT.has(path.extname(file))) continue
  const raw = readFileSync(file)
  if (raw.length < MIN_BYTES) continue

  const br = brotliCompressSync(raw, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
      [constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
    },
  })

  // 压完反而更大就别写了，留着回落到原文件
  if (br.length >= raw.length) continue

  writeFileSync(`${file}.br`, br)
  n++
  before += raw.length
  after += br.length
}

const saved = before === 0 ? 0 : Math.round(((before - after) / before) * 100)
process.stdout.write(`预压缩 ${n} 个文件：${before} → ${after} 字节（-${saved}%）\n`)

// 一个够格的文件都没有，多半是产物路径变了。静默通过会让预压缩悄悄失效，
// 而症状只是「线上文件比预期大一点」—— 没人会去查
if (n === 0) {
  process.stderr.write(`⚠ 没有任何文件被压缩，检查 ${DIST} 是否为预期的产物目录\n`)
  process.exit(1)
}
