/**
 * 确定性随机数。
 *
 * 每局用一个 seed 并存档，这样任何 bug 都能从 seed 精确复现，
 * 也让整局对战可以写成确定性单测。
 */
export interface Rng {
  /** [0, 1) */
  next(): number
  /** [0, n) 的整数 */
  int(n: number): number
  pick<T>(arr: readonly T[]): T
  shuffle<T>(arr: readonly T[]): T[]
  /** 按权重抽样，不放回 */
  sampleWeighted<T>(arr: readonly T[], k: number, weight: (item: T) => number): T[]
}

/** 字符串 → 32 位种子（xmur3） */
function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return (h ^= h >>> 16) >>> 0
}

export function createRng(seed: string): Rng {
  let a = hashSeed(seed)

  // mulberry32
  const next = (): number => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const int = (n: number): number => Math.floor(next() * n)

  return {
    next,
    int,
    pick<T>(arr: readonly T[]): T {
      if (arr.length === 0) throw new Error('pick: 空数组')
      return arr[int(arr.length)] as T
    },
    shuffle<T>(arr: readonly T[]): T[] {
      const out = [...arr]
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(i + 1)
        ;[out[i], out[j]] = [out[j] as T, out[i] as T]
      }
      return out
    },
    sampleWeighted<T>(arr: readonly T[], k: number, weight: (item: T) => number): T[] {
      const pool = [...arr]
      const out: T[] = []
      while (out.length < k && pool.length > 0) {
        const weights = pool.map((x) => Math.max(0, weight(x)))
        const total = weights.reduce((s, w) => s + w, 0)
        if (total <= 0) {
          out.push(pool.splice(int(pool.length), 1)[0] as T)
          continue
        }
        let r = next() * total
        let idx = 0
        for (; idx < weights.length; idx++) {
          r -= weights[idx] as number
          if (r <= 0) break
        }
        out.push(pool.splice(Math.min(idx, pool.length - 1), 1)[0] as T)
      }
      return out
    },
  }
}
