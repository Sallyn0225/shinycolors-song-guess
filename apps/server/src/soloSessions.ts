import { randomBytes, randomUUID } from 'node:crypto'

import { DIFFICULTY_PRESETS, type Difficulty, type ScoreBreakdown } from '@scg/shared'
import { generateSoloRound, gradeAnswer, maxScore, scoreAnswer, type SoloQuestion } from '@scg/game-core'

import type { Catalog } from './catalog.js'

export interface AnswerRecord {
  index: number
  choice: number
  correct: boolean
  elapsedMs: number
  replaysUsed: number
  score: ScoreBreakdown
}

export interface SoloSession {
  id: string
  difficulty: Difficulty
  questions: SoloQuestion[]
  answers: Map<number, AnswerRecord>
  /** 每题一个随机 token → sliceId。**每局重新生成**，客户端拿不到持久映射 */
  clipTokens: Map<string, string>
  tokenByIndex: Map<number, string>
  /** 服务端记录的发题时刻，用于校验客户端上报的耗时 */
  servedAt: Map<number, number>
  replaysUsed: Map<number, number>
  createdAt: number
}

const SESSION_TTL_MS = 60 * 60 * 1000

export class SoloSessionStore {
  private readonly sessions = new Map<string, SoloSession>()

  constructor(private readonly catalog: Catalog) {}

  private sweep(): void {
    const cutoff = Date.now() - SESSION_TTL_MS
    for (const [id, s] of this.sessions) {
      if (s.createdAt < cutoff) this.sessions.delete(id)
    }
  }

  create(difficulty: Difficulty): SoloSession {
    this.sweep()
    const id = randomUUID()
    // 每局一个独立 seed：同一玩家连开两局不会撞题
    const round = generateSoloRound(this.catalog.soloSongs, difficulty, randomBytes(16).toString('hex'))
    const session: SoloSession = {
      id,
      difficulty,
      questions: round.questions,
      answers: new Map(),
      clipTokens: new Map(),
      tokenByIndex: new Map(),
      servedAt: new Map(),
      replaysUsed: new Map(),
      createdAt: Date.now(),
    }
    this.sessions.set(id, session)
    return session
  }

  get(id: string): SoloSession | null {
    const s = this.sessions.get(id)
    if (!s) return null
    if (s.createdAt < Date.now() - SESSION_TTL_MS) {
      this.sessions.delete(id)
      return null
    }
    return s
  }

  /**
   * 取第 index 题的下发视图。
   *
   * **绝不包含 answerIndex**——判分完全在服务端。
   * clip 走一次性 token，客户端看不到 sliceId，也就无法积累「切片↔曲目」对照表。
   */
  serveQuestion(
    session: SoloSession,
    index: number,
  ): {
    index: number
    total: number
    clipToken: string
    options: Array<{ id: string; title: string; artist: string; unitColor: string | null }>
    alreadyAnswered: AnswerRecord | null
  } | null {
    const q = session.questions[index]
    if (!q) return null

    let token = session.tokenByIndex.get(index)
    if (!token) {
      const sliceId = this.catalog.sliceIdFor(q.songId, q.sliceIndex)
      if (!sliceId) return null
      token = randomBytes(16).toString('hex')
      session.clipTokens.set(token, sliceId)
      session.tokenByIndex.set(index, token)
    }
    // 注意：这里**不**开始计时。客户端会预取下一题的音频，
    // 若在取题时就起表，下一题一进去就已经超时了。计时由 begin() 显式开启。
    const options = q.optionIds
      .map((id) => this.catalog.optionView(id))
      .filter((o): o is NonNullable<typeof o> => o !== null)

    return {
      index,
      total: session.questions.length,
      clipToken: token,
      options,
      alreadyAnswered: session.answers.get(index) ?? null,
    }
  }

