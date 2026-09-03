import type { Difficulty } from '@scg/shared'

import { COUNTED_UNITS, isCountedUnit, unitColor, unitName } from './units'

export const RECORDS_VERSION = 1

/** 走势带保留的最近局数上限。再多，窄屏下一根竖条不足 3px 就读不出来了 */
export const RECENT_MAX = 20

/** 幂等记录窗口。单人不会往回翻 50 局之前的结算页 */
export const SEEN_MAX = 50

/** 组合榜上榜的最小出现次数。低于此阈值显示「样本不足」，避免 1 战全胜霸榜 */
export const UNIT_MIN = 5

/** 单曲易错榜上榜的最小出现次数。曲库 243 首，设为 3 可避免偶尔失误直接登顶 */
export const SONG_MIN = 3

export interface Tally {
  seen: number
  correct: number
}

export interface ModeRecord {
  games: number
  bestScore: number | null
  worstScore: number | null
  totalScore: number
  /** 累计答对出题数（口径见 record 函数实现） */
  totalCorrect: number
  /** 累计总出题数（口径见 record 函数实现） */
  totalQuestions: number
  /** 最近 N 局的得分率（0~1），新的在尾部 */
  recent: number[]
  lastPlayedAt: number
  /** unit id → 计数。只含 features/units.ts 里的 9 个 id */
  units: Record<string, Tally>
  /** song id → 计数 */
  songs: Record<string, Tally>
}

export interface Records {
  v: number
  /** 已计入的 sessionId，最近的在尾部，上限 SEEN_MAX */
  seen: string[]
  /**
   * 曲名与所属组合的快照。两档共用，避免存两遍。
   * 体积估算：243 首全部出现时 titles 约 15KB，modes 约 15KB，
   * 整体约 30KB 出头，对 5MB 的 localStorage 完全安全，无需裁剪。
   */
  titles: Record<string, { title: string; unit: string | null }>
  modes: Record<Difficulty, ModeRecord>
}

export interface SoloItemInput {
  correct: boolean | null
  song: {
    id: string
    title: string
    unit: string | null
  }
}

export interface SoloSummaryInput {
  difficulty: Difficulty
  total: number
  correct: number
  score: number
  maxScore: number
  items: SoloItemInput[]
}

export function emptyModeRecord(): ModeRecord {
  return {
    games: 0,
    bestScore: null,
    worstScore: null,
    totalScore: 0,
    totalCorrect: 0,
    totalQuestions: 0,
    recent: [],
    lastPlayedAt: 0,
    units: {},
    songs: {},
  }
}

export function emptyRecords(): Records {
  return {
    v: RECORDS_VERSION,
    seen: [],
    titles: {},
    modes: {
      easy: emptyModeRecord(),
      hard: emptyModeRecord(),
    },
  }
}

/**
 * 校验并回落未知或损坏的 Records 数据。
 * PRD R2：版本号不认识时一律回落到全新空数据，绝不做半吊子迁移。
 */
export function normalizeRecords(raw: unknown): Records {
  if (!raw || typeof raw !== 'object') return emptyRecords()
  const candidate = raw as Partial<Records>
  if (candidate.v !== RECORDS_VERSION) return emptyRecords()

  const fallback = emptyRecords()
  const seen = Array.isArray(candidate.seen)
    ? candidate.seen.filter((x): x is string => typeof x === 'string')
    : []

  const titles: Record<string, { title: string; unit: string | null }> = {}
  if (candidate.titles && typeof candidate.titles === 'object') {
    for (const [id, meta] of Object.entries(candidate.titles)) {
      if (meta && typeof meta === 'object' && typeof meta.title === 'string') {
        titles[id] = {
          title: meta.title,
          unit: typeof meta.unit === 'string' ? meta.unit : null,
        }
      }
    }
  }

  const parseMode = (m: unknown): ModeRecord => {
    if (!m || typeof m !== 'object') return emptyModeRecord()
    const cm = m as Partial<ModeRecord>
    const units: Record<string, Tally> = {}
    if (cm.units && typeof cm.units === 'object') {
      for (const [uid, tally] of Object.entries(cm.units)) {
        if (tally && typeof tally.seen === 'number' && typeof tally.correct === 'number') {
          units[uid] = { seen: tally.seen, correct: tally.correct }
        }
      }
    }
    const songs: Record<string, Tally> = {}
    if (cm.songs && typeof cm.songs === 'object') {
      for (const [sid, tally] of Object.entries(cm.songs)) {
        if (tally && typeof tally.seen === 'number' && typeof tally.correct === 'number') {
          songs[sid] = { seen: tally.seen, correct: tally.correct }
        }
      }
    }

    return {
      games: typeof cm.games === 'number' ? cm.games : 0,
      bestScore: typeof cm.bestScore === 'number' ? cm.bestScore : null,
      worstScore: typeof cm.worstScore === 'number' ? cm.worstScore : null,
      totalScore: typeof cm.totalScore === 'number' ? cm.totalScore : 0,
      totalCorrect: typeof cm.totalCorrect === 'number' ? cm.totalCorrect : 0,
      totalQuestions: typeof cm.totalQuestions === 'number' ? cm.totalQuestions : 0,
      recent: Array.isArray(cm.recent)
        ? cm.recent.filter((n): n is number => typeof n === 'number')
        : [],
      lastPlayedAt: typeof cm.lastPlayedAt === 'number' ? cm.lastPlayedAt : 0,
      units,
      songs,
    }
  }

  return {
    v: RECORDS_VERSION,
    seen: seen.slice(-SEEN_MAX),
    titles,
    modes: {
      easy: parseMode(candidate.modes?.easy),
      hard: parseMode(candidate.modes?.hard),
    },
  }
}

