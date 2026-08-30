/**
 * 成绩段位。结算页网页与导出战报**共用这一份**——两处各写一套文案，
 * 改一处忘一处之后，同一局在页面上和图上会显示不同的称号，而且没有任何东西会报错。
 *
 * 纯逻辑：不 import React、不碰 DOM（表情占位只生成字符串，画不画由调用方决定）。
 */

/** 表情图 id。正式资源与占位共用这套命名 */
export type EmoteId = 'starry' | 'grin' | 'smile' | 'neutral' | 'sweat' | 'blank'

export interface Tier {
  id: string
  /** 称号 */
  title: string
  /** 一句评价 */
  blurb: string
  emote: EmoteId
  /**
   * 战报印章中央的二字判定。放在段位表里而不是画图时另算，
   * 是因为印章和称号说的是同一件事——分成两处写，改了称号忘了印章，
   * 图上就会出现「全知全能P」配「精進」这种自相矛盾的组合。
   */
  stamp: string
}

/**
 * 单机段位，按**得分率**而不是正确率分。
 *
 * 得分里已经含了速度奖励与重听扣分，所以同样答对 8/10，秒答的和磨到最后一秒
 * 才点的不会拿到同一个称号——正确率看不出这个差别。
 *
 * 「P」是プロデューサー：这条梯子描述的是「你有多熟这个曲库」的纵向成长。
 */
export const SOLO_TIERS: readonly (Tier & { min: number })[] = [
  { min: 0.95, id: 'omniscient', title: '全知全能P', blurb: '前奏的呼吸你都记得', emote: 'starry', stamp: '完璧' },
  { min: 0.85, id: 'ace', title: '首席担当', blurb: '几乎没有你听不出的曲子', emote: 'grin', stamp: '優秀' },
  { min: 0.7, id: 'veteran', title: '资深P', blurb: '熟得很，只在冷门曲上栽跟头', emote: 'smile', stamp: '合格' },
  { min: 0.5, id: 'apprentice', title: '见习P', blurb: '主打曲稳，深挖曲还差点火候', emote: 'neutral', stamp: '及第' },
  { min: 0.25, id: 'rookie', title: '新人P', blurb: '听过，但名字对不上号', emote: 'sweat', stamp: '精進' },
  { min: 0, id: 'newcomer', title: '初见P', blurb: '从今天开始认识她们', emote: 'blank', stamp: '初参' },
]

export function soloTier(score: number, maxScore: number): Tier {
  // maxScore 为 0 的局（题目全被跳过等）不该除出 NaN 或 Infinity，按最低段处理
  const rate = maxScore > 0 ? score / maxScore : 0
  // 从高到低取第一个够得着的段，边界值归上一段（0.95 分 → 全知全能P）
  return SOLO_TIERS.find((t) => rate >= t.min) ?? SOLO_TIERS[SOLO_TIERS.length - 1]!
}

export type Outcome = 'win' | 'draw' | 'loss'

export interface VersusInput {
  outcome: Outcome
  /** 自己的お手つき次数 */
  otetsuki: number
  /** 剩余自陣差的绝对值 */
  margin: number
}

/**
 * 联机段位。**不**套用单机那条 P 梯子——单机描述「你有多熟这个曲库」，
 * 联机描述「这一局打成什么样」，两者混用会让称号失去含义
 * （拿到「资深P」却是因为对面掉线，读起来毫无信息）。
 *
 * 顺序即优先级，自上而下第一个命中者胜出。
 */
export const VERSUS_TIERS: readonly (Tier & { match: (v: VersusInput) => boolean })[] = [
  {
    id: 'perfect',
    title: '完全制圧',
    blurb: '零误札，对面全程没摸到节奏',
    emote: 'starry',
    stamp: '完勝',
    match: (v) => v.outcome === 'win' && v.otetsuki === 0 && v.margin >= 5,
  },
  {
    id: 'clean',
    title: '无瑕担当',
    blurb: '一次误札都没有，干净',
    emote: 'grin',
    stamp: '無傷',
    match: (v) => v.outcome === 'win' && v.otetsuki === 0,
  },
  {
    id: 'dominant',
    title: '压倒性胜利',
    blurb: '对面还没进入状态就结束了',
    emote: 'grin',
    stamp: '圧勝',
    match: (v) => v.outcome === 'win' && v.margin >= 5,
  },
  {
    id: 'narrow',
    title: '险胜',
    blurb: '就差那半张札，赢了就是赢了',
    emote: 'smile',
    stamp: '辛勝',
    match: (v) => v.outcome === 'win',
  },
  {
    id: 'drawn',
    title: '平分秋色',
    blurb: '再来一局才知道谁更强',
    emote: 'neutral',
    stamp: '引分',
    match: (v) => v.outcome === 'draw',
  },
  {
    id: 'close',
    title: '惜败',
    blurb: '只差一点点，别急着走',
    emote: 'sweat',
    stamp: '惜敗',
    match: (v) => v.outcome === 'loss' && v.margin <= 2,
  },
  {
    id: 'defeat',
    title: '修行中',
    blurb: '记牌的时间还不够长',
    emote: 'blank',
    stamp: '精進',
    match: () => true,
  },
]

