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
   * 图上就会出现「高山祐介」配「精進」这种自相矛盾的组合。
   */
  stamp: string
}

/**
 * 单机段位，按**得分率**而不是正确率分。
 *
 * 得分里已经含了速度奖励与重听扣分，所以同样答对 8/10，秒答的和磨到最后一秒
 * 才点的不会拿到同一个称号——正确率看不出这个差别。
 *
 * 这条梯子描述的是「你有多熟这个曲库」的纵向成长，用的是闪友之间的黑话，
 * 不是正经段位名——两头（最高与最低）故意用梗，中间三档保持能读懂的直述。
 */
export const SOLO_TIERS: readonly (Tier & { min: number })[] = [
  { min: 0.95, id: 'omniscient', title: '高山祐介', blurb: '没关就是开了？', emote: 'starry', stamp: '完璧' },
  { min: 0.85, id: 'ace', title: '七草はづき', blurb: '瑕不掩瑜，鉴定为铁血闪友', emote: 'grin', stamp: '優秀' },
  { min: 0.7, id: 'veteran', title: '合格闪友', blurb: '大部分经典曲难不倒你，少部分冷门曲也合情合理', emote: 'smile', stamp: '合格' },
  { min: 0.5, id: 'apprentice', title: '一般通过闪友', blurb: '熟悉程度不上不下，至少算是及格了', emote: 'neutral', stamp: '及第' },
  { min: 0.25, id: 'rookie', title: '小资历', blurb: '听过闪，但只是听过', emote: 'sweat', stamp: '精進' },
  { min: 0, id: 'newcomer', title: '闪奸？', blurb: '说实在的，你是拉拉派来的吗', emote: 'blank', stamp: '初参' },
]

export function soloTier(score: number, maxScore: number): Tier {
  // maxScore 为 0 的局（题目全被跳过等）不该除出 NaN 或 Infinity，按最低段处理
  const rate = maxScore > 0 ? score / maxScore : 0
  // 从高到低取第一个够得着的段，边界值归上一段（0.95 分 → 高山祐介）
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
 * 联机段位。**不**套用单机那条闪友梯子——单机描述「你有多熟这个曲库」，
 * 联机描述「这一局打成什么样」，两者混用会让称号失去含义
 * （拿到「合格闪友」却是因为对面掉线，读起来毫无信息）。
 *
 * 顺序即优先级，自上而下第一个命中者胜出。
 */
export const VERSUS_TIERS: readonly (Tier & { match: (v: VersusInput) => boolean })[] = [
  {
    id: 'perfect',
    title: '秒杀',
    blurb: '还没发力呢，怎么就赢了啊',
    emote: 'starry',
    stamp: '完勝',
    match: (v) => v.outcome === 'win' && v.otetsuki === 0 && v.margin >= 5,
  },
  {
    id: 'clean',
    title: '完璧无瑕',
    blurb: '干净利落的拍牌',
    emote: 'grin',
    stamp: '無傷',
    match: (v) => v.outcome === 'win' && v.otetsuki === 0,
  },
  {
    id: 'dominant',
    title: '手拿把掐',
    blurb: '闪彩猜歌界的Goat',
    emote: 'grin',
    stamp: '圧勝',
    match: (v) => v.outcome === 'win' && v.margin >= 5,
  },
  {
    id: 'narrow',
    title: '拿下',
    blurb: '别管错的和对面牌数 你就说赢了没吧',
    emote: 'smile',
    stamp: '辛勝',
    match: (v) => v.outcome === 'win',
  },
  {
    id: 'drawn',
    title: '难舍难分',
    blurb: '你们不要再打啦',
    emote: 'neutral',
    stamp: '引分',
    match: (v) => v.outcome === 'draw',
  },
  {
    id: 'close',
    title: '可惜兄弟可惜',
    blurb: 'Maybe not today',
    emote: 'sweat',
    stamp: '惜敗',
    match: (v) => v.outcome === 'loss' && v.margin <= 2,
  },
  {
    id: 'defeat',
    title: '流脓了',
    blurb: '你的裤子里，是汗，还是尿啊',
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
 * 正式资源路径。文件在 `apps/web/public/emote/`，换图只要覆盖同名文件，不用动代码。
 * 拿不到时（漏传、缓存失效）调用方回退到 {@link emotePlaceholderSvg}。
 */
export function emoteAssetUrl(id: EmoteId): string {
  return `/emote/${id}.webp`
}

/** 各段位表情的眉眼嘴。正式图已在 public/emote/，这段只在它加载失败时兜底 */
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
 * 正式图哪天没跟着发上去，缺图也不该让网页或战报出现破图。
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