/**
 * 记录单人对局结算。纯函数，返回不可变的新 Records。
 */
export function record(
  prev: Records,
  sessionId: string,
  summary: SoloSummaryInput,
  now = Date.now(),
): Records {
  // AC1：按 sessionId 幂等，同一局多次进入不重复统计
  if (prev.seen.includes(sessionId)) {
    return prev
  }

  const mode = prev.modes[summary.difficulty] ?? emptyModeRecord()
  const games = mode.games + 1

  // 首局判定：初局时最高与最低分皆为该局得分
  const bestScore =
    mode.bestScore === null ? summary.score : Math.max(mode.bestScore, summary.score)
  const worstScore =
    mode.worstScore === null ? summary.score : Math.min(mode.worstScore, summary.score)

  const totalScore = mode.totalScore + summary.score

  // 【口径 1 注释】：模式总正确率分母使用 totalQuestions（累计加上 summary.total，含超时未作答题），
  // 与结算页 data.correct / data.total 完全一致，避免用户与结算页核对时发现数字不吻合。
  const totalQuestions = mode.totalQuestions + summary.total
  const totalCorrect = mode.totalCorrect + summary.correct

  const rate = summary.maxScore > 0 ? summary.score / summary.maxScore : 0
  const recent = [...mode.recent, rate].slice(-RECENT_MAX)

  const nextTitles = { ...prev.titles }
  const nextUnits = { ...mode.units }
  const nextSongs = { ...mode.songs }

  for (const item of summary.items) {
    const songId = item.song.id

    // 曲名快照仅在首次出现时写入，曲名不变，避免每局重复重写
    if (!nextTitles[songId]) {
      nextTitles[songId] = {
        title: item.song.title,
        unit: item.song.unit,
      }
    }

    // 【口径 2 注释】：单曲榜与组合榜分母只计入 item.correct !== null 的作答题目。
    // 超时未选代表玩家没有作答，不能推断「认不认识这首歌」，直接算作错误会严重污染喜好/易错排行。
    if (item.correct !== null) {
      const prevSong = nextSongs[songId] ?? { seen: 0, correct: 0 }
      nextSongs[songId] = {
        seen: prevSong.seen + 1,
        correct: prevSong.correct + (item.correct ? 1 : 0),
      }

      const u = item.song.unit
      // 只有 9 个常设与全体曲计入组合榜，shuffle unit 与 null 不计入组合榜
      if (isCountedUnit(u)) {
        const prevUnit = nextUnits[u] ?? { seen: 0, correct: 0 }
        nextUnits[u] = {
          seen: prevUnit.seen + 1,
          correct: prevUnit.correct + (item.correct ? 1 : 0),
        }
      }
    }
  }

  const seen = [...prev.seen, sessionId].slice(-SEEN_MAX)

  return {
    ...prev,
    v: RECORDS_VERSION,
    seen,
    titles: nextTitles,
    modes: {
      ...prev.modes,
      [summary.difficulty]: {
        games,
        bestScore,
        worstScore,
        totalScore,
        totalCorrect,
        totalQuestions,
        recent,
        lastPlayedAt: now,
        units: nextUnits,
        songs: nextSongs,
      },
    },
  }
}

