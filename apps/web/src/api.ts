import type { Difficulty, ScoreBreakdown } from '@scg/shared'

export interface SessionInfo {
  sessionId: string
  difficulty: Difficulty
  total: number
  clipSeconds: number
  answerSeconds: number
  optionCount: number
  replays: number
  /** 曲库里有没有 AAC 兜底副本。没有就别去试，只会白等一次 404 */
  aacFallback: boolean
}

export interface Option {
  id: string
  title: string
  artist: string
  unitColor: string | null
}

export interface QuestionView {
  index: number
  total: number
  clipToken: string
  options: Option[]
  alreadyAnswered: { correct: boolean; choice: number } | null
}

export interface AnswerResult {
  correct: boolean
  answerIndex: number
  elapsedMs: number
  score: ScoreBreakdown
  song: {
    id: string
    title: string
    artist: string
    unit: string | null
    unitColor: string | null
  }
}

export interface ResultItem {
  index: number
  correct: boolean | null
  elapsedMs: number | null
  score: number | null
  replaysUsed: number
  song: { id: string; title: string; artist: string; unit: string | null; unitColor: string | null }
  chosen: { id: string; title: string } | null
}

export interface Summary {
  difficulty: Difficulty
  total: number
  correct: number
  answered: number
  avgMs: number
  score: number
  maxScore: number
  items: ResultItem[]
}

export class ApiError extends Error {}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  // 只在真的有 body 时才带 content-type。
  // 否则 Fastify 会去解析一个空 body，直接返回 400 Bad Request。
  const headers = init?.body ? { 'content-type': 'application/json', ...(init.headers ?? {}) } : init?.headers
  const res = await fetch(url, { ...init, ...(headers ? { headers } : {}) })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new ApiError(body.error ?? `请求失败（${res.status}）`)
  }
  return (await res.json()) as T
}

export const api = {
  createSession: (difficulty: Difficulty) =>
    req<SessionInfo>('/api/solo/session', { method: 'POST', body: JSON.stringify({ difficulty }) }),

  question: (sid: string, index: number) => req<QuestionView>(`/api/solo/${sid}/question/${index}`),

  /** 开始计时。与取题分开，这样可以自由预取下一题而不会提前起表 */
  begin: (sid: string, index: number) =>
    req<{ deadlineMs: number }>(`/api/solo/${sid}/question/${index}/begin`, { method: 'POST' }),

  replay: (sid: string, index: number) =>
    req<{ used: number; allowed: number }>(`/api/solo/${sid}/question/${index}/replay`, { method: 'POST' }),

  answer: (sid: string, index: number, choice: number) =>
    req<AnswerResult>(`/api/solo/${sid}/question/${index}/answer`, {
      method: 'POST',
      body: JSON.stringify({ choice }),
    }),

  result: (sid: string) => req<Summary>(`/api/solo/${sid}/result`),
}

/** 切片地址。token 是每局一次性的，客户端永远看不到 sliceId */
export const clipUrl = (sid: string, token: string): string => `/api/clip/${sid}/${token}`

/** AAC 兜底地址。Safari 18.4 以前放不了 Ogg Opus，只能换一份 */
export const clipFallbackUrl = (sid: string, token: string): string => `${clipUrl(sid, token)}.m4a`
