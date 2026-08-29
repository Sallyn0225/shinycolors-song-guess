import { DIFFICULTY_PRESETS, type Difficulty, type DistractorStrategy } from '@scg/shared'

import { createRng, type Rng } from './rng.js'
import type { SongId } from './types.js'

/** 出题需要知道的曲库信息。neighbours 在构建期算好，运行时 O(1) 取用 */
export interface SoloSong {
  id: SongId
  unit: string | null
  album: string
  confusableGroup: string | null
  neighbours: Array<{ id: SongId; sim: number }>
  sliceCount: number
  /** 每个切片的难度提示 0~1：越高越像副歌（好认），越低越像前奏/间奏（难认） */
  sliceDifficulty?: number[]
}

export interface SoloQuestion {
  index: number
  songId: SongId
  sliceIndex: number
  /** 已打乱的选项（曲目 id）。答案就在其中，但下发给客户端时不带 answerIndex */
  optionIds: SongId[]
}

export interface SoloRound {
  seed: string
  difficulty: Difficulty
  questions: SoloQuestion[]
}

export class SoloError extends Error {}

/**
 * 挑本轮要考的曲子。
 *
 * 易混淆组约束：同组内最多取 1 首。`Migratory Echoes` 有 9 个版本，
 * 两个版本同时出现在一轮里（哪怕不在同一题）也会让玩家困惑。
 */
function pickTargets(songs: readonly SoloSong[], count: number, rng: Rng): SoloSong[] {
  const picked: SoloSong[] = []
  const usedGroups = new Set<string>()
  for (const s of rng.shuffle(songs)) {
    if (picked.length >= count) break
    if (s.confusableGroup) {
      if (usedGroups.has(s.confusableGroup)) continue
      usedGroups.add(s.confusableGroup)
    }
    picked.push(s)
  }
  if (picked.length < count) {
    throw new SoloError(`曲库不足：受易混淆组约束后只能出 ${picked.length} 题，需要 ${count} 题`)
  }
  return picked
}

/** 同一易混淆组内的曲目永远不能互为干扰项——那是「无法靠实力避免的失误」，不是难度 */
function bannedFor(answer: SoloSong, byId: ReadonlyMap<SongId, SoloSong>): Set<SongId> {
  const banned = new Set<SongId>([answer.id])
  if (answer.confusableGroup) {
    for (const [id, s] of byId) {
      if (s.confusableGroup === answer.confusableGroup) banned.add(id)
    }
  }
  return banned
}

/**
 * 选干扰项。
 *
 * 降级链是必需的而不是保险：活动限定组合往往只有 2 首同伴，凑不满 3 个干扰项；
 * 跨组合合同曲的 unit 为 null。所以必须能从 `同 unit` 往下掉到 `同 album` → `相似度` → `随机`。
 */
