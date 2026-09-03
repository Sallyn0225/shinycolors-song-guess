import { beforeEach, describe, expect, it } from 'vitest'

import { emptyRecords } from './features/records'
import { clearRecords, loadRecords, recordSolo, saveRecords } from './records'

describe('records 本地存储门面', () => {
  let store: Record<string, string> = {}

  beforeEach(() => {
    store = {}
    const mockStorage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => {
        store[key] = val
      },
      removeItem: (key: string) => {
        delete store[key]
      },
      clear: () => {
        store = {}
      },
    }
    Object.defineProperty(globalThis, 'localStorage', {
      value: mockStorage,
      writable: true,
      configurable: true,
    })
  })

  it('初始无记录时返回 emptyRecords()', () => {
    expect(loadRecords()).toEqual(emptyRecords())
  })

  it('正常写入与读取', () => {
    const r = emptyRecords()
    r.modes.easy.games = 3
    saveRecords(r)
    expect(loadRecords().modes.easy.games).toBe(3)
  })

  it('损坏 JSON 优雅回退到 emptyRecords() 而不抛错', () => {
    store['scg.stats'] = '{ bad json'
    expect(() => loadRecords()).not.toThrow()
    expect(loadRecords()).toEqual(emptyRecords())
  })

  it('版本号不认识时回退到 emptyRecords()', () => {
    store['scg.stats'] = JSON.stringify({ v: 999, seen: ['s1'] })
    expect(loadRecords()).toEqual(emptyRecords())
  })

  it('recordSolo 写入存储并返回更新后的 records', () => {
    const res = recordSolo('s-1', {
      difficulty: 'easy',
      total: 10,
      correct: 8,
      score: 800,
      maxScore: 1000,
      items: [
        {
          correct: true,
          song: { id: 's1', title: 'Song 1', unit: 'illumination-stars' },
        },
      ],
    })
    expect(res.modes.easy.games).toBe(1)
    expect(res.modes.easy.bestScore).toBe(800)
    // 再次从 localStorage 读也是一致的
    expect(loadRecords().modes.easy.games).toBe(1)
  })

  it('clearRecords 清空存储', () => {
    const r = emptyRecords()
    r.modes.easy.games = 5
    saveRecords(r)
    expect(loadRecords().modes.easy.games).toBe(5)

    clearRecords()
    expect(loadRecords().modes.easy.games).toBe(0)
    expect(store['scg.stats']).toBeUndefined()
  })

  it('localStorage 抛异常（无痕模式 / QuotaExceededError）时静默处理不崩溃', () => {
    const throwingStorage = {
      getItem: () => {
        throw new Error('SecurityError: The operation is insecure.')
      },
      setItem: () => {
        throw new Error('QuotaExceededError: The quota has been exceeded.')
      },
      removeItem: () => {
        throw new Error('SecurityError')
      },
      clear: () => {},
    }
    Object.defineProperty(globalThis, 'localStorage', {
      value: throwingStorage,
      writable: true,
      configurable: true,
    })

    expect(() => loadRecords()).not.toThrow()
    expect(loadRecords()).toEqual(emptyRecords())

    expect(() => saveRecords(emptyRecords())).not.toThrow()
    expect(() =>
      recordSolo('s-2', {
        difficulty: 'easy',
        total: 10,
        correct: 8,
        score: 800,
        maxScore: 1000,
        items: [],
      }),
    ).not.toThrow()
    expect(() => clearRecords()).not.toThrow()
  })
})
