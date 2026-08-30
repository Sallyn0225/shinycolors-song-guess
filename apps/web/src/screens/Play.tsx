import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  api,
  clipFallbackUrl,
  clipUrl,
  type AnswerResult,
  type QuestionView,
  type SessionInfo,
} from '../api'
import { audio } from '../audio'
import { OptionBar, type OptionState } from '../components/OptionBar'
import { Button } from '../ui/Button'
import { Countdown } from '../ui/Countdown'
import { Icon } from '../ui/Icon'
import { PrismRail, type Crease } from '../ui/PrismRail'
import { SectionTitle } from '../ui/SectionTitle'

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
  /** 走过的题：留在光带上的折痕 */
  const [past, setPast] = useState<boolean[]>([])
  /** 出错后重试本题：自增即可重跑载入 effect */
  const [reload, setReload] = useState(0)

  const deadlineRef = useRef(0)
  const phaseRef = useRef<Phase>('loading')
  phaseRef.current = phase

  const key = (idx: number, token: string) => `${session.sessionId}:${idx}:${token}`

  /** 剩余比例。PrismRail 在 rAF 里直接调它写 DOM，不经过 React state */
  const getRemaining = useCallback(() => {
    if (phaseRef.current !== 'answering') return phaseRef.current === 'loading' ? 1 : 0
    const left = deadlineRef.current - performance.now()
    return Math.max(0, left / (session.answerSeconds * 1000))
  }, [session.answerSeconds])

  /** 剩余毫秒。数字与光带读同一个 deadlineRef，两者不可能对不上 */
  const getMsLeft = useCallback(() => Math.max(0, deadlineRef.current - performance.now()), [])

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
        setPast((p) => [...p, r.correct])
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
  }, [index, reload, session.sessionId, session.replays, session.total, playClip, fallbackOf])

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

  // 折痕：答过的每一题在光带上留一道，走过的路一直看得见
  const creases = useMemo<Crease[]>(() => {
    const total = session.total
    return Array.from({ length: total }, (_, i): Crease => {
      const tone: Crease['tone'] = i < past.length ? (past[i] ? 'good' : 'bad') : 'pending'
      return { at: (i + 0.5) / total, tone }
    })
  }, [past, session.total])

  const stateOf = (i: number): OptionState => {
    if (!result) return 'idle'
    if (i === result.answerIndex) return 'correct'
    if (i === chosen) return 'wrong' // 我选错的那一项要标红，光高亮正确答案不够
    return 'dimmed'
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full flex-col px-5 py-4 sm:px-10 sm:py-8"
          style={{ maxWidth: 'calc(1300 * var(--u))' }}>
      {/* ── 头 ────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <SectionTitle
          kana={phase === 'revealed' ? 'アンサー' : 'リスニング'}
          latin={phase === 'revealed' ? 'ANSWER' : 'LISTENING'}
        />
        {/* comp 里计数器与标题是上缘的一对锚点，不是脚注 —— 字号与跨度都要跟上 */}
        <div className="flex shrink-0 items-baseline" style={{ gap: 'calc(28 * var(--u))' }}>
          <p className="latin sc-title font-semibold text-primary" style={{ letterSpacing: 'var(--tracking-wide)' }}>
            {String(index + 1).padStart(2, '0')}
            <span className="text-ink-faint"> / {String(session.total).padStart(2, '0')}</span>
          </p>
          <p className="latin sc-title font-bold text-primary" style={{ letterSpacing: 'var(--tracking-tight)' }}>
            {score}
          </p>
        </div>
      </header>

      {/* ── 一条光 ────────────────────────────────────────── */}
      {/*
        秒数就落在光带的收拢点上：光带是从两端向中央收的，所以这一刻该看的两件事
        ——「还剩多久」与「现在在播吗」—— 在视线里是同一个位置，不用来回扫。
        18u 的下边距是让开折痕（12u）；数字压在频谱上，ink 对任何一根棱镜色柱都在 10:1 以上。
      */}
      <div className="relative mt-5">
        <PrismRail
          getRemaining={getRemaining}
          creases={creases}
          mode="top"
          label={`本题剩余时间，共 ${session.answerSeconds} 秒`}
        />
        {phase === 'answering' && (
          <div
            className="pointer-events-none absolute inset-x-0 flex justify-center"
            style={{ bottom: 'calc(18 * var(--u))' }}
          >
            <Countdown
              getMsLeft={getMsLeft}
              totalSeconds={session.answerSeconds}
              size={56}
              label="本题剩余时间"
            />
          </div>
        )}
      </div>

      {/* ── 揭晓：曲名与演唱者 ────────────────────────────── */}
      <div
        role="status"
        aria-live="polite"
        className="sc-revealslot mt-3 flex items-center gap-4 sm:mt-4"
      >
        {phase === 'loading' && <p className="text-sm text-ink-faint">载入中…</p>}
        {phase === 'revealed' && result && (
          <>
            <span className="cut-shadow-sm anim-appear shrink-0">
              <img
                src={result.song.coverUrl}
                alt=""
                loading="eager"
                className="cut-hex block"
                style={{ width: 'calc(56 * var(--u))', height: 'calc(56 * var(--u))', objectFit: 'cover' }}
              />
            </span>
            <span className="anim-appear min-w-0" style={{ animationDelay: '60ms' }}>
              <span className="jp-wrap block font-bold text-ink" style={{ fontSize: 'calc(22 * var(--u))' }}>
                {result.song.title}
              </span>
              <span className="jp-wrap block text-sm text-ink-sub">{result.song.artist}</span>
            </span>
            <span
              className="anim-appear ml-auto shrink-0 text-right"
              style={{ animationDelay: '120ms' }}
            >
              <span
                className="latin block font-bold"
                style={{
                  fontSize: 'calc(26 * var(--u))',
                  letterSpacing: 'var(--tracking-base)',
                  color: result.correct ? 'var(--color-correct)' : 'var(--color-wrong)',
                }}
              >
                {result.correct ? '正解' : '不正解'}
              </span>
              {result.correct && (
                <span className="latin block text-sm text-correct">
                  +{result.score.total}
                  {result.score.speed > 0 && (
                    <span className="ml-2 text-ink-faint">速度 +{result.score.speed}</span>
                  )}
                </span>
              )}
            </span>
          </>
        )}
      </div>

      {/* ── 选项 ──────────────────────────────────────────── */}
      <section
        className="sc-options mt-2 flex flex-col"
        aria-label="选项"
      >
        {question?.options.map((o, i) => (
          <OptionBar
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
        <p role="alert" className="mt-5 text-sm text-wrong">
          {error}
        </p>
      )}

      {/* ── 主操作 ────────────────────────────────────────── */}
      <div className="mt-5 flex items-center gap-4 pb-5 sm:mt-6 sm:pb-6">
        {/* 出错时重听与下一题都不渲染，不补这一条就是死路：
            屏幕上只剩一行 alert，玩家除了退出无事可做 */}
        {phase === 'error' && (
          <Button variant="primary" size="lg" onClick={() => setReload((n) => n + 1)}>
            重试本题
            <Icon name="replay" size="calc(17 * var(--u))" />
          </Button>
        )}
        {phase === 'answering' && (
          <Button variant="outline" size="lg" onClick={() => void replay()} disabled={replaysLeft <= 0}>
            <Icon name="replay" size="calc(17 * var(--u))" />
            重听
            <span className="latin">({replaysLeft})</span>
            <span className="ml-1 hidden text-xs text-ink-faint sm:inline">R</span>
          </Button>
        )}
        {phase === 'revealed' && (
          <Button variant="primary" size="lg" onClick={next} autoFocus className="anim-appear">
            {index + 1 >= session.total ? '查看结算' : '下一题'}
            <Icon name="next" size="calc(17 * var(--u))" />
            <span className="ml-1 text-xs font-normal opacity-70">Enter</span>
          </Button>
        )}
        <button
          type="button"
          onClick={onQuit}
          className="tap-line ml-auto text-xs text-ink-faint transition-colors hover:text-primary"
          style={{ letterSpacing: 'var(--tracking-base)' }}
        >
          退出本局
        </button>
      </div>
    </main>
  )
}
