import { useEffect, useState } from 'react'
import { DIFFICULTY_PRESETS } from '@scg/shared'

import { api, type Summary } from '../api'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { SectionTitle } from '../ui/SectionTitle'
import { Stat } from '../ui/Stat'

interface Props {
  sessionId: string
  onReplay: () => void
  onHome: () => void
}

function verdictLine(rate: number): string {
  if (rate >= 0.9) return '曲库在你脑子里'
  if (rate >= 0.7) return '相当熟'
  if (rate >= 0.45) return '还行'
  if (rate > 0) return '再听听'
  return '从头再来'
}

const SLANT = 'calc(28 * var(--u))'
const ROW_CLIP = `polygon(${SLANT} 0, 100% 0, 100% calc(100% - ${SLANT}), calc(100% - ${SLANT}) 100%, 0 100%, 0 ${SLANT})`

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
      <main className="flex min-h-dvh items-center justify-center px-6">
        <p role="alert" className="text-sm text-wrong">
          {error}
        </p>
      </main>
    )
  }
  if (!data) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-6">
        <p className="text-sm text-ink-faint">结算中…</p>
      </main>
    )
  }

  const rate = data.total > 0 ? data.correct / data.total : 0
  const preset = DIFFICULTY_PRESETS[data.difficulty]

  return (
    <main
      className="mx-auto w-full px-6 py-14 sm:px-10"
      style={{ maxWidth: 'var(--page-main)' }}
    >
      <header className="anim-appear">
        <SectionTitle kana="リザルト" latin={`Result · ${preset.label}`} size="md" />

        {/*
          走过的每一题摊成一条折痕带 —— Play 里那条光带的自然延续。
          必须 nowrap：光带给自己立的规矩是「任何宽度只缩放不换行」，
          这里若用会换行的独立色片，就是在结算页上把那条规矩自己破掉。
          判定色也用同一套（correct / wrong），否则「答对」在 Play、光带、结算是三种颜色。
        */}
        <div
          className="mt-7 flex w-full flex-nowrap items-end"
          style={{ gap: 'calc(4 * var(--u))', height: 'calc(16 * var(--u))' }}
          role="img"
          aria-label={`逐题结果：共 ${data.total} 题，答对 ${data.correct} 题`}
        >
          {data.items.map((item) => (
            <span
              key={item.index}
              title={`第 ${item.index + 1} 题`}
              className="cut-slant block min-w-0 flex-1"
              style={{
                height: item.correct === null ? 'calc(7 * var(--u))' : '100%',
                alignSelf: 'flex-end',
                background:
                  item.correct === true
                    ? 'var(--color-correct)'
                    : item.correct === false
                      ? 'var(--color-wrong)'
                      : 'rgb(162 162 192 / .3)',
                ['--cut-sm' as string]: 'calc(6 * var(--u))',
              }}
            />
          ))}
        </div>

        <div className="mt-6 flex items-end gap-5">
          <span
            className="latin sc-figure font-bold text-primary"
            style={{ lineHeight: 0.9 }}
          >
            {data.score}
          </span>
          <span className="latin mb-3 text-2xl text-ink-faint">/ {data.maxScore}</span>
          <span
            className="sc-title jp-wrap mb-3 ml-auto font-bold text-ink" 
          >
            {verdictLine(rate)}
          </span>
        </div>

        <dl
          className="mt-8 grid grid-cols-2 gap-6 py-6 sm:grid-cols-4"
          style={{
            borderTop: '1px solid var(--color-divider)',
            borderBottom: '1px solid var(--color-divider)',
          }}
        >
          <Stat label="答对" value={`${data.correct} / ${data.total}`} />
          <Stat label="正确率" value={`${Math.round(rate * 100)}%`} />
          <Stat label="平均用时" value={`${(data.avgMs / 1000).toFixed(1)}s`} />
          <Stat label="片段长度" value={`${preset.clipSeconds}s`} />
        </dl>

        <p className="mt-3 text-xs text-ink-faint">
          得分 = 答对 100 分 + 最高 100 分的速度奖励（越快越高），每次重听 −10 分。
        </p>
      </header>

      <ol className="mt-9 flex flex-col" style={{ gap: 'calc(10 * var(--u))' }}>
        {data.items.map((item, i) => {
          const ok = item.correct === true
          return (
            <li
              key={item.index}
              className="anim-appear cut-shadow-sm"
              style={{ animationDelay: `${Math.min(i * 35, 500)}ms` }}
            >
              <div
                className="glass-lit flex items-center gap-4 py-3 pr-6"
                style={{ clipPath: ROW_CLIP, paddingLeft: 'calc(34 * var(--u))' }}
              >
                <span
                  aria-hidden
                  className="cut-slant block shrink-0"
                  style={{
                    width: 'calc(8 * var(--u))',
                    height: 'calc(30 * var(--u))',
                    background: item.song.unitColor ?? 'var(--color-primary)',
                    boxShadow: 'inset 0 0 0 1px rgb(0 0 0 / .1)',
                    ['--cut-sm' as string]: 'calc(4 * var(--u))',
                  }}
                />
                <img
                  src={`/thumb/${item.song.id}.webp`}
                  alt=""
                  loading="lazy"
                  className="cut-hex shrink-0"
                  style={{
                    width: 'calc(40 * var(--u))',
                    height: 'calc(40 * var(--u))',
                    objectFit: 'cover',
                    filter: ok ? undefined : 'grayscale(1)',
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="jp-wrap block truncate text-sm font-bold text-ink">
                    {item.song.title}
                  </span>
                  <span className="jp-wrap block truncate text-xs text-ink-faint">
                    {item.chosen && !ok ? `你选了：${item.chosen.title}` : item.song.artist}
                  </span>
                </span>
                <span className="hidden shrink-0 text-right sm:block">
                  {item.elapsedMs !== null && (
                    <span className="latin flex items-center justify-end gap-2 text-xs text-ink-faint">
                      <span>{(item.elapsedMs / 1000).toFixed(1)}s</span>
                      {item.replaysUsed > 0 && (
                        <span className="inline-flex items-center gap-0.5" title="重听次数">
                          <Icon name="replay" size="calc(11 * var(--u))" />
                          {item.replaysUsed}
                        </span>
                      )}
                    </span>
                  )}
                  {ok && item.score !== null && (
                    <span className="latin block text-xs font-semibold text-correct">+{item.score}</span>
                  )}
                </span>
                <span
                  className="shrink-0"
                  role="img"
                  aria-label={ok ? '答对' : '答错'}
                  style={{ color: ok ? 'var(--color-correct)' : 'var(--color-wrong)' }}
                >
                  <Icon name={ok ? 'check' : 'cross'} size="calc(18 * var(--u))" />
                </span>
              </div>
            </li>
          )
        })}
      </ol>

      <div className="mt-10 flex flex-wrap items-center gap-4 pb-12">
        <Button variant="primary" size="lg" onClick={onReplay}>
          再来一局
          <Icon name="replay" size="calc(17 * var(--u))" />
        </Button>
        <Button variant="ghost" size="lg" onClick={onHome}>
          换个难度
        </Button>
      </div>
    </main>
  )
}