  /**
   * 开始计时。客户端真正把题目呈现给玩家时调用。
   * 幂等：重复调用不会重置，防止靠反复调用刷时间。
   */
  begin(session: SoloSession, index: number): { deadlineMs: number } | null {
    if (!session.questions[index]) return null
    if (!session.servedAt.has(index)) session.servedAt.set(index, Date.now())
    return { deadlineMs: DIFFICULTY_PRESETS[session.difficulty].answerSeconds * 1000 }
  }

  /** 记一次重听。超过难度允许的次数就拒绝 */
  useReplay(session: SoloSession, index: number): { ok: boolean; used: number; allowed: number } {
    const allowed = DIFFICULTY_PRESETS[session.difficulty].replays
    const used = session.replaysUsed.get(index) ?? 0
    if (used >= allowed) return { ok: false, used, allowed }
    session.replaysUsed.set(index, used + 1)
    return { ok: true, used: used + 1, allowed }
  }

  answer(
    session: SoloSession,
    index: number,
    choice: number,
  ): { record: AnswerRecord; answerIndex: number; song: NonNullable<ReturnType<Catalog['byId']['get']>> } | null {
    const q = session.questions[index]
    if (!q) return null
    if (session.answers.has(index)) return null // 一题只能答一次

    const servedAt = session.servedAt.get(index) ?? Date.now()
    const elapsedMs = Date.now() - servedAt
    const limitMs = DIFFICULTY_PRESETS[session.difficulty].answerSeconds * 1000
    // 服务端以自己的计时为准；超时即判错，客户端上报的时间只作参考
    const timedOut = elapsedMs > limitMs + 1500

    const correct = !timedOut && gradeAnswer(q, choice)
    const replaysUsed = session.replaysUsed.get(index) ?? 0
    const record: AnswerRecord = {
      index,
      choice,
      correct,
      elapsedMs,
      replaysUsed,
      // 计分在服务端算——客户端上报的耗时只作展示，不参与判分
      score: scoreAnswer({ correct, elapsedMs, limitMs, replaysUsed }),
    }
    session.answers.set(index, record)

    const song = this.catalog.byId.get(q.songId)
    if (!song) return null
    return { record, answerIndex: q.optionIds.indexOf(q.songId), song }
  }

  summary(session: SoloSession): {
    difficulty: Difficulty
    total: number
    correct: number
    answered: number
    avgMs: number
    score: number
    maxScore: number
    items: Array<{
      index: number
      correct: boolean | null
      elapsedMs: number | null
      score: number | null
      replaysUsed: number
      song: { id: string; title: string; artist: string; unit: string | null; unitColor: string | null }
      chosen: { id: string; title: string } | null
    }>
  } {
    const items = session.questions.map((q, i) => {
      const rec = session.answers.get(i)
      const song = this.catalog.byId.get(q.songId)
      const chosenId = rec ? q.optionIds[rec.choice] : undefined
      const chosen = chosenId ? this.catalog.byId.get(chosenId) : undefined
      return {
        index: i,
        correct: rec ? rec.correct : null,
        elapsedMs: rec ? rec.elapsedMs : null,
        score: rec ? rec.score.total : null,
        replaysUsed: rec?.replaysUsed ?? 0,
        song: {
          id: song?.id ?? q.songId,
          title: song?.title ?? '',
          artist: song?.artist ?? '',
          unit: song?.unit ?? null,
          unitColor: song?.unitColor ?? null,
        },
        chosen: chosen ? { id: chosen.id, title: chosen.title } : null,
      }
    })
    const answered = [...session.answers.values()]
    return {
      difficulty: session.difficulty,
      total: session.questions.length,
      correct: answered.filter((a) => a.correct).length,
      answered: answered.length,
      avgMs: answered.length ? Math.round(answered.reduce((s, a) => s + a.elapsedMs, 0) / answered.length) : 0,
      score: answered.reduce((s, a) => s + a.score.total, 0),
      maxScore: maxScore(session.questions.length),
      items,
    }
  }
}