export function pickDistractors(
  answer: SoloSong,
  all: readonly SoloSong[],
  byId: ReadonlyMap<SongId, SoloSong>,
  strategy: DistractorStrategy,
  count: number,
  rng: Rng,
  /** 本轮各曲目被用作干扰项的次数，用于压低重复 */
  useCount: Map<SongId, number>,
  /**
   * 本轮已经当过答案的曲目。必须排除：曲目不会重复当答案，
   * 所以让旧答案出现在后面的选项里，等于奖励「记账排除」而不是听力。
   */
  usedAsAnswer: ReadonlySet<SongId> = new Set(),
): SoloSong[] {
  const banned = bannedFor(answer, byId)
  for (const id of usedAsAnswer) banned.add(id)
  const recency = (id: SongId): number => 0.5 ** (useCount.get(id) ?? 0)

  const tiers: SoloSong[][] = []

  if (strategy === 'cross-unit') {
    // 简单：刻意避开最像的和同组合的，降低混淆
    const tooClose = new Set(answer.neighbours.slice(0, 8).map((n) => n.id))
    tiers.push(
      all.filter(
        (s) => !banned.has(s.id) && !tooClose.has(s.id) && (!answer.unit || s.unit !== answer.unit),
      ),
    )
  } else {
    // 困难：同组合优先 → 同专辑 → 曲名相似 → 随机
    if (answer.unit) {
      tiers.push(all.filter((s) => !banned.has(s.id) && s.unit === answer.unit))
    }
    if (answer.album) {
      tiers.push(all.filter((s) => !banned.has(s.id) && s.album === answer.album))
    }
    if (strategy === 'same-unit-and-similar-title') {
      tiers.push(
        answer.neighbours
          .slice(0, 12)
          .map((n) => byId.get(n.id))
          .filter((s): s is SoloSong => Boolean(s) && !banned.has(s!.id)),
      )
    }
  }
  // 兜底：全库随机
  tiers.push(all.filter((s) => !banned.has(s.id)))

  const simOf = new Map(answer.neighbours.map((n) => [n.id, n.sim]))
  const out: SoloSong[] = []
  const taken = new Set<SongId>()

  for (const tier of tiers) {
    if (out.length >= count) break
    const pool = tier.filter((s) => !taken.has(s.id))
    if (pool.length === 0) continue
    // sim² 加权：最像的大概率被选中（难度在），但不是必然（多样性在）
    const picks = rng.sampleWeighted(pool, count - out.length, (s) => {
      const sim = simOf.get(s.id) ?? 0.05
      const base = strategy === 'cross-unit' ? 1 : sim * sim + 0.02
      return base * recency(s.id)
    })
    for (const p of picks) {
      out.push(p)
      taken.add(p.id)
    }
  }

  if (out.length < count) {
    throw new SoloError(`无法为「${answer.id}」凑够 ${count} 个干扰项（只找到 ${out.length} 个）`)
  }
  for (const s of out) useCount.set(s.id, (useCount.get(s.id) ?? 0) + 1)
  return out
}

/** 按难度偏好挑切片：简单偏副歌（好认），困难偏前奏/间奏（难认） */
function pickSliceIndex(song: SoloSong, difficulty: Difficulty, rng: Rng): number {
  const n = song.sliceCount
  if (n <= 1) return 0
  const bias = DIFFICULTY_PRESETS[difficulty].slicePosition
  const hints = song.sliceDifficulty
  if (!hints || hints.length !== n || bias === 'mixed') return rng.int(n)

  const idx = Array.from({ length: n }, (_, i) => i)
  const wanted = bias === 'chorus' ? idx.filter((i) => (hints[i] ?? 0.5) >= 0.5) : idx.filter((i) => (hints[i] ?? 0.5) < 0.5)
  return rng.pick(wanted.length > 0 ? wanted : idx)
}

/**
 * 生成一整轮单机题目。
 *
 * 全部在服务端完成：选项打乱后下发，answerIndex 绝不出现在响应里。
 * 干扰项若在前端生成，就等于把正确答案送给了客户端。
 */
export function generateSoloRound(
  songs: readonly SoloSong[],
  difficulty: Difficulty,
  seed: string,
): SoloRound {
  const preset = DIFFICULTY_PRESETS[difficulty]
  const rng = createRng(seed)
  const byId = new Map(songs.map((s) => [s.id, s]))
  const targets = pickTargets(songs, preset.questionCount, rng)
  const useCount = new Map<SongId, number>()
  const usedAsAnswer = new Set<SongId>()

  const questions = targets.map((answer, index): SoloQuestion => {
    const distractors = pickDistractors(
      answer,
      songs,
      byId,
      preset.distractors,
      preset.optionCount - 1,
      rng,
      useCount,
      usedAsAnswer,
    )
    usedAsAnswer.add(answer.id)
    return {
      index,
      songId: answer.id,
      sliceIndex: pickSliceIndex(answer, difficulty, rng),
      optionIds: rng.shuffle([answer.id, ...distractors.map((d) => d.id)]),
    }
  })

  return { seed, difficulty, questions }
}

/** 服务端判分。客户端只提交选了第几个 */
export function gradeAnswer(q: SoloQuestion, choice: number): boolean {
  return q.optionIds[choice] === q.songId
}