export function versusTier(input: VersusInput): Tier {
  return VERSUS_TIERS.find((t) => t.match(input)) ?? VERSUS_TIERS[VERSUS_TIERS.length - 1]!
}

// ─────────────────────────────────────────────────────────
// 表情图
// ─────────────────────────────────────────────────────────

/**
 * 正式资源路径。把文件放进 `apps/web/public/emote/` 就自动生效，不用动代码。
 * 拿不到时调用方回退到 {@link emotePlaceholderSvg}。
 */
export function emoteAssetUrl(id: EmoteId): string {
  return `/emote/${id}.webp`
}

/** 各段位表情的眉眼嘴。占位素材，正式图到位后这段只是兜底 */
const FACES: Record<EmoteId, { eyes: string; mouth: string; extra: string }> = {
  starry: {
    eyes: '<path d="M22 27l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.5 5-.7z"/><path d="M42 27l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.5 5-.7z"/>',
    mouth: '<path d="M23 44c3.6 6 13.4 6 17 0" fill="none" stroke-width="3.2" stroke-linecap="round"/>',
    extra: '<path d="M53 14l1.5 3.6 3.6 1.5-3.6 1.5L53 24l-1.5-3.4-3.6-1.5 3.6-1.5z"/>',
  },
  grin: {
    eyes: '<path d="M17 33c2.5-4.5 8.5-4.5 11 0" fill="none" stroke-width="3.2" stroke-linecap="round"/><path d="M36 33c2.5-4.5 8.5-4.5 11 0" fill="none" stroke-width="3.2" stroke-linecap="round"/>',
    mouth: '<path d="M21 42c4 8 18 8 22 0z"/>',
    extra: '',
  },
  smile: {
    eyes: '<circle cx="23" cy="32" r="3.2"/><circle cx="41" cy="32" r="3.2"/>',
    mouth: '<path d="M24 43c3.2 4.6 12.8 4.6 16 0" fill="none" stroke-width="3.2" stroke-linecap="round"/>',
    extra: '',
  },
  neutral: {
    eyes: '<circle cx="23" cy="32" r="3.2"/><circle cx="41" cy="32" r="3.2"/>',
    mouth: '<path d="M25 44h14" fill="none" stroke-width="3.2" stroke-linecap="round"/>',
    extra: '',
  },
  sweat: {
    eyes: '<path d="M18 30c2.6 2 7.4 2 10 0" fill="none" stroke-width="3" stroke-linecap="round"/><path d="M36 30c2.6 2 7.4 2 10 0" fill="none" stroke-width="3" stroke-linecap="round"/>',
    mouth: '<path d="M25 46c3.2-4 12.8-4 16 0" fill="none" stroke-width="3.2" stroke-linecap="round"/>',
    extra: '<path d="M52 20c0 0-4.5 6-4.5 8.6a4.5 4.5 0 009 0C56.5 26 52 20 52 20z" opacity=".55"/>',
  },
  blank: {
    eyes: '<path d="M18 32h9" fill="none" stroke-width="3.2" stroke-linecap="round"/><path d="M37 32h9" fill="none" stroke-width="3.2" stroke-linecap="round"/>',
    mouth: '<circle cx="32" cy="45" r="3.4" fill="none" stroke-width="3"/>',
    extra: '',
  },
}

/**
 * 占位表情，简笔画。做成 data URI 而不是文件，是为了它**永远不会 404**——
 * 正式图还没做出来的这段时间里，缺图不该让网页或战报出现破图。
 *
 * 返回值可直接喂给 `<img src>` 或 `new Image().src`。
 */
export function emotePlaceholderSvg(id: EmoteId, color = '#2b2c5e'): string {
  const f = FACES[id]
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">` +
    `<g fill="${color}" stroke="${color}">` +
    `<circle cx="32" cy="34" r="25" fill="none" stroke-width="3"/>` +
    f.eyes +
    f.mouth +
    f.extra +
    `</g></svg>`
  // encodeURIComponent 而不是 base64：体积更小，且出问题时能直接读出来
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
