import { useState, type KeyboardEvent } from 'react'
import { DIFFICULTIES, DIFFICULTY_PRESETS, type Difficulty } from '@scg/shared'

import {
  modeView,
  RECENT_MAX,
  SONG_MIN,
  UNIT_MIN,
  unitRanking,
  weakestSongs,
  emptyRecords,
  type Records as RecordsData,
} from '../features/records'
import { unitColor, unitName } from '../features/units'
import { clearRecords, loadRecords } from '../records'
import { sfx } from '../sfx'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { Overlay } from '../ui/Overlay'
import { SectionTitle } from '../ui/SectionTitle'
import { Stat } from '../ui/Stat'

interface Props {
  onBack: () => void
}

export function Records({ onBack }: Props) {
  const [records, setRecords] = useState<RecordsData>(() => loadRecords())
  const [difficulty, setDifficulty] = useState<Difficulty>('easy')
  const [confirmClear, setConfirmClear] = useState(false)

  const allEmpty =
    records.modes.easy.games === 0 && records.modes.hard.games === 0
  const mode = records.modes[difficulty]
  const view = modeView(records, difficulty)
  const ranking = unitRanking(records, difficulty)
  const weakest = weakestSongs(records, difficulty, 5)

  // click 音由 ui/Button 内部前置，这里不再补一声 —— 补了就是两声
  const handleClearConfirm = () => {
    clearRecords()
    setRecords(emptyRecords())
    setConfirmClear(false)
  }

  const handleTabKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const next: Difficulty = difficulty === 'easy' ? 'hard' : 'easy'
      setDifficulty(next)
      sfx.play('click')
      document.getElementById(`tab-${next}`)?.focus()
    }
  }

  return (
    <main
      className="mx-auto w-full px-6 py-8 sm:px-10 sm:py-12"
      style={{ maxWidth: 'var(--page-main)' }}
    >
      {/* 顶部导航行：返回入口与清除战绩 */}
      <div className="anim-appear flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            sfx.play('click')
            onBack()
          }}
          className="tap-line -ml-2.5 inline-flex items-center gap-1.5 text-sm font-semibold text-primary transition-colors hover:text-ink"
        >
          <span aria-hidden className="inline-block rotate-180">
            <Icon name="next" size="1.1em" />
          </span>
          <span>返回首页</span>
        </button>

        {!allEmpty && (
          <button
            type="button"
            onClick={() => {
              sfx.play('click')
              setConfirmClear(true)
            }}
            className="tap-line -mr-2.5 text-xs text-ink-faint transition-colors hover:text-wrong"
          >
            清除本地战绩
          </button>
        )}
      </div>

      <header className="anim-appear mt-4">
        <SectionTitle kana="スコア・キロク" latin="Records" size="md" />
      </header>

      {/* 一级空态：两档都从未打过 */}
      {allEmpty ? (
        <section
          aria-label="战绩空态"
          className="anim-appear glass-lit cut-card mt-8 px-6 py-14 text-center sm:px-10 sm:py-16"
          style={{ ['--cut-lg' as string]: 'calc(16 * var(--u))' }}
        >
          <div className="mx-auto flex h-14 w-14 items-center justify-center text-primary">
            <Icon name="trophy" size="calc(48 * var(--u))" />
          </div>
          <h2 className="sc-title mt-5 text-base font-bold text-ink sm:text-lg">
            暂无本地战绩
          </h2>
          <p
            className="jp-wrap mx-auto mt-3 text-xs leading-relaxed text-ink-sub sm:text-sm"
            style={{ maxWidth: '44ch' }}
          >
            单机完成一局结算后，会自动在此记录最高分、走势、组合正确率与易错曲目。数据全部保存在当前设备中。
          </p>
          <div className="mt-8">
            <Button
              variant="primary"
              size="md"
              onClick={onBack}
            >
              返回首页开局
            </Button>
          </div>
        </section>
      ) : (
        <>
          {/* 简单 / 困难分档切换 */}
          <div
            role="tablist"
            aria-label="难度分档"
            onKeyDown={handleTabKeyDown}
            className="anim-appear mt-6 flex items-center gap-3 sm:gap-4"
          >
            {DIFFICULTIES.map((d) => {
              const active = difficulty === d
              const p = DIFFICULTY_PRESETS[d]
              return (
                <button
                  key={d}
                  role="tab"
                  id={`tab-${d}`}
                  aria-selected={active}
                  aria-controls="panel-records"
                  tabIndex={active ? 0 : -1}
                  type="button"
                  onClick={() => {
                    sfx.play('click')
                    setDifficulty(d)
                  }}
                  className={`cut-shadow-sm flex-1 transition-all ${
                    active ? 'font-bold text-ink' : 'text-ink-sub hover:text-ink'
                  }`}
                >
                  <span
                    className={`cut-slant flex items-center justify-center gap-2 py-2.5 sm:py-3 ${
                      active ? 'glass-lit' : 'glass'
                    }`}
                    style={{
                      boxShadow: active
                        ? 'var(--ring-hairline), inset 0 0 0 1px var(--color-primary)'
                        : 'var(--ring-hairline)',
                      ['--cut-sm' as string]: 'calc(8 * var(--u))',
                    }}
                  >
                    <span lang="ja" className="text-2xs text-primary">
                      {d === 'easy' ? 'イージー' : 'ハード'}
                    </span>
                    <span className="sc-title text-sm sm:text-base">
                      {p.label}模式
                    </span>
                  </span>
                </button>
              )
            })}
          </div>

          <div id="panel-records" role="tabpanel" aria-labelledby={`tab-${difficulty}`}>
            {/* 二级空态：当前档没有打过，但另一档打过 */}
            {view.empty ? (
              <section
                aria-label={`${DIFFICULTY_PRESETS[difficulty].label}模式空态`}
                className="anim-appear glass-lit cut-card mt-6 px-6 py-12 text-center sm:px-8 sm:py-14"
                style={{ ['--cut-lg' as string]: 'calc(16 * var(--u))' }}
              >
                <h2 className="sc-title text-base font-bold text-ink">
                  暂无{DIFFICULTY_PRESETS[difficulty].label}模式记录
                </h2>
                <p className="jp-wrap mx-auto mt-2 text-xs text-ink-sub sm:text-sm">
                  去打一局{DIFFICULTY_PRESETS[difficulty].label}模式，或者切换上方标签查看另一难度。
                </p>
                <div className="mt-6">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={onBack}
                  >
                    开始{DIFFICULTY_PRESETS[difficulty].label}模式
                  </Button>
                </div>
              </section>
            ) : (
              <>
                {/* 1. 数字块 */}
                <section aria-labelledby="heading-stats" className="anim-appear mt-6">
                  <h2 id="heading-stats" className="sr-only">
                    总体数据
                  </h2>
                  <div
                    className="glass-lit cut-card p-5 sm:p-6"
                    style={{ ['--cut-lg' as string]: 'calc(16 * var(--u))' }}
                  >
                    <dl className="grid grid-cols-2 gap-y-6 gap-x-4 sm:grid-cols-4 sm:gap-6">
                      <Stat
                        label="最高分"
                        value={view.bestScore !== null ? view.bestScore : '—'}
                        align="center"
                        size="md"
                      />
                      <Stat
                        label="最低分"
                        value={view.worstScore !== null ? view.worstScore : '—'}
                        align="center"
                        size="md"
                      />
                      <Stat
                        label="场次"
                        value={`${view.games} 局`}
                        align="center"
                        size="md"
                      />
                      <Stat
                        label="总正确率"
                        value={
                          view.accuracy !== null
                            ? `${Math.round(view.accuracy * 100)}%`
                            : '—'
                        }
                        align="center"
                        size="md"
                      />
                    </dl>
                  </div>
                </section>

                {/* 2. 走势带 */}
                <section aria-labelledby="heading-trend" className="anim-appear mt-8">
                  <div className="flex items-baseline justify-between">
                    <h2
                      id="heading-trend"
                      className="text-xs font-semibold text-primary"
                      style={{ letterSpacing: 'var(--tracking-title)' }}
                    >
                      RECENT · 近 {RECENT_MAX} 局得分率走势
                    </h2>
                    <span className="latin text-2xs text-ink-faint">
                      {mode.recent.length} / {RECENT_MAX}
                    </span>
                  </div>

                  <div
                    className="glass-lit cut-card mt-3 p-4 sm:p-5"
                    style={{ ['--cut-lg' as string]: 'calc(16 * var(--u))' }}
                  >
                    <div
                      className="flex w-full flex-nowrap items-end"
                      style={{
                        height: 'calc(64 * var(--u))',
                        minHeight: '52px',
                        gap: 'calc(4 * var(--u))',
                      }}
                      role="img"
                      aria-label={`最近 ${mode.recent.length} 局得分率走势：${mode.recent
                        .map((r, i) => `第 ${i + 1} 局 ${Math.round(r * 100)}%`)
                        .join('，')}`}
                    >
                      {mode.recent.map((rate, i) => {
                        const pct = Math.round(rate * 100)
                        const h = Math.max(8, rate * 100)
                        return (
                          <span
                            key={i}
                            title={`第 ${i + 1} 局：得分率 ${pct}%`}
                            className="cut-slant block min-w-0 flex-1 transition-all"
                            style={{
                              height: `${h}%`,
                              alignSelf: 'flex-end',
                              background: 'var(--color-primary)',
                              boxShadow: 'var(--ring-hairline)',
                              ['--cut-sm' as string]: 'calc(4 * var(--u))',
                            }}
                          />
                        )
                      })}
                    </div>
                  </div>
                </section>

                {/* 3. 组合正确率 */}
                <section aria-labelledby="heading-units" className="anim-appear mt-8">
                  <div className="flex items-baseline justify-between">
                    <h2
                      id="heading-units"
                      className="text-xs font-semibold text-primary"
                      style={{ letterSpacing: 'var(--tracking-title)' }}
                    >
                      UNITS · 组合正确率
                    </h2>
                    <span className="text-2xs text-ink-faint">
                      样本阈值 ≥ {UNIT_MIN} 题
                    </span>
                  </div>

                  <div
                    className="glass-lit cut-card mt-3 p-4 sm:p-5"
                    style={{ ['--cut-lg' as string]: 'calc(16 * var(--u))' }}
                  >
                    {/*
                      用 ul/li 而不是 role="table" + role="row"：table 角色要求每一行里
                      有 cell/gridcell 子元素，这里没有，那是一棵读屏软件走不通的树。
                      每行的读数（百分比、n/m、样本不足、最高/最低标记）本来就都是可读文本，
                      列表语义已经够用，不必再给行挂 aria-label 把它们盖掉。
                    */}
                    <ul
                      aria-label="组合正确率排行"
                      className="flex flex-col gap-3 sm:gap-3.5"
                    >
                      {ranking.map((row) => {
                        const pct = Math.round(row.rate * 100)
                        return (
                          <li
                            key={row.id}
                            className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4"
                          >
                            {/* 左侧（桌面）/ 顶行（移动端）：色标 + 组合名 + 标记 + 移动端读数 */}
                            <div className="flex items-center justify-between sm:w-48 sm:shrink-0">
                              <div className="flex min-w-0 items-center gap-2">
                                <span
                                  aria-hidden
                                  className="cut-slant block shrink-0"
                                  style={{
                                    width: 'calc(8 * var(--u))',
                                    height: 'calc(18 * var(--u))',
                                    background: row.color,
                                    boxShadow: 'var(--ring-hairline)',
                                    ['--cut-sm' as string]: 'calc(3 * var(--u))',
                                  }}
                                />
                                <span
                                  lang="ja"
                                  className="jp-wrap truncate text-xs font-semibold text-ink"
                                  title={row.name}
                                >
                                  {row.name}
                                </span>
                                {row.isHighest && (
                                  <span
                                    className="cut-slant shrink-0 px-1.5 py-0.5 text-2xs font-bold text-correct"
                                    style={{
                                      background: 'var(--surface-correct)',
                                      boxShadow: 'inset 0 0 0 1px var(--color-correct)',
                                      ['--cut-sm' as string]: 'calc(2 * var(--u))',
                                    }}
                                  >
                                    最高
                                  </span>
                                )}
                                {row.isLowest && (
                                  <span
                                    className="cut-slant shrink-0 px-1.5 py-0.5 text-2xs font-bold text-wrong"
                                    style={{
                                      background: 'var(--surface-alert)',
                                      boxShadow: 'inset 0 0 0 1px var(--color-wrong)',
                                      ['--cut-sm' as string]: 'calc(2 * var(--u))',
                                    }}
                                  >
                                    最低
                                  </span>
                                )}
                              </div>

                              {/* 移动端读数，桌面隐藏（桌面由右侧列显示） */}
                              <div className="shrink-0 text-right sm:hidden">
                                {row.enough ? (
                                  <span className="latin text-xs font-bold text-ink">
                                    {pct}%{' '}
                                    <span className="text-2xs font-normal text-ink-faint">
                                      ({row.correct}/{row.seen})
                                    </span>
                                  </span>
                                ) : (
                                  <span className="latin text-2xs text-ink-faint">
                                    样本不足 ({row.seen}/{UNIT_MIN})
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* 轨道与填充条 */}
                            <div className="relative flex h-3.5 sm:h-5 min-w-0 flex-1 items-center overflow-hidden">
                              <div
                                className="cut-slant relative h-full w-full"
                                style={{
                                  background: 'rgb(162 162 192 / .15)',
                                  boxShadow: 'inset 0 0 0 1px rgb(0 0 0 / .05)',
                                  ['--cut-sm' as string]: 'calc(3 * var(--u))',
                                }}
                              >
                                {row.enough ? (
                                  <span
                                    className="cut-slant block h-full transition-all duration-300"
                                    style={{
                                      width: `${Math.max(4, pct)}%`,
                                      background: row.color,
                                      boxShadow: 'var(--ring-hairline)',
                                      ['--cut-sm' as string]: 'calc(3 * var(--u))',
                                    }}
                                  />
                                ) : (
                                  <span
                                    className="hidden sm:flex h-full items-center px-2 text-2xs text-ink-faint"
                                    style={{ letterSpacing: 'var(--tracking-tight)' }}
                                  >
                                    样本不足 ({row.seen}/{UNIT_MIN})
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* 桌面读数，移动端隐藏 */}
                            <div className="hidden sm:block sm:w-16 sm:shrink-0 sm:text-right">
                              {row.enough ? (
                                <>
                                  <div className="latin text-xs font-bold text-ink">
                                    {pct}%
                                  </div>
                                  <div className="latin text-2xs text-ink-faint">
                                    {row.correct}/{row.seen}
                                  </div>
                                </>
                              ) : (
                                <span className="latin text-2xs text-ink-faint">
                                  {row.seen} 题
                                </span>
                              )}
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                </section>

                {/* 4. 易错曲目榜 */}
                <section aria-labelledby="heading-songs" className="anim-appear mt-8">
                  <div className="flex items-baseline justify-between">
                    <h2
                      id="heading-songs"
                      className="text-xs font-semibold text-primary"
                      style={{ letterSpacing: 'var(--tracking-title)' }}
                    >
                      WEAKEST · 易错曲目榜
                    </h2>
                    <span className="text-2xs text-ink-faint">
                      上榜阈值 ≥ {SONG_MIN} 次
                    </span>
                  </div>

                  {weakest.length === 0 ? (
                    <div
                      className="glass-lit cut-card mt-3 p-6 text-center text-xs text-ink-faint sm:p-8"
                      style={{ ['--cut-lg' as string]: 'calc(16 * var(--u))' }}
                    >
                      <p className="font-semibold text-ink-sub">
                        暂无达到上榜阈值的易错曲目
                      </p>
                      <p className="jp-wrap mx-auto mt-1.5 text-ink-faint" style={{ maxWidth: '44ch' }}>
                        曲库规模共 243 首，每首曲目需至少作答 {SONG_MIN} 次后才会计入易错榜。多打几局后便会在此显示。
                      </p>
                    </div>
                  ) : (
                    <ol className="mt-3 flex flex-col gap-2.5">
                      {weakest.map((song) => {
                        const unitClr = song.unit
                          ? unitColor(song.unit)
                          : 'var(--color-primary)'
                        const pct = Math.round(song.rate * 100)
                        return (
                          <li
                            key={song.id}
                            className="glass-lit cut-card-sm flex items-center gap-3 py-2.5 px-3 sm:gap-4 sm:px-4"
                            style={{ ['--cut-md' as string]: 'calc(10 * var(--u))' }}
                          >
                            <span
                              aria-hidden
                              className="cut-slant block shrink-0"
                              style={{
                                width: 'calc(6 * var(--u))',
                                height: 'calc(28 * var(--u))',
                                background: unitClr,
                                boxShadow: 'var(--ring-hairline)',
                                ['--cut-sm' as string]: 'calc(3 * var(--u))',
                              }}
                            />
                            <img
                              src={`/thumb/${song.id}.webp`}
                              alt=""
                              loading="lazy"
                              className="cut-hex shrink-0"
                              style={{
                                width: 'calc(36 * var(--u))',
                                height: 'calc(36 * var(--u))',
                                objectFit: 'cover',
                              }}
                            />
                            <div className="min-w-0 flex-1">
                              <span
                                lang="ja"
                                className="jp-wrap block truncate text-sm font-bold text-ink"
                              >
                                {song.title}
                              </span>
                              <span className="block text-2xs text-ink-faint">
                                {song.unit ? (
                                  <span lang="ja">{unitName(song.unit)}</span>
                                ) : (
                                  '全体 / 独立曲'
                                )}
                              </span>
                            </div>
                            <div className="shrink-0 text-right">
                              <div className="latin text-xs font-bold text-wrong">
                                正确率 {pct}%
                              </div>
                              <div className="latin text-2xs text-ink-faint">
                                出题 {song.seen} · 错 {song.seen - song.correct}
                              </div>
                            </div>
                          </li>
                        )
                      })}
                    </ol>
                  )}
                </section>

                {/* 底部返回操作 */}
                <div className="anim-appear mt-10 flex justify-center sm:mt-12">
                  <Button
                    variant="quiet"
                    size="md"
                    onClick={onBack}
                  >
                    返回首页
                  </Button>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* 清除本地战绩二次确认弹窗 */}
      {confirmClear && (
        <Overlay label="确认清除本地战绩">
          <div
            className="cut-shadow-lg mx-auto w-full max-w-sm"
            style={{ maxHeight: '90dvh', overflowY: 'auto' }}
          >
            <div
              className="glass-lit cut-card p-6 sm:p-7"
              style={{ ['--cut-lg' as string]: 'calc(16 * var(--u))' }}
            >
              <div className="flex items-center gap-2 text-wrong">
                <Icon name="warn" size="1.3em" />
                <h3 className="text-base font-bold text-ink">确认清除本地战绩？</h3>
              </div>
              <p className="jp-wrap mt-3 text-xs leading-relaxed text-ink-sub">
                保存在当前设备上的简单与困难模式单机战绩（最高分、走势、组合正确率与易错曲目）将被彻底清空，无法恢复。
              </p>
              <div className="mt-6 flex items-center justify-end gap-3">
                <Button variant="quiet" size="sm" onClick={() => setConfirmClear(false)}>
                  取消
                </Button>
                {/*
                  破坏性动作的红色由标题的 warn 图标与 text-wrong 承担，不给按钮加内联底色：
                  Button 的 style 写在 {...rest} 之后，传进去的 background 会被它自己的
                  minHeight + variant 底色整块覆盖 —— 写了也不生效，只会留下一处骗人的代码。
                */}
                <Button variant="primary" size="sm" onClick={handleClearConfirm}>
                  确认清空
                </Button>
              </div>
            </div>
          </div>
        </Overlay>
      )}
    </main>
  )
}
