import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'

const here = path.dirname(fileURLToPath(import.meta.url))

/** 仓库根目录（tools/prepare-audio/src → ../../..） */
export const REPO_ROOT = path.resolve(here, '..', '..', '..')

export const SONGS_ROOT = path.join(REPO_ROOT, 'songs')
export const ASSETS_ROOT = path.join(REPO_ROOT, 'assets')
export const DATA_DIR = path.resolve(here, '..', 'data')

export const CACHE_DIR = path.join(ASSETS_ROOT, '.cache')
export const SLICES_DIR = path.join(ASSETS_ROOT, 'slices')
export const THUMB_DIR = path.join(ASSETS_ROOT, 'thumb')
export const COVER_DIR = path.join(ASSETS_ROOT, 'cover')

/** 每个 stage 独立版本号：改了某个 stage 的算法只 bump 它，不会导致全量重跑 */
export const STAGE_VERSIONS = {
  scan: 1,
  analyze: 1,
  slice: 1,
  covers: 1,
} as const

export const SLICE = {
  /** 切片时长（秒）。固定 15s——难度靠播放端截断，文件本身不携带难度信息（防作弊） */
  durationSec: 15,
  /** 每首歌切几段 */
  count: 6,
  /** 按时长比例的分数偏移。时长跨 159~618s，固定秒数偏移会切到短曲的 EOF 之外 */
  fractions: [0.12, 0.25, 0.38, 0.52, 0.66, 0.8],
  /** 跳过开头（前奏淡入、count-in） */
  headGuardSec: 10,
  /** 跳过结尾（尾奏淡出）。= 切片时长 + 余量 */
  tailGuardSec: 3,
  /** 目标响度 */
  targetLufs: -16,
  /** 输出真峰上限，配合 targetLufs 取 min 得最终增益 */
  ceilingDbfs: -1,
  bitrateKbps: 80,
  sampleRate: 48000,
  fadeInSec: 0.02,
  fadeOutSec: 0.06,

  // ── AAC 兜底（--with-aac-fallback）─────────────────────
  // Safari 18.4（2025-03）以前 Ogg 和 WebM 容器的 Opus 都放不了，选哪个都救不了老版本，
  // 所以老 Safari 只能靠一份 AAC 副本。默认不生成：多花 30% 构建时间和一倍体积。
  /** ffmpeg 的原生 aac 编码器没有真正的 CBR，码率取 96k 让质量与 80k Opus 相当 */
  aacBitrateKbps: 96,
  /**
   * 每个 m4a 补 `free` box 补到这个字节数，全部一样大。
   *
   * **不能省**：实测 15 秒 96k 的 aac 文件在 184~198KB 之间浮动，
   * 1404 个切片的字节数几乎就是唯一指纹 —— 和 Opus 用 `-vbr off` 消灭的是同一条旁路，
   * 只是 aac 编码器给不了硬 CBR，只能事后补齐。
   * `free` 是 MP4 规范里明确可跳过的 box，追加在文件尾不影响任何解码器。
   * 取值要留出余量；超了会在自检里报出来，届时调大这个常量重跑即可。
   */
  aacPadToBytes: 208_000,
} as const

export const ANALYZE = {
  silenceNoiseDb: -45,
  silenceMinDurSec: 0.5,
} as const

export const COVERS = {
  thumbPx: 160,
  coverPx: 480,
  quality: 80,
} as const

/** 实测 8→16 并发只快 8%（瓶颈在内存带宽/IO 而非 CPU），取 12 留余量给系统 */
export function defaultConcurrency(): number {
  const cores = os.availableParallelism?.() ?? os.cpus().length
  return Math.max(2, Math.min(cores, 12))
}

/** 构建产物统一的 mtime。防止「构建顺序 = 曲名字典序」经 mtime 泄漏出去 */
export const CANONICAL_MTIME = new Date('2020-01-01T00:00:00Z')
