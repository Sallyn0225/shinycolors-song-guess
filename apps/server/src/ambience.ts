import { randomBytes } from 'node:crypto'

import type { Catalog } from './catalog.js'

/**
 * 环境 BGM 的切片凭证。
 *
 * 为什么不能复用 `/api/clip/:sid/:token`：那条路上的 token 挂在**单人对局会话**上，
 * 而 BGM 要在首页 / 大厅 / 房间三屏播，那时候根本没有会话。
 *
 * 与曲库红线的关系（`catalog.ts`：private manifest 永不经 HTTP 暴露）：
 * 这里下发的 token 是纯随机串，与 sliceId 没有任何可推导的关系，映射只活在本进程内存里。
 * 响应体里**没有** songId、曲名、切片 index、时长中的任何一项 ——
 * 客户端只知道「这是一段能放的音频」，积累不出「切片 ↔ 曲目」对照表。
 *
 * 残余风险与判断：有人可以反复调 `mintTracks` 把音频拉一遍，但拿不到任何标签，
 * 而音频内容本身是公开发行的商业音乐，下载原曲比对更省事。
 * 结论是不引入超出曲库既有公开性的新风险。路由层另有一道按 IP 的频率限制，
 * 防的是流量滥用，不是作弊。
 *
 * **不用 HMAC 自包含 token**：那样能免去服务端状态，但等于把 sliceId 编进了
 * 客户端看得见的字符串，密钥一旦泄漏红线直接破。用一张内存表换掉这个风险。
 */

/** 凭证有效期。够放完一整个曲目还有大量余量，又不至于让内存表长期堆积 */
const TTL_MS = 30 * 60_000

/**
 * 内存表容量上限。
 *
 * 长跑进程不能让它无限增长。超限时按**插入顺序**淘汰最早的那批 ——
 * Map 天然保持插入顺序，所以直接删开头即可。
 * 20000 条约等于 5000 个曲目，正常流量下永远碰不到，它只是个防失控的闸。
 */
const MAX_TOKENS = 20_000

/** 一个曲目取几个切片。同曲连播这么多段再换曲，每曲约 45~60 秒 */
const CLIPS_PER_TRACK_MIN = 3
const CLIPS_PER_TRACK_MAX = 4

/** 下发给客户端的曲目。**只有不透明 token，没有任何曲目身份信息** */
export interface AmbienceTrack {
  clips: string[]
}

export class AmbienceStore {
  private readonly tokens = new Map<string, { sliceId: string; expiresAt: number }>()

  constructor(private readonly catalog: Catalog) {}

  /**
   * 铸若干个曲目。
   *
   * 每个曲目是**同一首歌的连续若干个切片**，而不是随机 N 个切片：
   * 后者每 15 秒换一首歌，听感像在刷电台。同曲连播的代价是切片起点本身不连续
   * （实测 30 / 60.5 / 92…），接缝处会有乐句跳变 —— 交叉淡化盖得住爆音，
   * 盖不住调性突变，这是已经权衡过并接受的一侧。
   */
  mintTracks(n: number): AmbienceTrack[] {
    this.sweep()

    const out: AmbienceTrack[] = []
    for (let i = 0; i < n; i++) {
      const track = this.mintOne()
      if (track) out.push(track)
    }
    return out
  }

  private mintOne(): AmbienceTrack | null {
    const songs = this.catalog.songs
    if (songs.length === 0) return null

    const song = songs[Math.floor(Math.random() * songs.length)]
    if (!song || song.slices.length === 0) return null

    // 曲目切片数可能少于 CLIPS_PER_TRACK_MIN（短曲只切得出一两段），按实际有的取
    const want =
      CLIPS_PER_TRACK_MIN +
      Math.floor(Math.random() * (CLIPS_PER_TRACK_MAX - CLIPS_PER_TRACK_MIN + 1))
    const take = Math.min(want, song.slices.length)

    // 按 index 排一遍再取连续窗口 —— catalog 里的顺序不保证就是 index 顺序
    const ordered = [...song.slices].sort((a, b) => a.index - b.index)
    const start = Math.floor(Math.random() * (ordered.length - take + 1))

    const clips = ordered.slice(start, start + take).map((s) => this.mint(s.sliceId))
    return { clips }
  }

  private mint(sliceId: string): string {
    // 与 soloSessions 的一次性 token 同一个规格：16 字节随机 → 32 字符 hex
    const token = randomBytes(16).toString('hex')
    this.tokens.set(token, { sliceId, expiresAt: Date.now() + TTL_MS })
    return token
  }

  /** 过期或不存在一律返回 null，两者对调用方没有区别 */
  sliceIdForToken(token: string): string | null {
    const hit = this.tokens.get(token)
    if (!hit) return null
    if (hit.expiresAt <= Date.now()) {
      this.tokens.delete(token)
      return null
    }
    return hit.sliceId
  }

  /**
   * 清过期 + 压容量。
   *
   * 刻意**不开定时器**（与 `ws/quota.ts` 同一个思路）：在铸新凭证时顺手清，
   * 内存占用就与「最近活跃度」成正比，而不是与「进程活了多久」成正比。
   */
  private sweep(): void {
    const now = Date.now()
    for (const [token, v] of this.tokens) {
      if (v.expiresAt <= now) this.tokens.delete(token)
    }
    // Map 保持插入顺序，超出的部分从最早的开始丢
    let over = this.tokens.size - MAX_TOKENS
    if (over <= 0) return
    for (const token of this.tokens.keys()) {
      this.tokens.delete(token)
      if (--over <= 0) break
    }
  }

  /** 测试用 */
  get size(): number {
    return this.tokens.size
  }
}
