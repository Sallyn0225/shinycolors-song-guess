import type { KarutaConfig, SongRef } from './types.js'

/** 造一个足够大的假曲库，可选注入易混淆组 */
export function makeSongs(n: number, groups: Record<number, string> = {}): SongRef[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    confusableGroup: groups[i] ?? null,
    sliceCount: 6,
  }))
}

export const TEST_CONFIG: KarutaConfig = {
  poolSize: 30,
  fieldCards: 24,
  karafuda: 6,
  tieEpsilonMs: 25,
  minHumanReactionMs: 150,
  windowMs: 8000,
}
