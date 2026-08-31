#!/usr/bin/env node
/**
 * 开场素材流水线。
 *
 * 三件互不相干的事，各自一个子命令，全部**幂等**——产物在就跳过，
 * 所以可以随时重跑，只补缺的那些。产物提交进仓库，与 `assets/` 的既有做法一致。
 *
 *   node tools/prepare-opening.mjs all      # 三件都做
 *   node tools/prepare-opening.mjs brand    # brand/logo.png → public/brand.webp
 *   node tools/prepare-opening.mjs greet    # 28 段 wav  → public/greet/*.opus + *.m4a
 *   node tools/prepare-opening.mjs idol     # 28 张头像  → public/idol/*.webp
 *   加 --force 强制重做。
 *
 * 与曲库切片（tools/prepare-audio）的编码参数有意不同的两处：
 *  - **不做硬 CBR**。那边 `-vbr off` 是为了让所有切片字节数相同，消灭「按文件大小认曲」
 *    的旁路；这里角色名本来就要显示在屏幕上，没有要保护的秘密，VBR 省下的体积更值钱。
 *  - **不清元数据**同理无害，但仍清掉——纯粹是省几百字节。
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const PUBLIC = path.join(REPO, 'apps', 'web', 'public')

/** 与 assets/slices 同一个采样率，省得播放端为开场单独开一条重采样 */
const SAMPLE_RATE = 48_000
/** 语音 48k mono VBR。实测 4~6 秒一段落在 25~40KB */
const GREET_OPUS_KBPS = 48
/** Safari 18.4 以前放不了 Ogg Opus，兜底一份 AAC。64k 让质量与 48k Opus 相当 */
const GREET_AAC_KBPS = 64

/** 品牌标。splash 上最宽约 600 CSS px，2x 屏取 1200 */
const BRAND_WIDTH = 1200
const BRAND_QUALITY = 82

/** 头像源图只有 54×54，**不放大**——放大只会得到一张更大的糊图 */
const IDOL_ICON_BASE = 'https://cf-static.shinycolors.moe/images/content/characters/icon_circle'

/**
 * 罗马音 → 官方角色编号。
 *
 * 编号取自 shinycolors.moe 的 `icon_circle/NNN.png`，001–028 逐张视觉核对过，
 * 029 返回 404，确认曲库外无第 29 人。顺序就是游戏内的组合出场顺序。
 * 中文名与组合归属在 apps/web/src/features/idols.ts，那边才是前端要用的表；
 * 这里只需要「哪个文件名对哪个编号」。
 */
const IDOL_ICON_NO = {
  mano: 1, hiori: 2, meguru: 3,
  kagane: 4, mamimi: 5, sakuya: 6, yuika: 7, kiriko: 8,
  kaho: 9, chiyoko: 10, juri: 11, rinze: 12, natsuha: 13,
  amana: 14, tenka: 15, chiyuki: 16,
  asahi: 17, fuyuko: 18, mei: 19,
  toru: 20, madoka: 21, koito: 22, hinana: 23,
  nichika: 24, mikoto: 25,
  haruki: 26, luca: 27, hana: 28,
}

function run(cmd, args, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    const timer = setTimeout(() => {
      p.kill('SIGKILL')
      reject(new Error(`${cmd} 超时（${timeoutMs}ms）`))
    }, timeoutMs)
    p.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    p.on('close', (code) => {
      clearTimeout(timer)
      code === 0 ? resolve() : reject(new Error(`${cmd} 退出码 ${code}\n${err.slice(-2000)}`))
    })
  })
}

async function exists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

const kb = (n) => `${(n / 1024).toFixed(1)}KB`

async function sizeOf(p) {
  return (await fs.stat(p)).size
}

// ── brand ────────────────────────────────────────────────

/**
 * 品牌标。源是 `brand/logo.png`（1810×708 RGBA，**人工抠的透明底**），
 * 这里只做缩放与转码，不碰 alpha。
 *
 * ── 为什么用人工抠的，而不是从黑底版自动还原 ──
 *
 * `brand/logo-black-bg.png` 是最初拿到的 RGB 无 alpha 黑底图。黑底上的发光图**看起来**
 * 正好是 premultiplied alpha 的形式（纯黑=全透明，越亮越不透明），照这个假设做
 * `alpha = max(R,G,B)` 再 unpremultiply，与逐像素精确计算比对是 alpha 零误差的。
 *
 * **但那个假设对这张图不成立。** logo 的深紫描边是**实体暗色**，不是发光；
 * 自动还原会把它一并判成半透明，结果在白底上描边被冲淡、字母边界发飘、整体没有实体感。
 * 人工抠的版本保住了描边的不透明度 —— 实测两版并排叠在 `--color-ground` 上，
 * 差别一眼可辨（半透明区的平均 RGB 亮度：人工 0.408，自动 0.820，
 * 后者高出来的部分正是被误当成发光而丢掉的暗部）。
 *
 * 顺带一提体积也是人工版赢：它的 alpha 大块是纯 0 或纯 255，
 * 而 libwebp 的 alpha 通道是**无损**编码的（ffmpeg 未暴露 alpha_quality，
 * 机器上也没有 cwebp），自动版那种满屏中间值的 alpha 要 250KB+，
 * 人工版不做任何量化就只有 93KB。所以这里**不量化 alpha**，256 级原样保留。
 *
 * 还试过留着黑底用 `mix-blend-mode: screen` 叠在深紫底板上，**已实测否决**：
 * screen 会把 logo 连同底色一起提亮，整个标志褪成灰白，深紫描边消失、
 * Shiny Song Guess 那行的蓝/粉/橙三色几乎糊成一片。
 */
