import { useEffect, useState } from 'react'
import { DIFFICULTY_PRESETS } from '@scg/shared'

import { api, type Summary } from '../api'

interface Props {
  sessionId: string
  onReplay: () => void
  onHome: () => void
}

function Verdict({ rate }: { rate: number }) {
  const line =
    rate >= 0.9 ? '曲库在你脑子里' : rate >= 0.7 ? '相当熟' : rate >= 0.45 ? '还行' : rate > 0 ? '再听听' : '从头再来'
  return <span className="prism-text font-display text-2xl font-extrabold">{line}</span>
}

export function Result({ sessionId, onReplay, onHome }: Props) {
  const [data, setData] = useState<Summary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .result(sessionId)
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : '读取结算失败'))
  }, [sessionId])

  if (error) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-2xl items-center justify-center px-6">
        <p className="text-sm text-[color:var(--color-wrong)]">{error}</p>
      </main>
    )
  }
  if (!data) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-2xl items-center justify-center px-6">
        <p className="text-sm text-faint">结算中…</p>
      </main>
    )
  }

  const rate = data.total > 0 ? data.correct / data.total : 0
  const preset = DIFFICULTY_PRESETS[data.difficulty]

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-12 sm:px-6">
      <header className="anim-rise">
        <div className="prism-flow mb-7 h-px w-20 opacity-80" />
        <p className="font-mono text-[11px] tracking-[0.28em] text-faint uppercase">Result · {preset.label}</p>

        <div className="mt-4 flex items-end gap-4">
          <span className="tnum font-mono text-7xl leading-none font-medium">{data.score}</span>
          <span className="tnum mb-2 font-mono text-2xl text-faint">/ {data.maxScore}</span>
        </div>
        <div className="mt-3">
          <Verdict rate={rate} />
        </div>

        <dl className="mt-7 grid grid-cols-4 gap-3 border-y border-[color:var(--color-line)] py-4">
          {[
            ['答对', `${data.correct}/${data.total}`],
            ['正确率', `${Math.round(rate * 100)}%`],
            ['平均用时', `${(data.avgMs / 1000).toFixed(1)}s`],
            ['片段长度', `${preset.clipSeconds}s`],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-[10px] tracking-wider text-faint">{k}</dt>
              <dd className="tnum mt-1 font-mono text-base sm:text-lg">{v}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-3 text-xs text-faint">
          得分 = 答对 100 分 + 最高 100 分的速度奖励（越快越高），每次重听 −10 分。
        </p>
      </header>

      <ol className="mt-8 space-y-1.5">
        {data.items.map((item, i) => {
          const ok = item.correct === true
          return (
            <li
              key={item.index}
              className="anim-rise relative flex items-center gap-3 overflow-hidden rounded-xl border border-[color:var(--color-line)] bg-panel py-3 pr-4 pl-4"
              style={{ animationDelay: `${Math.min(i * 40, 600)}ms` }}
            >
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 w-[3px]"
                style={{ background: item.song.unitColor ?? 'var(--color-line-lit)' }}
              />
              <img
                src={`/thumb/${item.song.id}.webp`}
                alt=""
                loading="lazy"
                className={`h-10 w-10 shrink-0 rounded-md object-cover ${ok ? '' : 'grayscale'}`}
              />
              <span className="min-w-0 flex-1">
                <span className="jp-wrap block truncate text-sm font-bold">{item.song.title}</span>
                <span className="jp-wrap block truncate text-xs text-muted">
                  {item.chosen && !ok ? `你选了：${item.chosen.title}` : item.song.artist}
                </span>
              </span>
              <span className="hidden shrink-0 text-right sm:block">
                {item.elapsedMs !== null && (
                  <span className="tnum block font-mono text-xs text-faint">
                    {(item.elapsedMs / 1000).toFixed(1)}s
                    {item.replaysUsed > 0 && <span className="ml-1">↻{item.replaysUsed}</span>}
                  </span>
                )}
                {ok && item.score !== null && (
                  <span className="tnum block font-mono text-xs text-[color:var(--color-correct)]">
                    +{item.score}
                  </span>
                )}
              </span>
              <span
                className="shrink-0 text-base"
                style={{ color: ok ? 'var(--color-correct)' : 'var(--color-wrong)' }}
                aria-label={ok ? '答对' : '答错'}
              >
                {ok ? '✓' : '✕'}
              </span>
            </li>
          )
        })}
      </ol>

      <div className="mt-10 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={onReplay}
          className="rounded-xl border border-[color:var(--color-line-lit)] bg-panel py-3.5 text-sm font-bold transition-all hover:-translate-y-0.5 hover:bg-panel-lit"
        >
          再来一局
        </button>
        <button
          type="button"
          onClick={onHome}
          className="rounded-xl border border-[color:var(--color-line)] py-3.5 text-sm text-muted transition-all hover:border-[color:var(--color-line-lit)] hover:text-text"
        >
          换个难度
        </button>
      </div>
    </main>
  )
}
