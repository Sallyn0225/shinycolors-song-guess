import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DIFFICULTY_PRESETS,
  KARUTA_DEFAULTS,
  type CardId,
  type CardView,
  type MatchStats,
  type MatchView,
  type PlayerId,
  type RoundResultView,
} from '@scg/shared'

import { socket } from '../net/ws'
import { audio } from '../audio'
import { KarutaCard, type CardPick, type CardState } from '../components/KarutaCard'
import { computeKimariji } from '../features/kimariji'
import { SlotMap } from '../features/karutaBoard'
import { narrateRound } from '../features/narrate'

interface Props {
  /** matchStart 的内容由 App 传下来 —— 本组件挂载时那条消息已经过去了 */
  initialMatch: MatchView
  memorizeEndsAtServer: number
  onExit: () => void
}

type Stage = 'memorize' | 'waiting' | 'live' | 'reveal' | 'over'

const OTHER: Record<PlayerId, PlayerId> = { A: 'B', B: 'A' }
const CLIP_SECONDS = DIFFICULTY_PRESETS[KARUTA_DEFAULTS.difficulty].clipSeconds

export function Karuta({ initialMatch, memorizeEndsAtServer, onExit }: Props) {
  const [match, setMatch] = useState<MatchView | null>(initialMatch)
  const [stage, setStage] = useState<Stage>('memorize')
  const [result, setResult] = useState<RoundResultView | null>(null)
  const [ended, setEnded] = useState<{ winner: PlayerId | null; stats: MatchStats } | null>(null)
  const [memorizeLeft, setMemorizeLeft] = useState<number>(KARUTA_DEFAULTS.memorizeSeconds)
  const [selected, setSelected] = useState<number | null>(null)
  const [locked, setLocked] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  /** 我这一回合点的牌。本地立刻标出来，不等服务端回包 */
  const [myPick, setMyPick] = useState<CardId | null>(null)
  const [rematchVotes, setRematchVotes] = useState<PlayerId[]>([])

  const startedAtCtx = useRef(0)
  const roundNoRef = useRef(0)
  const tappedRef = useRef(false)
  /** roundArm 给的 token/url，roundStart 时要复用同一个已解码的 buffer */
  const armed = useRef<{ roundNo: number; token: string; url: string } | null>(null)
  const slotsRef = useRef<SlotMap | null>(null)
  const enemySlotsRef = useRef<SlotMap | null>(null)
  const [, forceRender] = useState(0)

  const me = match?.you ?? 'A'
  const foe = OTHER[me]

  const cardById = useMemo(() => {
    const m = new Map<CardId, CardView>()
    for (const c of match?.cards ?? []) m.set(c.cardId, c)
    return m
  }, [match])

  // 決まり字只在当前牌场范围内计算 —— 场上只有 24 张，通常 1~3 个字就够
  const kimariji = useMemo(() => {
    const titles = (match?.cards ?? []).filter((c) => c.owner !== null).map((c) => c.title)
    return computeKimariji(titles)
  }, [match])

  const syncSlots = useCallback((m: MatchView) => {
    const you = m.you
    const other = OTHER[you]
    if (!slotsRef.current) slotsRef.current = new SlotMap(KARUTA_DEFAULTS.ownCards, m.layout[you])
    if (!enemySlotsRef.current) enemySlotsRef.current = new SlotMap(KARUTA_DEFAULTS.ownCards, m.layout[other])
    slotsRef.current.sync(m.layout[you])
    enemySlotsRef.current.sync(m.layout[other])
  }, [])

  // ── 消息处理 ─────────────────────────────────────────
  useEffect(() => {
    const off = socket.on((msg) => {
      switch (msg.t) {
        case 'matchStart':
          setMatch(msg.match)
          syncSlots(msg.match)
          setStage('memorize')
          setEnded(null)
          setResult(null)
          break

        case 'stateSync':
          setMatch(msg.match)
          syncSlots(msg.match)
          break

        case 'roundArm': {
          roundNoRef.current = msg.roundNo
          tappedRef.current = false
          armed.current = { roundNo: msg.roundNo, token: msg.clipToken, url: msg.url }
          setResult(null)
          setMyPick(null)
          setStage('waiting')
          // 先把音频完全解码好再回 ready，把下载解码耗时挪出比赛计时之外
          void audio
            .prefetch(msg.clipToken, msg.url)
            .catch(() => {})
            .finally(() => socket.send({ t: 'clipReady', roundNo: msg.roundNo }))
          break
        }

        case 'roundStart': {
          const a = armed.current
          if (!a || a.roundNo !== msg.roundNo) break
          setStage('live')
          setLocked(false)
          // 双方按同步过的时钟换算出同一个起播时刻，
          // 这样比较「相对起播的反应时间」才有意义
          const at = audio.ctxTimeFor(socket.toLocalTime(msg.startAtServerTime))
          void audio
            .play(a.token, a.url, CLIP_SECONDS, at)
            .then(({ startedAtCtxTime }) => {
              startedAtCtx.current = startedAtCtxTime
            })
            .catch(() => {})
          break
        }

        case 'roundResult':
          setResult(msg.result)
          setMatch(msg.match)
          syncSlots(msg.match)
          setStage('reveal')
          audio.stop()
          break

        case 'matchEnd':
          setEnded({ winner: msg.winner, stats: msg.stats })
          setMatch(msg.match)
          setStage('over')
          setRematchVotes([])
          audio.stop()
          break

        case 'rematchState':
          setRematchVotes(msg.votes)
          break

        case 'peer':
          setToast(msg.online ? '对手已重连' : '对手掉线了，等待重连…')
          window.setTimeout(() => setToast(null), 3000)
          break

        default:
          break
      }
    })
    return off
  }, [syncSlots])

  // 初始牌面的槽位要立刻建立，否则第一帧是空的
  useEffect(() => {
    syncSlots(initialMatch)
    forceRender((n) => n + 1)
  }, [initialMatch, syncSlots])

  // 记忆阶段倒计时。按服务器给的结束时刻算，双方看到的秒数一致
  useEffect(() => {
    if (stage !== 'memorize') return
    const endsLocal = socket.toLocalTime(memorizeEndsAtServer)
    const tick = () => setMemorizeLeft(Math.max(0, Math.ceil((endsLocal - Date.now()) / 1000)))
    tick()
    const t = window.setInterval(tick, 250)
    return () => window.clearInterval(t)
  }, [stage, memorizeEndsAtServer])

  // ── 交互 ─────────────────────────────────────────────

  /** 记忆阶段：点 A 再点 B 交换位置。比拖拽简单得多，也天然支持键盘 */
  const onOwnCardClick = (slot: number, e: React.MouseEvent) => {
    if (stage === 'memorize') {
      const slots = slotsRef.current
      if (!slots) return
      if (selected === null) setSelected(slot)
      else {
        slots.swap(selected, slot)
        setSelected(null)
        socket.send({ t: 'layout', order: slots.order })
        forceRender((n) => n + 1)
      }
      return
    }
    tap(slot, false, e)
  }

  const tap = (slot: number, enemy: boolean, e: React.MouseEvent) => {
    if (stage !== 'live' || tappedRef.current || locked) return
    const map = enemy ? enemySlotsRef.current : slotsRef.current
    const cardId = map?.view[slot]
    if (!cardId) return

    // 用「听到的时刻」而不是 currentTime —— 蓝牙耳机有 150~300ms 输出延迟，
    // 用调度时钟会让戴蓝牙的人输掉所有接近的回合
    const reactionMs = audio.reactionMsSince(startedAtCtx.current, e.nativeEvent.timeStamp)
    tappedRef.current = true
    setLocked(true)
    setMyPick(cardId) // 立刻标出来，不等服务端回包
    socket.send({
      t: 'tap',
      roundNo: roundNoRef.current,
      cardId,
      reactionMs: Math.max(0, Math.round(reactionMs ?? 0)),
    })
  }

  /** 这张牌上落了谁的点击。两个人可能点同一张，所以是列表 */
  const picksFor = (cardId: CardId | null): CardPick[] => {
    if (!cardId || !result) return []
    return result.taps
      .filter((t) => t.cardId === cardId)
      .map((t) => ({
        player: t.player,
        isMe: t.player === me,
        label: t.player === me ? '你' : (match?.players[t.player].nickname ?? '对手'),
        reactionMs: t.reactionMs,
        verdict: t.verdict,
      }))
  }

  const cardStateFor = (cardId: CardId | null, slot: number, enemy: boolean): CardState => {
    if (!cardId) return 'idle'
    if (!enemy && stage === 'memorize' && selected === slot) return 'selected'
    // 出手后立刻标出自己选的那张，不等判定回来
    if (stage === 'live' && cardId === myPick) return 'pending'
    if (!result) return 'idle'

    const wasTaken = result.transfers.some((t) => t.cause === 'take' && t.cardId === cardId)
    if (wasTaken) return 'answer'
    // 这张就是答案却没人取到 —— 用虚线绿框告诉玩家「本该点这张」
    if (result.kind === 'field' && !result.winner) {
      const card = cardById.get(cardId)
      if (card && card.songId === result.revealed.songId) return 'answer-missed'
    }
    if (picksFor(cardId).length > 0) return 'mistake'
    return 'idle'
  }

  if (!match) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <p className="text-sm text-faint">等待对局开始…</p>
      </main>
    )
  }

  const left = match.cardsLeft
  const mySlots = slotsRef.current?.view ?? []
  const foeSlots = enemySlotsRef.current?.view ?? []
  const names: Record<PlayerId, string> = {
    A: match.players.A.nickname,
    B: match.players.B.nickname,
  }
  const narration = result ? narrateRound(result, names, me) : null

  const grid = (
    slots: ReadonlyArray<CardId | null>,
    enemy: boolean,
    onClick: (slot: number, e: React.MouseEvent) => void,
  ) => (
    // 领地可能超过 12 张（お手つき / 送り札 会把牌送过来），
    // 固定渲染 12 格会让多出来的牌看不见也点不到
    <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
      {Array.from({ length: Math.max(KARUTA_DEFAULTS.ownCards, slots.length) }, (_, i) => {
        const id = slots[i] ?? null
        const card = id ? (cardById.get(id) ?? null) : null
        return (
          <KarutaCard
            key={i}
            card={card}
            kimariji={card ? (kimariji.get(card.title) ?? 1) : 1}
            state={cardStateFor(id, i, enemy)}
            picks={picksFor(id)}
            enemy={enemy}
            disabled={stage === 'memorize' ? enemy : stage !== 'live' || locked}
            onClick={(e) => onClick(i, e)}
          />
        )
      })}
    </div>
  )

  return (
    // 两个领地尽量拉开 —— 中间那段距离就是歌牌的「场」
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col justify-between px-3 py-3 sm:px-5 sm:py-5">
      {/* ── 敵陣 ───────────────────────────────────────── */}
      <div className="shrink-0">
      <header className="flex items-center gap-3 pb-2">
        <span className="text-xs text-muted">{match.players[foe].nickname}</span>
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: match.players[foe].online ? 'var(--color-correct)' : 'var(--color-wrong)' }}
        />
        <span className="tnum ml-auto font-mono text-lg">{left[foe]}</span>
        {match.players[foe].rttMs != null && (
          <span className="tnum font-mono text-[10px] text-faint">{match.players[foe].rttMs}ms</span>
        )}
      </header>
      {grid(foeSlots, true, (slot, e) => tap(slot, true, e))}
      </div>

      {/* ── 中央 ───────────────────────────────────────── */}
      <section className="mx-auto my-3 flex max-h-[210px] min-h-[110px] w-full max-w-md flex-1 flex-col items-center justify-center gap-1 rounded-xl border border-[color:var(--color-line)] bg-panel/40 px-4 py-4 text-center sm:my-4">
        {stage === 'memorize' &&
          (match.players[me].ready ? (
            <>
              <p className="font-display text-xl font-extrabold text-[#8ea2ff]">已就绪</p>
              <p className="text-[11px] text-muted">
                {match.players[foe].ready
                  ? '双方都好了，即将开始…'
                  : `等待 ${match.players[foe].nickname} 记牌…`}
              </p>
              <p className="tnum mt-1 font-mono text-xs text-faint">
                {memorizeLeft}s 后无论如何都会开始
              </p>
            </>
          ) : (
            <>
              <p className="tnum font-mono text-3xl">{memorizeLeft}</p>
              <p className="text-[11px] text-muted">
                记忆阶段 —— 点两张自陣的牌可以交换位置
                {selected !== null && (
                  <span className="text-[#8ea2ff]">（已选中一张，再点一张交换）</span>
                )}
              </p>
              <button
                type="button"
                onClick={() => socket.send({ t: 'memorizeDone' })}
                className="mt-1 rounded-full border border-[color:var(--color-line-lit)] px-4 py-1 text-[11px] text-muted hover:text-text"
              >
                我记好了
              </button>
            </>
          ))}

        {stage === 'waiting' && <p className="text-xs text-faint">准备下一札…</p>}

        {stage === 'live' && (
          <>
            <p className="font-display text-2xl font-extrabold">
              <span className="prism-text">聴</span>
            </p>
            <p className="text-[11px] text-muted">
              {locked ? '已出手 —— 你选的那张已高亮，等待判定' : '认出来就点对应的牌'}
            </p>
          </>
        )}

        {stage === 'reveal' && result && narration && (
          <>
            <div className="flex items-center gap-2">
              {result.kind === 'karafuda' ? (
                <span className="rounded-md border border-[color:var(--color-houkago)] px-2 py-0.5 text-xs font-bold text-[color:var(--color-houkago)]">
                  空札
                </span>
              ) : (
                <img src={result.revealed.coverUrl} alt="" className="h-8 w-8 rounded object-cover" />
              )}
              <span className="jp-wrap text-sm font-bold">{result.revealed.title}</span>
            </div>
            <p
              className="mt-1 font-display text-lg font-extrabold"
              style={{
                color:
                  narration.tone === 'good'
                    ? 'var(--color-correct)'
                    : narration.tone === 'bad'
                      ? 'var(--color-wrong)'
                      : 'var(--color-text)',
              }}
            >
              {narration.headline}
            </p>
            <p className="text-[11px] text-muted">{narration.detail}</p>
            {result.taps.length === 0 && result.kind === 'field' && (
              <p className="text-[10px] text-faint">正确的那张已用虚线绿框标出</p>
            )}
          </>
        )}

        {stage === 'over' && ended && (
          <>
            <p className="font-display text-3xl font-extrabold">
              {ended.winner === me ? (
                <span className="prism-text">勝ち</span>
              ) : ended.winner ? (
                <span className="text-[color:var(--color-wrong)]">負け</span>
              ) : (
                '引き分け'
              )}
            </p>
            <p className="text-[11px] text-muted">
              {ended.winner
                ? `${match.players[ended.winner].nickname} 先清空自陣（共 ${ended.stats.rounds} 回合）`
                : `${ended.stats.rounds} 回合结束`}
            </p>
          </>
        )}
      </section>

      {/* ── 自陣 ───────────────────────────────────────── */}
      <div className="shrink-0">
      {grid(mySlots, false, onOwnCardClick)}
      <footer className="flex items-center gap-3 pt-2">
        <span className="text-xs text-muted">{match.players[me].nickname}（你）</span>
        <span className="tnum ml-auto font-mono text-lg text-[#8ea2ff]">{left[me]}</span>
        {match.players[me].rttMs != null && (
          <span className="tnum font-mono text-[10px] text-faint">{match.players[me].rttMs}ms</span>
        )}
      </footer>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-lg border border-[color:var(--color-line-lit)] bg-[#1f2b4d] px-4 py-2 text-xs">
          {toast}
        </div>
      )}

      {/* ── 结算 ─────────────────────────────────────── */}
      {stage === 'over' && ended && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-void/88 px-5 backdrop-blur-sm">
          <div className="anim-rise w-full max-w-md rounded-2xl border border-[color:var(--color-line-lit)] bg-panel p-6">
            <div className="prism-flow mb-5 h-px w-16 opacity-80" />
            <p className="font-mono text-[11px] tracking-[0.28em] text-faint uppercase">Match End</p>
            <p className="mt-2 font-display text-4xl font-extrabold">
              {ended.winner === me ? (
                <span className="prism-text">勝ち</span>
              ) : ended.winner ? (
                <span className="text-[color:var(--color-wrong)]">負け</span>
              ) : (
                '引き分け'
              )}
            </p>
            <p className="mt-1 text-sm text-muted">
              {ended.winner
                ? `${names[ended.winner]} 先清空自陣`
                : '对局结束'}
              {' · '}
              {ended.stats.rounds} 回合
            </p>

            <table className="mt-6 w-full text-sm">
              <thead>
                <tr className="text-[10px] tracking-wider text-faint">
                  <th className="pb-2 text-left font-normal"> </th>
                  <th className="pb-2 text-right font-normal">你</th>
                  <th className="pb-2 text-right font-normal">{names[foe]}</th>
                </tr>
              </thead>
              <tbody className="tnum font-mono">
                {[
                  ['剩余自陣', `${left[me]}`, `${left[foe]}`],
                  ['取牌', `${ended.stats.taken[me]}`, `${ended.stats.taken[foe]}`],
                  ['お手つき', `${ended.stats.otetsuki[me]}`, `${ended.stats.otetsuki[foe]}`],
                  [
                    '平均反应',
                    ended.stats.avgReactionMs[me] != null ? `${ended.stats.avgReactionMs[me]}ms` : '—',
                    ended.stats.avgReactionMs[foe] != null ? `${ended.stats.avgReactionMs[foe]}ms` : '—',
                  ],
                ].map(([k, a, b]) => (
                  <tr key={k} className="border-t border-[color:var(--color-line)]">
                    <td className="py-2 font-sans text-xs text-muted">{k}</td>
                    <td className="py-2 text-right">{a}</td>
                    <td className="py-2 text-right text-muted">{b}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* 判定被校正的次数公示出来，靠社交压力而不是封禁 */}
            {(ended.stats.clamped[me] > 0 || ended.stats.clamped[foe] > 0) && (
              <p className="mt-3 rounded-lg border border-[color:var(--color-line)] px-3 py-2 text-[11px] text-faint">
                反应时间被服务端校正：你 {ended.stats.clamped[me]} 次 · {names[foe]}{' '}
                {ended.stats.clamped[foe]} 次。客户端上报的时间若早得不合物理，会被换成服务端自己算的值。
              </p>
            )}

            <div className="mt-6 grid gap-2">
              <button
                type="button"
                onClick={() => socket.send({ t: 'rematch', agree: !rematchVotes.includes(me) })}
                className="rounded-xl border border-[color:var(--color-line-lit)] bg-panel py-3 text-sm font-bold transition-all hover:-translate-y-0.5 hover:bg-panel-lit"
              >
                {rematchVotes.includes(me) ? '已同意再战 —— 点此取消' : '再战一局'}
              </button>
              <p className="text-center text-[11px] text-faint">
                {rematchVotes.includes(me)
                  ? rematchVotes.includes(foe)
                    ? '双方都同意，正在重开…'
                    : `等待 ${names[foe]} 同意…`
                  : rematchVotes.includes(foe)
                    ? `${names[foe]} 已同意，等你点头`
                    : '需要双方都同意才会重开'}
              </p>
              <button
                type="button"
                onClick={onExit}
                className="rounded-xl border border-[color:var(--color-line)] py-3 text-sm text-muted transition-all hover:text-text"
              >
                退出房间
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
