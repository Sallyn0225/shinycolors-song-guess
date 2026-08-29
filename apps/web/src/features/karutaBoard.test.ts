import { describe, expect, it } from 'vitest'

import { SlotMap } from './karutaBoard'

const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`)

describe('稳定槽位', () => {
  it('初始按顺序占满', () => {
    const m = new SlotMap(12, ids(12))
    expect(m.view).toEqual(ids(12))
    expect(m.order).toEqual(ids(12))
  })

  // 这条是歌牌的核心：玩家背的是「哪张牌在哪个位置」，牌被取走后不能让后面的顶上来
  it('牌被取走后留空，其余位置不变', () => {
    const m = new SlotMap(12, ids(12))
    const after = ids(12).filter((x) => x !== 'c4')
    m.sync(after)
    expect(m.view[4]).toBeNull()
    expect(m.view[3]).toBe('c3')
    expect(m.view[5]).toBe('c5')
  })

  it('新来的牌填第一个空位，不会挤动别的', () => {
    const m = new SlotMap(12, ids(12))
    m.sync(ids(12).filter((x) => x !== 'c2' && x !== 'c7'))
    expect(m.view[2]).toBeNull()
    expect(m.view[7]).toBeNull()

    m.sync([...ids(12).filter((x) => x !== 'c2' && x !== 'c7'), 'newCard'])
    expect(m.view[2]).toBe('newCard')
    expect(m.view[7]).toBeNull()
    expect(m.view[3]).toBe('c3')
  })

  // お手つき / 送り札 会让领地超过 12 张
  it('没有空位时向后扩展，而不是丢弃', () => {
    const m = new SlotMap(12, ids(12))
    m.sync([...ids(12), 'extra1', 'extra2'])
    expect(m.view).toHaveLength(14)
    expect(m.view[12]).toBe('extra1')
    expect(m.view[13]).toBe('extra2')
    expect(m.order).toHaveLength(14)
  })

  it('交换位置只动这两格', () => {
    const m = new SlotMap(12, ids(12))
    m.swap(0, 11)
    expect(m.view[0]).toBe('c11')
    expect(m.view[11]).toBe('c0')
    expect(m.view[5]).toBe('c5')
  })

  it('越界的交换被忽略，不抛异常', () => {
    const m = new SlotMap(12, ids(12))
    m.swap(-1, 3)
    m.swap(3, 99)
    expect(m.view).toEqual(ids(12))
  })

  it('order 只含实际存在的牌', () => {
    const m = new SlotMap(12, ids(12))
    m.sync(ids(12).filter((x) => x !== 'c0' && x !== 'c5'))
    expect(m.order).not.toContain('c0')
    expect(m.order).not.toContain('c5')
    expect(m.order).toHaveLength(10)
  })
})
