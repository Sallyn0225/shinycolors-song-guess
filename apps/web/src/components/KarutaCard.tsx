import type { CardView, PlayerId, TapVerdict } from '@scg/shared'

/** 落在这张牌上的一次点击 */
export interface CardPick {
  player: PlayerId
  isMe: boolean
  label: string
  reactionMs: number
  verdict: TapVerdict
}

export type CardState =
  /** 平常 */
  | 'idle'
  /** 记忆阶段被选中，等待与另一张交换 */
  | 'selected'
  /** 我已出手，判定未回 */
  | 'pending'
  /** 我挑中要送给对手的牌 */
  | 'sending'
  /** 送り札可选的牌，等我挑 */
  | 'sendable'
  /** 这张就是答案，且被取走了 */
  | 'answer'
  /** 这张是答案，但没人取到 */
  | 'answer-missed'
  /** 有人点错了它 */
  | 'mistake'

interface Props {
  card: CardView | null
  kimariji: number
  state: CardState
  picks: CardPick[]
  disabled: boolean
  enemy: boolean
  onClick: (e: React.MouseEvent) => void
}

const GOOD: TapVerdict[] = ['correct', 'tie', 'clamped']

export function KarutaCard({ card, kimariji, state, picks, disabled, enemy, onClick }: Props) {
  if (!card) {
    // 被取走的位置留空 —— 阵形不能重排，否则玩家背下来的位置全废
    return (
      <div
        aria-hidden
        className="rounded-lg border border-dashed border-[color:var(--color-line)]/50 bg-transparent"
      />
    )
  }

  const stripe = card.unitColor ?? 'var(--color-line-lit)'
  const head = card.title.slice(0, kimariji)
  const tail = card.title.slice(kimariji)

  const tone: Record<CardState, string> = {
    idle: enemy
      ? 'border-[color:var(--color-line)] bg-[#0e1322] hover:border-[color:var(--color-line-lit)]'
      : 'border-[color:var(--color-line)] bg-panel hover:border-[color:var(--color-line-lit)]',
    selected: 'border-[#8ea2ff] bg-[rgba(142,162,255,.12)]',
    pending: 'border-[#8ea2ff] bg-[rgba(142,162,255,.14)] ring-2 ring-[#8ea2ff]/40',
    // 送出去的牌用暖色，和「答案/失误」的红绿分开——这一步不是对错，是取舍
    sending: 'border-[color:var(--color-houkago)] bg-[rgba(250,131,51,.18)] ring-2 ring-[color:var(--color-houkago)]/40',
    sendable:
      'border-[color:var(--color-houkago)]/45 bg-panel hover:border-[color:var(--color-houkago)] hover:bg-[rgba(250,131,51,.10)]',
    answer: 'border-[color:var(--color-correct)] bg-[rgba(61,220,151,.16)]',
    'answer-missed': 'border-dashed border-[color:var(--color-correct)] bg-[rgba(61,220,151,.07)]',
    mistake: 'border-[color:var(--color-wrong)] bg-[rgba(255,77,94,.14)]',
  }

  return (
    <button
      type="button"
      onClick={(e) => onClick(e)}
      disabled={disabled}
      aria-label={card.title}
      className={[
        'relative flex min-h-[46px] flex-col justify-center overflow-hidden rounded-lg border px-2 py-1.5 text-left',
        'transition-[transform,border-color,background-color] duration-150 enabled:active:scale-[0.97]',
        tone[state],
      ].join(' ')}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: stripe, boxShadow: `0 0 8px ${stripe}66` }}
      />

      <span className="jp-wrap ml-1.5 line-clamp-2 text-[11px] leading-[1.35] sm:text-[12.5px]">
        {/* 決まり字：听到这几个字就能锁定这张牌 */}
        <b className="font-black text-[#cfd8ff]">{head}</b>
        <span className="text-muted">{tail}</span>
      </span>

      {/* 谁点了这张牌、多快、判定如何。两个人可能点同一张，所以是列表 */}
      {picks.length > 0 && (
        <span className="mt-1 ml-1.5 flex flex-wrap items-center gap-1">
          {picks.map((p) => {
            const ok = GOOD.includes(p.verdict)
            return (
              <span
                key={p.player}
                className="tnum inline-flex items-center gap-1 rounded px-1 py-[1px] font-mono text-[9px] leading-none"
                style={{
                  background: ok ? 'rgba(61,220,151,.18)' : 'rgba(255,77,94,.18)',
                  color: ok ? 'var(--color-correct)' : 'var(--color-wrong)',
                  outline: p.isMe ? '1px solid currentColor' : 'none',
                }}
              >
                {ok ? '✓' : '✕'}
                {p.label}
                {p.verdict === 'too_early' ? '抢跑' : `${p.reactionMs}ms`}
              </span>
            )
          })}
        </span>
      )}
    </button>
  )
}
