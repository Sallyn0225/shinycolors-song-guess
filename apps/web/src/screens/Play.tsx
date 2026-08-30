import { useCallback, useEffect, useRef, useState } from 'react'

import {
  api,
  clipFallbackUrl,
  clipUrl,
  type AnswerResult,
  type QuestionView,
  type SessionInfo,
} from '../api'
import { audio } from '../audio'
import { Stage } from '../components/Stage'
import { OptionCard, type OptionState } from '../components/OptionCard'

interface Props {
  session: SessionInfo
  onFinish: () => void
  onQuit: () => void
}

type Phase = 'loading' | 'answering' | 'revealed' | 'error'

/** 超时用的哨兵：一个必然不匹配任何选项的下标 */
const TIMED_OUT = -1

export function Play({ session, onFinish, onQuit }: Props) {
  const [index, setIndex] = useState(0)
  const [question, setQuestion] = useState<QuestionView | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AnswerResult | null>(null)
  /** 我选的是第几个。用来把选错的那一项标红 —— 只知道正确答案是不够的 */
  const [chosen, setChosen] = useState<number | null>(null)
  const [replaysLeft, setReplaysLeft] = useState(session.replays)
  const [score, setScore] = useState(0)

  const deadlineRef = useRef(0)
  const phaseRef = useRef<Phase>('loading')
  phaseRef.current = phase

  const key = (idx: number, token: string) => `${session.sessionId}:${idx}:${token}`

  /** 剩余比例。Stage 在 rAF 里直接调它写 DOM，不经过 React state */
  const getRemaining = useCallback(() => {
    if (phaseRef.current !== 'answering') return phaseRef.current === 'loading' ? 1 : 0
    const left = deadlineRef.current - performance.now()
    return Math.max(0, left / (session.answerSeconds * 1000))
  }, [session.answerSeconds])

  /** 曲库有兜底副本时才把它交给音频引擎；没有就别去试，只会白等一次 404 */
  const fallbackOf = useCallback(
    (token: string) => (session.aacFallback ? clipFallbackUrl(session.sessionId, token) : undefined),
    [session.sessionId, session.aacFallback],
  )

  /** 只播前 clipSeconds 秒。切片文件恒为 15 秒，难度只体现在这里的截断 */
  const playClip = useCallback(
    async (q: QuestionView) => {
      try {
        await audio.play(
          key(q.index, q.clipToken),
          clipUrl(session.sessionId, q.clipToken),
          session.clipSeconds,
          undefined,
          fallbackOf(q.clipToken),
        )
      } catch {
        setError('音频加载失败，可以重听或直接作答')
      }
    },
    [session.sessionId, session.clipSeconds, fallbackOf],
  )

  const submit = useCallback(
    async (choice: number) => {
      if (phaseRef.current !== 'answering') return
      phaseRef.current = 'revealed'
      setPhase('revealed')
      setChosen(choice === TIMED_OUT ? null : choice)
      audio.stop()
      try {
        const r = await api.answer(session.sessionId, index, choice)
        setResult(r)
        setScore((s) => s + r.score.total)
      } catch (e) {
        setError(e instanceof Error ? e.message : '提交失败')
      }
    },
    [index, session.sessionId],
  )

  // 载入并开始一题
  useEffect(() => {
    let cancelled = false
    setPhase('loading')
    phaseRef.current = 'loading'
    setResult(null)
    setChosen(null)
    setError(null)
    setReplaysLeft(session.replays)

    void (async () => {
      try {
        const q = await api.question(session.sessionId, index)
        if (cancelled) return
        setQuestion(q)

        // 先解码好再起表，避免把下载时间算进答题时间
        await audio
          .prefetch(key(q.index, q.clipToken), clipUrl(session.sessionId, q.clipToken), fallbackOf(q.clipToken))
          .catch(() => {})
        if (cancelled) return

        const { deadlineMs } = await api.begin(session.sessionId, index)
        if (cancelled) return
        deadlineRef.current = performance.now() + deadlineMs
        phaseRef.current = 'answering'
        setPhase('answering')
        void playClip(q)

        // 预取下一题：取题与起表已拆开，所以不会让下一题提前超时
        if (index + 1 < session.total) {
          void api
            .question(session.sessionId, index + 1)
            .then((next) =>
              audio.prefetch(
                key(next.index, next.clipToken),
                clipUrl(session.sessionId, next.clipToken),
                fallbackOf(next.clipToken),
              ),
            )
            .catch(() => {})
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '出错了')
          setPhase('error')
        }
      }
    })()

    return () => {
      cancelled = true
      audio.stop()
    }
  }, [index, session.sessionId, session.replays, session.total, playClip, fallbackOf])

  // 截止用一个 timeout 就够，不必每帧检查
  useEffect(() => {
    if (phase !== 'answering') return
    const left = Math.max(0, deadlineRef.current - performance.now())
    const t = window.setTimeout(() => void submit(TIMED_OUT), left)
    return () => window.clearTimeout(t)
  }, [phase, submit])

  const replay = useCallback(async () => {
    if (phaseRef.current !== 'answering' || replaysLeft <= 0 || !question) return
    try {
      const r = await api.replay(session.sessionId, index)
      setReplaysLeft(r.allowed - r.used)
      void playClip(question)
    } catch {
      setReplaysLeft(0)
    }
  }, [replaysLeft, question, session.sessionId, index, playClip])

  const next = useCallback(() => {
    if (index + 1 >= session.total) onFinish()
    else setIndex((i) => i + 1)
  }, [index, session.total, onFinish])

  // 键盘：1-4 选项，R 重听，Enter/空格 下一题
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return
      if (phase === 'answering') {
        const n = Number(e.key)
        if (n >= 1 && n <= (question?.options.length ?? 0)) void submit(n - 1)
        else if (e.key.toLowerCase() === 'r') void replay()
      } else if (phase === 'revealed' && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault()
        next()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, question, submit, replay, next])

  const verdict = result ? (result.correct ? 'correct' : 'wrong') : null

  const stateOf = (i: number): OptionState => {
    if (!result) return 'idle'
    if (i === result.answerIndex) return 'correct'
    if (i === chosen) return 'wrong' // 我选错的那一项要标红，光高亮正确答案不够
    return 'dimmed'
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-5 py-6 sm:px-6">
      <header className="flex items-center gap-4">
        <button
          type="button"
          onClick={onQuit}
          className="rounded-lg border border-[color:var(--color-line)] px-3 py-1.5 text-xs text-muted transition-colors hover:border-[color:var(--color-line-lit)] hover:text-text"
        >
          退出
        </button>
        <div className="flex-1">
          <div className="h-[3px] w-full overflow-hidden rounded-full bg-[color:var(--color-line)]">
            <div
              className="prism-bar h-full transition-[width] duration-500 ease-out"
              style={{ width: `${((index + (result ? 1 : 0)) / session.total) * 100}%` }}
            />
          </div>
        </div>
        <p className="tnum shrink-0 font-mono text-xs text-muted">
          {index + 1}/{session.total} · <span className="text-text">{score}</span>
        </p>
      </header>

      <section className="mt-8 sm:mt-10">
        <Stage
          getRemaining={getRemaining}
          totalSeconds={session.answerSeconds}
          mode={phase === 'answering' ? 'countdown' : phase === 'revealed' ? 'reveal' : 'idle'}
          verdict={verdict}
        >
          {phase === 'loading' && <span className="text-xs text-faint">载入中…</span>}

          {phase === 'revealed' && result && (
            <>
              <img
                src={result.song.coverUrl}
                alt=""
                className="anim-rise mb-2.5 h-20 w-20 rounded-xl object-cover shadow-[0_8px_28px_rgba(0,0,0,.6)]"
                loading="eager"
              />
              <span
                className="anim-rise font-display text-2xl font-extrabold tracking-wide"
                style={{
                  color: result.correct ? 'var(--color-correct)' : 'var(--color-wrong)',
                  animationDelay: '60ms',
                }}
              >
                {result.correct ? '正解' : '不正解'}
              </span>
              {result.correct && (
                <span
                  className="tnum anim-rise mt-1 font-mono text-sm text-[color:var(--color-correct)]"
                  style={{ animationDelay: '120ms' }}
                >
                  +{result.score.total}
                  {result.score.speed > 0 && (
                    <span className="ml-1 text-[11px] text-faint">速度 +{result.score.speed}</span>
                  )}
                </span>
              )}
            </>
          )}
        </Stage>
      </section>

      {phase === 'answering' && (
        <div className="mt-5 flex justify-center">
          <button
            type="button"
            onClick={() => void replay()}
            disabled={replaysLeft <= 0}
            className="rounded-full border border-[color:var(--color-line)] px-5 py-2 text-xs text-muted transition-all hover:border-[color:var(--color-line-lit)] hover:text-text disabled:opacity-35"
          >
            ↻ 重听 <span className="tnum font-mono">({replaysLeft})</span>
            <span className="ml-2 hidden text-faint sm:inline">R</span>
          </button>
        </div>
      )}

      {phase === 'revealed' && result && (
        <div className="anim-rise mt-5 text-center">
          <p className="jp-wrap font-display text-xl font-extrabold">{result.song.title}</p>
          <p className="jp-wrap mt-1 text-sm text-muted">{result.song.artist}</p>
        </div>
      )}

      <section className="mt-6 grid gap-2.5 sm:mt-7 sm:grid-cols-2" aria-label="选项">
        {question?.options.map((o, i) => (
          <OptionCard
            key={o.id}
            option={o}
            index={i}
            state={stateOf(i)}
            disabled={phase !== 'answering'}
            showThumb={phase === 'revealed'}
            onPick={() => void submit(i)}
          />
        ))}
      </section>

      {error && (
        <p role="alert" className="mt-4 text-center text-xs text-[color:var(--color-wrong)]">
          {error}
        </p>
      )}

      {phase === 'revealed' && (
        <button
          type="button"
          onClick={next}
          autoFocus
          className="anim-rise mt-5 w-full rounded-xl border border-[color:var(--color-line-lit)] bg-panel py-3.5 text-sm font-bold transition-all hover:-translate-y-0.5 hover:bg-panel-lit"
          style={{ animationDelay: '160ms' }}
        >
          {index + 1 >= session.total ? '查看结算' : '下一题'}
          <span className="ml-2 text-xs font-normal text-faint">Enter</span>
        </button>
      )}

      <div className="pb-8" />
    </main>
  )
}
