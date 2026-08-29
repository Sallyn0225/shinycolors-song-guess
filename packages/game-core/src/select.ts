import { createRng } from './rng.js'
import type { MatchState, Reading, SongId, SongRef } from './types.js'

/** 场上还有牌的曲子（牌被取走的已退役，避免死回合） */
export function liveFieldSongs(state: MatchState): SongId[] {
  const alive = new Set<SongId>()
  for (const card of Object.values(state.cards)) {
    if (card.owner !== null) alive.add(card.songId)
  }
  return [...alive]
}

function trailingKarafudaRun(state: MatchState): number {
  let n = 0
  for (let i = state.history.length - 1; i >= 0; i--) {
    if (state.history[i]?.reading.kind === 'karafuda') n++
    else break
  }
  return n
}

function timesPlayed(state: MatchState, songId: SongId): number {
  return state.history.filter((h) => h.reading.songId === songId).length
}

/**
 * 选下一段要播的切片。
 *
 * **这是整个出题逻辑里最关键的一条规则：同一首歌重播时必须换一个切片。**
 *
 * 6 首空札要覆盖 15~25 个回合，必然重复。如果重复的空札放同一段音频，玩家会学会
 * 「这段我听过 → 是空札 → 别点」，整个空札机制当场塌掉，变成免费通行证。
 * 场上曲被重读时同理。
 *
 * 切片用尽后取最久未用的那段（usedSlices 按使用顺序排列，队首即最久）。
 */
export function pickSlice(state: MatchState, song: SongRef): { sliceIndex: number; usedSlices: number[] } {
  const used = state.usedSlices[song.id] ?? []
  const all = Array.from({ length: song.sliceCount }, (_, i) => i)
  const unused = all.filter((i) => !used.includes(i))

  if (unused.length > 0) {
    const rng = createRng(`${state.seed}:slice:${song.id}:${used.length}`)
    const idx = rng.pick(unused)
    return { sliceIndex: idx, usedSlices: [...used, idx] }
  }

  // 全部用过：取最久未用的，并把它移到队尾
  const oldest = used[0] as number
  return { sliceIndex: oldest, usedSlices: [...used.slice(1), oldest] }
}

/**
 * 决定下一回合读哪首曲子。
 *
 * 不能预先洗好一副固定的牌堆——场上的牌会随对局减少，选择必须是惰性的。
 */
export function pickNextReading(
  state: MatchState,
  poolById: ReadonlyMap<SongId, SongRef>,
): { reading: Reading; usedSlices: number[] } {
  const live = liveFieldSongs(state)
  const kara = state.karafuda
  const rng = createRng(`${state.seed}:read:${state.roundNo}`)

  let useKara: boolean
  // 可用性优先于偏好——先确认还有什么可读，再谈读什么
  if (live.length === 0) {
    useKara = true
  } else if (kara.length === 0) {
    useKara = false
  } else if (state.history.length === 0) {
    // 第 1 回合不出空札：玩家需要先建立节奏，再被罚才公平
    useKara = false
  } else if (trailingKarafudaRun(state) >= 2) {
    // 不连续超过 2 次空札
    useKara = false
  } else {
    // 空札占比随场上牌减少自然上升，与真歌牌的手感一致
    const p = kara.length / (kara.length + live.length)
    useKara = rng.next() < Math.min(0.45, Math.max(0.12, p))
  }

  const candidates = useKara ? kara : live
  if (candidates.length === 0) {
    throw new Error('没有可读的曲子——对局应当已经结束')
  }

  // 少读过的优先，避免同一首反复出现
  const [songId] = rng.sampleWeighted(candidates, 1, (id) => 1 / (1 + timesPlayed(state, id)))
  const song = poolById.get(songId as SongId)
  if (!song) throw new Error(`曲库里找不到 ${songId}`)

  const { sliceIndex, usedSlices } = pickSlice(state, song)

  return {
    reading: {
      roundNo: state.roundNo + 1,
      songId: song.id,
      sliceIndex,
      kind: useKara ? 'karafuda' : 'field',
    },
    usedSlices,
  }
}
