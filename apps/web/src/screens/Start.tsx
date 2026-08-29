import { useState } from 'react'
import { DIFFICULTY_PRESETS, DIFFICULTIES, type Difficulty } from '@scg/shared'

interface Props {
  onStart: (d: Difficulty) => void
  onVersus: () => void
  busy: boolean
  error: string | null
}

const BLURB: Record<Difficulty, string> = {
  easy: '片段够长，干扰项来自不同组合。适合先摸清曲库。',
  hard: '片段更短、时限更紧，四个选项全是同组合或曲名相近的曲子。',
}

export function Start({ onStart, onVersus, busy, error }: Props) {
  const [hover, setHover] = useState<Difficulty | null>(null)

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col justify-center px-6 py-16">
      <header className="anim-rise">
        <div className="prism-flow mb-8 h-px w-24 opacity-80" />
        <p className="font-mono text-[11px] tracking-[0.32em] text-faint uppercase">
          The iDOLM@STER Shiny Colors
        </p>
        <h1 className="mt-3 font-display text-5xl leading-[1.08] font-extrabold sm:text-6xl">
          伴奏で、
          <br />
          <span className="prism-text">曲を当てる。</span>
        </h1>
        <p className="jp-wrap mt-5 max-w-md text-sm leading-relaxed text-muted">
          听一段没有人声的伴奏，认出它是哪首歌。曲库收录 234 首 off vocal 音源。
        </p>
      </header>

      <section className="mt-12 grid gap-3 sm:grid-cols-2" aria-label="选择难度">
        {DIFFICULTIES.map((d, i) => {
          const p = DIFFICULTY_PRESETS[d]
          const lit = hover === d
          return (
            <button
              key={d}
              type="button"
              disabled={busy}
              onClick={() => onStart(d)}
              onMouseEnter={() => setHover(d)}
              onMouseLeave={() => setHover(null)}
              className={[
                'anim-rise group relative overflow-hidden rounded-2xl border bg-panel p-6 text-left',
                'transition-all duration-300 disabled:opacity-50',
                lit
                  ? 'border-[color:var(--color-line-lit)] -translate-y-1 bg-panel-lit'
                  : 'border-[color:var(--color-line)]',
              ].join(' ')}
              style={{ animationDelay: `${140 + i * 90}ms` }}
            >
              <span
                aria-hidden
                className="prism-flow absolute inset-x-0 top-0 h-[2px] transition-opacity duration-300"
                style={{ opacity: lit ? 1 : 0.25 }}
              />
              <span className="flex items-baseline gap-3">
                <span className="font-display text-3xl font-extrabold">{p.label}</span>
                <span className="tnum font-mono text-xs text-faint">{p.questionCount} 题</span>
              </span>
              <span className="jp-wrap mt-3 block text-[13px] leading-relaxed text-muted">{BLURB[d]}</span>

              <dl className="mt-5 grid grid-cols-3 gap-2 border-t border-[color:var(--color-line)] pt-4">
                {[
                  ['片段', `${p.clipSeconds}s`],
                  ['限时', `${p.answerSeconds}s`],
                  ['重听', `${p.replays} 次`],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[10px] tracking-wider text-faint">{k}</dt>
                    <dd className="tnum mt-0.5 font-mono text-sm text-text">{v}</dd>
                  </div>
                ))}
              </dl>
            </button>
          )
        })}
      </section>

      <button
        type="button"
        onClick={onVersus}
        className="anim-rise group relative mt-3 overflow-hidden rounded-2xl border border-[color:var(--color-line)] bg-panel p-5 text-left transition-all duration-300 hover:-translate-y-1 hover:border-[color:var(--color-line-lit)] hover:bg-panel-lit"
        style={{ animationDelay: '320ms' }}
      >
        <span aria-hidden className="prism-flow absolute inset-y-0 left-0 w-[3px]" />
        <span className="flex items-baseline gap-3">
          <span className="font-display text-2xl font-extrabold">1v1 对战</span>
          <span className="font-mono text-[11px] tracking-widest text-faint">空札領地戦</span>
        </span>
        <span className="jp-wrap mt-2 block text-[13px] leading-relaxed text-muted">
          日本竞技歌牌的规则：抢牌、送り札、お手つき，外加从 234 首曲库里抽出的「空札」——
          只会被播放、场上没有对应的牌。先清空自陣者胜。
        </span>
      </button>

      {error && (
        <p role="alert" className="mt-6 rounded-lg border border-[color:var(--color-wrong)] bg-[rgba(255,77,94,.08)] px-4 py-3 text-sm">
          {error}
        </p>
      )}

      <p className="anim-rise mt-10 text-xs text-faint" style={{ animationDelay: '340ms' }}>
        点击难度即开始 —— 浏览器需要一次点击才允许播放音频。建议戴耳机；蓝牙耳机会有约 0.2 秒延迟。
      </p>
    </main>
  )
}
