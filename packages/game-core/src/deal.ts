import { createRng } from './rng.js'
import type { Card, CardId, KarutaConfig, MatchState, PlayerId, SongRef } from './types.js'

export class DealError extends Error {}

/**
 * 从曲库抽出本局用的曲子。
 *
 * **易混淆组约束**：同一个 confusableGroup 内最多取 1 首。
 * `Migratory Echoes` 有 9 个版本，去人声后几乎无法区分——同时出现在牌场上就会造成
 * 「无法靠实力避免的失误」，那是缺陷不是难度。
 */
export function selectPool(songs: readonly SongRef[], count: number, seed: string): SongRef[] {
  const rng = createRng(`${seed}:pool`)
  const shuffled = rng.shuffle(songs)
  const picked: SongRef[] = []
  const usedGroups = new Set<string>()

  for (const s of shuffled) {
    if (picked.length >= count) break
    if (s.confusableGroup) {
      if (usedGroups.has(s.confusableGroup)) continue
      usedGroups.add(s.confusableGroup)
    }
    picked.push(s)
  }

  if (picked.length < count) {
    throw new DealError(
      `曲库不足：受易混淆组约束后只能抽出 ${picked.length} 首，需要 ${count} 首`,
    )
  }
  return picked
}

export interface DealResult {
  state: MatchState
  /** 本局全部曲子（场上札 + 空札），供上层查曲名/切片 */
  pool: SongRef[]
}

export function dealMatch(
  songs: readonly SongRef[],
  seed: string,
  config: KarutaConfig,
): DealResult {
  if (config.fieldCards % 2 !== 0) {
    throw new DealError(`fieldCards 必须是偶数（每人一半），当前 ${config.fieldCards}`)
  }
  if (config.fieldCards + config.karafuda !== config.poolSize) {
    throw new DealError(
      `poolSize(${config.poolSize}) 必须等于 fieldCards(${config.fieldCards}) + karafuda(${config.karafuda})`,
    )
  }

  const pool = selectPool(songs, config.poolSize, seed)
  const rng = createRng(`${seed}:deal`)
  const shuffled = rng.shuffle(pool)

  const fieldSongs = shuffled.slice(0, config.fieldCards)
  const karafuda = shuffled.slice(config.fieldCards).map((s) => s.id)

  const half = config.fieldCards / 2
  const cards: Record<CardId, Card> = {}
  const layout: Record<PlayerId, CardId[]> = { A: [], B: [] }

  fieldSongs.forEach((song, i) => {
    const owner: PlayerId = i < half ? 'A' : 'B'
    const id = `c${i}`
    cards[id] = { id, songId: song.id, owner }
    layout[owner].push(id)
  })

  return {
    state: {
      seed,
      phase: 'memorize',
      roundNo: 0,
      cards,
      layout,
      karafuda,
      usedSlices: {},
      retired: [],
      history: [],
      winner: null,
    },
    pool,
  }
}

/** 玩家在记忆阶段重排自陣。只允许是自陣现有牌的一个排列 */
export function applyLayout(state: MatchState, player: PlayerId, order: readonly CardId[]): MatchState {
  const own = state.layout[player]
  const sameSet =
    order.length === own.length && new Set(order).size === own.length && order.every((id) => own.includes(id))
  if (!sameSet) {
    throw new DealError('布局无效：必须是自陣现有牌的一个排列')
  }
  return { ...state, layout: { ...state.layout, [player]: [...order] } }
}

export function cardsLeft(state: MatchState): Record<PlayerId, number> {
  return {
    A: state.layout.A.length,
    B: state.layout.B.length,
  }
}
