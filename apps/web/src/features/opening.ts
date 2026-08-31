/**
 * 开场的纯逻辑：选人、以及环境 BGM 的播放游标。
 *
 * 放在 features/ 是因为这里**一点副作用都没有** —— 不碰 AudioContext、不碰 DOM、
 * 不读 localStorage。有状态的那一半在 `src/ambience.ts`，它持有下面这个 Playlist
 * 并调用这里的纯函数推进。这样换曲逻辑可以直接对着数据测，不必起一个音频引擎。
 */

import { IDOLS, type Idol } from './idols.js'

/**
 * 随机选一位来问候。
 *
 * `exclude` 是上一次选中的人：连着两次刷新撞上同一个人，观感是「随机坏了」，
 * 而 1/28 的重复概率在真实使用里一天能撞上好几回。排除掉上一位之后，
 * 池子仍有 27 人，随机性肉眼无损。
 */
export function pickIdol(exclude?: string): Idol {
  const pool = IDOLS.filter((i) => i.id !== exclude)
  // exclude 传了个不认识的 id 时 pool 就是全量，仍然可用；只有 IDOLS 为空才会走空
  const list = pool.length > 0 ? pool : IDOLS
  return list[Math.floor(Math.random() * list.length)] as Idol
}

/** 服务端下发的曲目：同一首歌的连续若干个切片，只有不透明 token */
export interface AmbienceTrack {
  clips: string[]
}

/** BGM 的播放游标。指向「第几个曲目的第几段」 */
export interface Playlist {
  tracks: AmbienceTrack[]
  track: number
  clip: number
}

export function createPlaylist(tracks: AmbienceTrack[]): Playlist {
  return { tracks, track: 0, clip: 0 }
}

/** 当前该播的 token。游标越界或列表为空时返回 null */
export function currentClip(p: Playlist): string | null {
  return p.tracks[p.track]?.clips[p.clip] ?? null
}

/**
 * 推进一格。
 *
 * 先在曲目内走完全部切片（这就是「同一首歌连播 3~4 段」），走完再跳下一个曲目。
 * 全部曲目播完时返回 null —— 调用方据此去续取新的一批，而不是从头循环：
 * 循环同一批曲目的话，在首页多待几分钟就会听出来「怎么又是这几首」。
 */
export function advance(p: Playlist): Playlist | null {
  const track = p.tracks[p.track]
  if (!track) return null

  if (p.clip + 1 < track.clips.length) return { ...p, clip: p.clip + 1 }
  if (p.track + 1 < p.tracks.length) return { ...p, track: p.track + 1, clip: 0 }
  return null
}

/** 还剩几段没播。用来决定「什么时候该去续取下一批」，不必等到播空 */
export function remaining(p: Playlist): number {
  let n = -p.clip
  for (let i = p.track; i < p.tracks.length; i++) n += p.tracks[i]?.clips.length ?? 0
  return Math.max(0, n)
}
