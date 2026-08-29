import { SLICE } from './config.js'

export type Interval = readonly [number, number]

export interface PlanConstraints {
  headGuardSec: number
  tailGuardSec: number
  /** 窗口内静音占比上限 */
  maxSilentFrac: number
  /** 窗口内最长连续静音（秒）上限 */
  maxSilentRunSec: number
  /** 起播后这段时间内不允许有静音——必须「从有内容处起播」 */
  headMustBeLoudSec: number
  /**
   * 相邻切片起点的最小间距。
   *
   * 默认 = 切片时长，即**切片之间完全不重叠**。这不是为了美观：出题策略里最关键的一条是
   * 「同一首歌重播时必须换一段」——如果两段重叠 80%，换了等于没换，玩家照样能靠
   * 「这段我听过」推断出是空札，整个空札机制就塌了。降级时最多放宽到 50% 重叠。
   */
  minGapSec: number
}

const BASE: PlanConstraints = {
  headGuardSec: SLICE.headGuardSec,
  tailGuardSec: SLICE.tailGuardSec,
  maxSilentFrac: 0.15,
  maxSilentRunSec: 1.2,
  headMustBeLoudSec: 1.0,
  minGapSec: SLICE.durationSec,
}

/**
 * 降级阶梯。默认约束放不下 6 段时逐级放宽，每级记录 degradeLevel。
 * 降到 >= 3 的曲目需要人工复核（写进 build-warnings.json）。
 */
const LADDER: PlanConstraints[] = [
  BASE,
  // 先放宽静音容忍度，尽量保住「不重叠」
  { ...BASE, maxSilentFrac: 0.3, maxSilentRunSec: 2.0 },
  { ...BASE, maxSilentFrac: 0.3, maxSilentRunSec: 2.0, headGuardSec: 3, tailGuardSec: 1 },
  // 仍放不下才允许重叠，且最多 50%
  { ...BASE, minGapSec: SLICE.durationSec * 0.5, maxSilentFrac: 0.3, maxSilentRunSec: 2.0, headGuardSec: 3, tailGuardSec: 1 },
  {
    ...BASE,
    minGapSec: SLICE.durationSec * 0.5,
    maxSilentFrac: 0.45,
    maxSilentRunSec: 3.0,
    headGuardSec: 3,
    tailGuardSec: 1,
    headMustBeLoudSec: 0.5,
  },
]

/** [a,b) 与 [c,d) 的重叠长度 */
function overlapLen(a: number, b: number, c: number, d: number): number {
  return Math.max(0, Math.min(b, d) - Math.max(a, c))
}

function silentStats(
  start: number,
  end: number,
  silences: readonly Interval[],
): { frac: number; longestRun: number } {
  let total = 0
  let longest = 0
  for (const [s, e] of silences) {
    const ov = overlapLen(start, end, s, e)
    if (ov > 0) {
      total += ov
      if (ov > longest) longest = ov
    }
  }
  const span = end - start
  return { frac: span > 0 ? total / span : 1, longestRun: longest }
}

function isValidStart(start: number, silences: readonly Interval[], c: PlanConstraints): boolean {
  const end = start + SLICE.durationSec
  // 起播头部必须有内容，否则玩家前一秒听到的是空气
  if (silentStats(start, start + c.headMustBeLoudSec, silences).frac > 0) return false
  const { frac, longestRun } = silentStats(start, end, silences)
  return frac <= c.maxSilentFrac && longestRun <= c.maxSilentRunSec
}

export interface PlannedSlice {
  index: number
  startSec: number
}

export interface SlicePlan {
  slices: PlannedSlice[]
  degradeLevel: number
}

function planWith(
  durationSec: number,
  silences: readonly Interval[],
  c: PlanConstraints,
): PlannedSlice[] {
  const lo = c.headGuardSec
  const hi = durationSec - SLICE.durationSec - c.tailGuardSec
  if (hi <= lo) return []

  // 0.5s 步长枚举全部合法起点
  const step = 0.5
  const valid: number[] = []
  for (let t = lo; t <= hi + 1e-9; t += step) {
    const start = Math.round(t * 1000) / 1000
    if (isValidStart(start, silences, c)) valid.push(start)
  }
  if (valid.length === 0) return []

  const chosen: number[] = []
  const out: PlannedSlice[] = []

  // 按比例的分数偏移，而不是固定秒数——时长跨 159~618s，固定偏移会切到短曲的 EOF 之外
  SLICE.fractions.forEach((f, index) => {
    const target = Math.min(Math.max(durationSec * f, lo), hi)
    let best: number | null = null
    let bestDist = Infinity
    for (const v of valid) {
      if (chosen.some((ch) => Math.abs(ch - v) < c.minGapSec)) continue
      const d = Math.abs(v - target)
      if (d < bestDist) {
        bestDist = d
        best = v
      }
    }
    if (best !== null) {
      chosen.push(best)
      out.push({ index, startSec: best })
    }
  })

  return out.sort((a, b) => a.startSec - b.startSec).map((s, i) => ({ index: i, startSec: s.startSec }))
}

/**
 * 为一首歌规划切片位置。
 *
 * 纯函数：只依赖时长和静音区间，不碰 I/O。可以直接单测极端情况
 * （159s 的 キズナシェアリング 和 618s 的 感謝のコントレイル）。
 */
export function planSlices(durationSec: number, silences: readonly Interval[]): SlicePlan {
  for (let level = 0; level < LADDER.length; level++) {
    const slices = planWith(durationSec, silences, LADDER[level] as PlanConstraints)
    if (slices.length >= SLICE.count) {
      return { slices: slices.slice(0, SLICE.count), degradeLevel: level }
    }
  }

  // 最后一级：接受少于 count 段，下限 3
  const last = planWith(durationSec, silences, LADDER[LADDER.length - 1] as PlanConstraints)
  if (last.length >= 3) return { slices: last, degradeLevel: LADDER.length }

  // 实在放不下：无视静音约束，均匀铺开，保证至少有 3 段可用
  const lo = 3
  const hi = Math.max(lo + 1, durationSec - SLICE.durationSec - 1)
  const n = 3
  const fallback: PlannedSlice[] = Array.from({ length: n }, (_, i) => ({
    index: i,
    startSec: Math.round((lo + ((hi - lo) * i) / Math.max(1, n - 1)) * 1000) / 1000,
  }))
  return { slices: fallback, degradeLevel: LADDER.length + 1 }
}
