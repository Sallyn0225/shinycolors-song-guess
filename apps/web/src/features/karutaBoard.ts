import type { CardId } from '@scg/shared'

/**
 * 稳定槽位。
 *
 * 歌牌的核心技能是记住「哪张牌在哪个位置」，所以牌被取走后**不能让后面的牌顶上来**——
 * 那会把玩家背下来的阵形整个打乱。取走的位置留空，新来的牌（送り札 / 罚牌）填第一个空位。
 */
export class SlotMap {
  private slots: Array<CardId | null>

  constructor(size: number, initial: readonly CardId[] = []) {
    this.slots = Array.from({ length: size }, (_, i) => initial[i] ?? null)
  }

  /** 用最新的领地内容更新槽位，尽量保持既有位置不变 */
  sync(current: readonly CardId[]): void {
    const present = new Set(current)
    // 已不在领地内的清空
    for (let i = 0; i < this.slots.length; i++) {
      const id = this.slots[i]
      if (id && !present.has(id)) this.slots[i] = null
    }
    // 新来的填第一个空位
    const known = new Set(this.slots.filter((x): x is CardId => x !== null))
    for (const id of current) {
      if (known.has(id)) continue
      const hole = this.slots.indexOf(null)
      if (hole >= 0) this.slots[hole] = id
      else this.slots.push(id)
      known.add(id)
    }
  }

  /** 交换两个槽位——记忆阶段的「点 A 再点 B」用它 */
  swap(a: number, b: number): void {
    if (a < 0 || b < 0 || a >= this.slots.length || b >= this.slots.length) return
    const tmp = this.slots[a] ?? null
    this.slots[a] = this.slots[b] ?? null
    this.slots[b] = tmp
  }

  get view(): ReadonlyArray<CardId | null> {
    return this.slots
  }

  /** 供上报给服务端的顺序（只含实际存在的牌） */
  get order(): CardId[] {
    return this.slots.filter((x): x is CardId => x !== null)
  }
}