export interface ModeView {
  empty: boolean
  games: number
  bestScore: number | null
  worstScore: number | null
  avgScore: number | null
  accuracy: number | null
  totalQuestions: number
  totalCorrect: number
}

export function modeView(r: Records, d: Difficulty): ModeView {
  const m = r.modes[d]
  if (!m || m.games === 0) {
    return {
      empty: true,
      games: 0,
      bestScore: null,
      worstScore: null,
      avgScore: null,
      accuracy: null,
      totalQuestions: 0,
      totalCorrect: 0,
    }
  }

  return {
    empty: false,
    games: m.games,
    bestScore: m.bestScore,
    worstScore: m.worstScore,
    avgScore: Math.round(m.totalScore / m.games),
    accuracy: m.totalQuestions > 0 ? m.totalCorrect / m.totalQuestions : 0,
    totalQuestions: m.totalQuestions,
    totalCorrect: m.totalCorrect,
  }
}

export interface UnitRow {
  id: string
  name: string
  color: string
  rate: number
  seen: number
  correct: number
  enough: boolean
  isHighest?: boolean
  isLowest?: boolean
}

/**
 * 组合正确率排行。
 * 全序稳定排序：
 * 1. 达标（seen >= UNIT_MIN）在前，未达标沉底；
 * 2. 达标组合按正确率降序，若相同按 seen 降序，再按 id 升序；
 * 3. 未达标组合按 seen 降序，再按 id 升序。
 */
export function unitRanking(r: Records, d: Difficulty): UnitRow[] {
  const mode = r.modes[d]
  const rows: UnitRow[] = COUNTED_UNITS.map((u) => {
    const tally = mode?.units[u.id] ?? { seen: 0, correct: 0 }
    const enough = tally.seen >= UNIT_MIN
    const rate = tally.seen > 0 ? tally.correct / tally.seen : 0
    return {
      id: u.id,
      name: u.name,
      color: u.color,
      rate,
      seen: tally.seen,
      correct: tally.correct,
      enough,
    }
  })

  rows.sort((a, b) => {
    if (a.enough !== b.enough) return a.enough ? -1 : 1
    if (a.enough) {
      if (b.rate !== a.rate) return b.rate - a.rate
      if (b.seen !== a.seen) return b.seen - a.seen
      return a.id.localeCompare(b.id)
    }
    if (b.seen !== a.seen) return b.seen - a.seen
    return a.id.localeCompare(b.id)
  })

  // 标出最高与最低（仅在有足够样本的组合中判定）
  const enoughList = rows.filter((x) => x.enough)
  if (enoughList.length > 0) {
    const highest = enoughList[0]
    if (highest) highest.isHighest = true

    if (enoughList.length > 1) {
      const lowest = enoughList[enoughList.length - 1]
      if (lowest && highest && lowest.rate < highest.rate) {
        lowest.isLowest = true
      }
    }
  }

  return rows
}

export interface SongRow {
  id: string
  title: string
  unit: string | null
  rate: number
  seen: number
  correct: number
}

/**
 * 易错单曲榜（正确率最低的前 n 首）。
 * 仅包含出现次数 >= SONG_MIN 的曲目。
 * 排序：正确率升序（最容易错的在前）；相同时出题次数多者在前；再按 id 升序。
 */
export function weakestSongs(r: Records, d: Difficulty, n = 5): SongRow[] {
  const mode = r.modes[d]
  if (!mode) return []

  const list: SongRow[] = []
  for (const [id, tally] of Object.entries(mode.songs)) {
    if (tally.seen >= SONG_MIN) {
      const titleMeta = r.titles[id]
      const rate = tally.seen > 0 ? tally.correct / tally.seen : 0
      list.push({
        id,
        title: titleMeta?.title ?? id,
        unit: titleMeta?.unit ?? null,
        rate,
        seen: tally.seen,
        correct: tally.correct,
      })
    }
  }

  list.sort((a, b) => {
    if (a.rate !== b.rate) return a.rate - b.rate
    if (b.seen !== a.seen) return b.seen - a.seen
    return a.id.localeCompare(b.id)
  })

  return list.slice(0, n)
}