async function doBrand(force) {
  const src = path.join(REPO, 'brand', 'logo.png')
  const out = path.join(PUBLIC, 'brand.webp')
  if (!force && (await exists(out))) {
    console.log(`[brand] 已存在，跳过（${kb(await sizeOf(out))}）`)
    return
  }
  await fs.mkdir(PUBLIC, { recursive: true })
  await run('ffmpeg', [
    '-hide_banner', '-v', 'error',
    '-i', src,
    // format=rgba 不能省：漏了它 scale 会丢掉 alpha 平面，成品变成黑底
    '-vf', `format=rgba,scale=${BRAND_WIDTH}:-2:flags=lanczos`,
    '-c:v', 'libwebp',
    '-quality', String(BRAND_QUALITY),
    '-compression_level', '6',
    '-y', out,
  ])
  const size = await sizeOf(out)
  console.log(`[brand] brand.webp ${kb(size)}`)
  if (size > 150 * 1024) {
    console.warn(`[brand] 警告：超过 150KB 的首屏预算，考虑调低 BRAND_QUALITY 或 BRAND_WIDTH`)
  }
}

// ── greet ────────────────────────────────────────────────

async function doGreet(force) {
  const srcDir = path.join(REPO, 'opening-greeting')
  const outDir = path.join(PUBLIC, 'greet')
  await fs.mkdir(outDir, { recursive: true })

  const wavs = (await fs.readdir(srcDir)).filter((f) => f.endsWith('.wav')).sort()
  let made = 0
  let skipped = 0

  for (const wav of wavs) {
    const name = path.basename(wav, '.wav')
    const src = path.join(srcDir, wav)
    const opus = path.join(outDir, `${name}.opus`)
    const m4a = path.join(outDir, `${name}.m4a`)

    // 两份缺任何一份就重做这一格 —— 后补 m4a 时才补得上
    if (!force && (await exists(opus)) && (await exists(m4a))) {
      skipped++
      continue
    }

    const common = [
      '-hide_banner', '-v', 'error',
      '-i', src,
      '-map', '0:a:0',
      '-ac', '1',
      '-ar', String(SAMPLE_RATE),
      '-map_metadata', '-1',
      '-fflags', '+bitexact',
    ]

    await run('ffmpeg', [
      ...common,
      '-c:a', 'libopus', '-b:a', `${GREET_OPUS_KBPS}k`, '-application', 'audio',
      '-y', opus,
    ])
    await run('ffmpeg', [
      ...common,
      '-c:a', 'aac', '-b:a', `${GREET_AAC_KBPS}k`,
      // moov 提前：不必等整个文件下完才能开始解码
      '-movflags', '+faststart',
      '-y', m4a,
    ])
    made++
  }

  const sizes = await Promise.all(
    wavs.map((w) => sizeOf(path.join(outDir, `${path.basename(w, '.wav')}.opus`))),
  )
  console.log(
    `[greet] ${wavs.length} 段（新编 ${made}，跳过 ${skipped}）；` +
      `opus ${kb(Math.min(...sizes))}~${kb(Math.max(...sizes))}`,
  )
}

// ── idol ─────────────────────────────────────────────────

/**
 * 头像必须**本地化**，运行时不许再去 cf-static.shinycolors.moe：
 * 第三方 CDN 会把访问者信息泄漏出去、可用性不受我们控制、还白占别人带宽。
 * 与 assets/cover、assets/thumb 的既有做法一致。
 */
async function doIdol(force) {
  const outDir = path.join(PUBLIC, 'idol')
  const tmpDir = path.join(outDir, '.src')
  await fs.mkdir(tmpDir, { recursive: true })

  let made = 0
  let skipped = 0

  for (const [name, no] of Object.entries(IDOL_ICON_NO)) {
    const out = path.join(outDir, `${name}.webp`)
    if (!force && (await exists(out))) {
      skipped++
      continue
    }
    const nnn = String(no).padStart(3, '0')
    const png = path.join(tmpDir, `${nnn}.png`)

    if (!(await exists(png))) {
      const res = await fetch(`${IDOL_ICON_BASE}/${nnn}.png`)
      if (!res.ok) throw new Error(`下载 ${nnn}.png 失败：HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      // 404 页面也是 200 一样能存下来 —— 按体积粗筛一道
      if (buf.length < 512) throw new Error(`${nnn}.png 只有 ${buf.length} 字节，多半不是图片`)
      await fs.writeFile(png, buf)
    }

    // 源图 54×54 RGBA，**不缩放也不放大**，原样转码保住 alpha
    await run('ffmpeg', [
      '-hide_banner', '-v', 'error',
      '-i', png,
      '-c:v', 'libwebp', '-quality', '90', '-compression_level', '6',
      '-y', out,
    ])
    made++
  }

  // 中间 PNG 不进仓库，转完就删
  await fs.rm(tmpDir, { recursive: true, force: true })

  const total = (
    await Promise.all(Object.keys(IDOL_ICON_NO).map((n) => sizeOf(path.join(outDir, `${n}.webp`))))
  ).reduce((a, b) => a + b, 0)
  console.log(`[idol] 28 张（新做 ${made}，跳过 ${skipped}）；合计 ${kb(total)}`)
}

// ── main ─────────────────────────────────────────────────

const argv = process.argv.slice(2)
const force = argv.includes('--force')
const cmd = argv.find((a) => !a.startsWith('--')) ?? 'all'

const TASKS = { brand: doBrand, greet: doGreet, idol: doIdol }

if (cmd !== 'all' && !TASKS[cmd]) {
  console.error(`未知子命令 ${cmd}；可用：all / ${Object.keys(TASKS).join(' / ')}`)
  process.exit(1)
}

for (const [name, fn] of Object.entries(TASKS)) {
  if (cmd === 'all' || cmd === name) await fn(force)
}
