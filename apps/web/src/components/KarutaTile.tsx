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

const CUT = 'calc(14 * var(--u))'
/*
 * 双切角：左上、右下各削一角。
 * 最后那个 `0 ${CUT}` 顶点不能省 —— 省掉之后多边形会直接从左下角 (0,100%)
 * 连回 (CUT,0)，左边就变成一条贯穿全高的斜边，把贴着左缘的组合色条整条裁掉，
 * 只在底部留一个三角。
 */
const TILE_CLIP = `polygon(${CUT} 0, 100% 0, 100% calc(100% - ${CUT}), calc(100% - ${CUT}) 100%, 0 100%, 0 ${CUT})`

/** state → 填色与描边。送り札用粉玫瑰系，与「对错」的红绿分开 —— 那一步是取舍不是判定 */
const TONE: Record<CardState, { bg: string; edge: string; dashed?: boolean }> = {
  idle: { bg: 'var(--color-surface-lit)', edge: 'inset 0 0 0 1px rgb(162 162 192 / .5)' },
  selected: { bg: 'rgb(0 180 240 / .14)', edge: 'inset 0 0 0 2px var(--color-accent-deep)' },
  pending: { bg: 'rgb(0 180 240 / .2)', edge: 'inset 0 0 0 2px var(--color-accent-deep)' },
  sending: { bg: 'rgb(226 102 155 / .2)', edge: 'inset 0 0 0 2px var(--color-sub-rose)' },
  // 1.5px、55% 透明的玫瑰描边对牌面只有 1.01:1 —— 等于没标。
  // 送り札是「从哪些牌里挑」的分区信息，必须一眼分得出可选与不可选。
  sendable: { bg: 'rgb(226 102 155 / .14)', edge: 'inset 0 0 0 2.5px var(--color-rose-ink)' },
  answer: { bg: 'rgb(10 107 80 / .18)', edge: 'inset 0 0 0 2px var(--color-correct)' },
  'answer-missed': { bg: 'rgb(10 107 80 / .07)', edge: 'none', dashed: true },
  mistake: { bg: 'rgb(179 18 58 / .16)', edge: 'inset 0 0 0 2px var(--color-wrong)' },
}

export function KarutaTile({ card, kimariji, state, picks, disabled, enemy, onClick }: Props) {
  if (!card) {
    // 被取走的位置留空 —— 阵形不能重排，否则玩家背下来的位置全废
    return (
      <div
        aria-hidden
        style={{
          minHeight: 'max(44px, calc(62 * var(--u)))',
          clipPath: TILE_CLIP,
          boxShadow: 'inset 0 0 0 1px rgb(162 162 192 / .22)',
        }}
      />
    )
  }

  const unit = card.unitColor ?? 'var(--color-primary)'
  const head = card.title.slice(0, kimariji)
  const tail = card.title.slice(kimariji)
  const tone = TONE[state]

  return (
    <span className="cut-shadow-sm block">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={card.title}
        className="relative flex w-full flex-col justify-center px-2 py-1.5 text-left transition-transform duration-150 enabled:active:scale-[0.97]"
        style={{
          minHeight: 'max(44px, calc(62 * var(--u)))',
          clipPath: TILE_CLIP,
          background: tone.bg,
          boxShadow: tone.dashed
            ? undefined
            : `${tone.edge}${enemy && state === 'idle' ? ', inset 0 0 0 100vmax rgb(97 95 144 / .04)' : ''}`,
          outline: tone.dashed ? '2px dashed var(--color-correct)' : undefined,
          outlineOffset: tone.dashed ? '-2px' : undefined,
        }}
      >
        {/* 组合色：左缘一段。斜切会吃掉左上角，所以从切角下沿起 */}
        <span
          aria-hidden
          className="absolute left-0 block"
          style={{
            top: CUT,
            bottom: 0,
            width: 'calc(5 * var(--u))',
            background: unit,
            boxShadow: 'inset 0 0 0 1px rgb(0 0 0 / .12)',
          }}
        />

        <span
          className="sc-tile-title jp-wrap ml-2"
          style={{ fontSize: 'calc(12.5 * var(--u))', lineHeight: 1.3 }}
        >
          {/* 決まり字：听到这几个字就能锁定这张牌。靠字重与明度，不靠另一种颜色 */}
          <b className="font-bold text-ink">{head}</b>
          <span className="font-normal text-ink-faint">{tail}</span>
        </span>

        {/* 谁点了这张牌、多快、判定如何。两个人可能点同一张，所以是列表 */}
        {picks.length > 0 && (
          <span className="mt-1 ml-2 flex flex-wrap items-center gap-1">
            {picks.map((p) => {
              const ok = GOOD.includes(p.verdict)
              return (
                <span
                  key={p.player}
                  className="latin inline-flex items-center gap-1 px-1 py-[1px] font-semibold"
                  style={{
                    fontSize: 'calc(9 * var(--u))',
                    lineHeight: 1.3,
                    background: ok ? 'rgb(10 107 80 / .16)' : 'rgb(179 18 58 / .16)',
                    color: ok ? 'var(--color-correct)' : 'var(--color-wrong)',
                    boxShadow: p.isMe ? 'inset 0 0 0 1px currentColor' : undefined,
                    clipPath: 'polygon(3px 0, 100% 0, calc(100% - 3px) 100%, 0 100%)',
                  }}
                >
                  {p.label}
                  {p.verdict === 'too_early' ? '抢跑' : `${p.reactionMs}ms`}
                </span>
              )
            })}
          </span>
        )}
      </button>
    </span>
  )
}
