/**
 * 28 位偶像。开场问候语音的署名用它。
 *
 * `id` 同时是三样东西的文件名，改名要三处一起改：
 *   public/greet/<id>.opus  与  .m4a      问候语音
 *   public/idol/<id>.webp                 头像
 *   opening-greeting/<id>.wav             语音源文件
 *
 * 名字用**日文原名**而不是中译。角色名是专有名词，日文原名在中文圈同样通用，
 * 而几个纯假名的名字（あさひ / にちか / はるき / ルカ）没有公认译法，
 * 写中译只会引进一处会被粉丝挑错的地方。这也与站内既有的日文术语一脉相承。
 *
 * `unitColor` 是官方代表色，属于**事实数据不是设计 token**（见 DESIGN.md
 * The Unit-Colour-Is-Data Rule）：只能作头像描边，绝不作文字——#fff68d 在白底上会直接消失。
 * 值抄自 assets/manifest.public.json，与 features/library.ts 同一个取舍：
 * 为一份不会变的静态数据加一次网络往返不划算，代价是需要人工同步。
 * 曲库的组合色若有变动，重新求值：
 *
 *   node -e "require('./assets/manifest.public.json').units.forEach(u=>console.log(u.id,u.color))"
 */

export interface Idol {
  /** 罗马音。语音、头像、源文件三者共用的文件名 */
  id: string
  /** 日文原名 */
  name: string
  /** 所属组合的日文原名 */
  unit: string
  /** 组合官方代表色。只作头像描边 */
  unitColor: string
}

export const IDOLS: readonly Idol[] = [
  // イルミネーションスターズ
  { id: 'mano', name: '櫻木真乃', unit: 'イルミネーションスターズ', unitColor: '#fff68d' },
  { id: 'hiori', name: '風野灯織', unit: 'イルミネーションスターズ', unitColor: '#fff68d' },
  { id: 'meguru', name: '八宮めぐる', unit: 'イルミネーションスターズ', unitColor: '#fff68d' },

  // アンティーカ
  { id: 'kagane', name: '月岡恋鐘', unit: 'アンティーカ', unitColor: '#853998' },
  { id: 'mamimi', name: '田中摩美々', unit: 'アンティーカ', unitColor: '#853998' },
  { id: 'sakuya', name: '白瀬咲耶', unit: 'アンティーカ', unitColor: '#853998' },
  { id: 'yuika', name: '三峰結華', unit: 'アンティーカ', unitColor: '#853998' },
  { id: 'kiriko', name: '幽谷霧子', unit: 'アンティーカ', unitColor: '#853998' },

  // 放課後クライマックスガールズ
  { id: 'kaho', name: '小宮果穂', unit: '放課後クライマックスガールズ', unitColor: '#fa8333' },
  { id: 'chiyoko', name: '園田智代子', unit: '放課後クライマックスガールズ', unitColor: '#fa8333' },
  { id: 'juri', name: '西城樹里', unit: '放課後クライマックスガールズ', unitColor: '#fa8333' },
  { id: 'rinze', name: '杜野凛世', unit: '放課後クライマックスガールズ', unitColor: '#fa8333' },
  { id: 'natsuha', name: '有栖川夏葉', unit: '放課後クライマックスガールズ', unitColor: '#fa8333' },

  // アルストロメリア
  { id: 'amana', name: '大崎甘奈', unit: 'アルストロメリア', unitColor: '#ff699e' },
  { id: 'tenka', name: '大崎甜花', unit: 'アルストロメリア', unitColor: '#ff699e' },
  { id: 'chiyuki', name: '桑山千雪', unit: 'アルストロメリア', unitColor: '#ff699e' },

  // ストレイライト
  { id: 'asahi', name: '芹沢あさひ', unit: 'ストレイライト', unitColor: '#af011c' },
  { id: 'fuyuko', name: '黛冬優子', unit: 'ストレイライト', unitColor: '#af011c' },
  { id: 'mei', name: '和泉愛依', unit: 'ストレイライト', unitColor: '#af011c' },

  // ノクチル
  { id: 'toru', name: '浅倉透', unit: 'ノクチル', unitColor: '#384d98' },
  { id: 'madoka', name: '樋口円香', unit: 'ノクチル', unitColor: '#384d98' },
  { id: 'koito', name: '福丸小糸', unit: 'ノクチル', unitColor: '#384d98' },
  { id: 'hinana', name: '市川雛菜', unit: 'ノクチル', unitColor: '#384d98' },

  // シーズ
  { id: 'nichika', name: '七草にちか', unit: 'シーズ', unitColor: '#008e74' },
  { id: 'mikoto', name: '緋田美琴', unit: 'シーズ', unitColor: '#008e74' },

  // コメティック
  { id: 'haruki', name: '郁田はるき', unit: 'コメティック', unitColor: '#333333' },
  { id: 'luca', name: '斑鳩ルカ', unit: 'コメティック', unitColor: '#333333' },
  { id: 'hana', name: '鈴木羽那', unit: 'コメティック', unitColor: '#333333' },
] as const

export const greetingUrl = (id: string): string => `/greet/${id}.opus`
/** AAC 兜底。Safari 18.4 以前放不了 Ogg Opus */
export const greetingFallbackUrl = (id: string): string => `/greet/${id}.m4a`
export const idolIconUrl = (id: string): string => `/idol/${id}.webp`
