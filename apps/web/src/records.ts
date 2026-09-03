/**
 * 本地战绩存储门面。
 *
 * 与 prefs.ts 遵守同一条铁律：
 * 读写一律包 try/catch。无痕模式、存储被策略禁用、配额已满时一律静默吞掉，
 * 绝不能让结算页白屏，首页与奖杯屏优雅回落到空态。
 *
 * 真正的归并计算与排行是 features/records.ts 里的纯函数，
 * 这里只负责 localStorage 存取、版本回退与异常防护。
 */

import {
  emptyRecords,
  normalizeRecords,
  record,
  type Records,
  type SoloSummaryInput,
} from './features/records'

const KEY = 'scg.stats'

export function loadRecords(): Records {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return emptyRecords()
    const parsed: unknown = JSON.parse(raw)
    return normalizeRecords(parsed)
  } catch {
    // 存储被禁用、JSON 损坏或版本不匹配，一律回落到全新空数据
    return emptyRecords()
  }
}

export function saveRecords(records: Records): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(records))
  } catch {
    // QuotaExceededError 或无痕模式写不进去：吞掉，本次不记，绝不损坏现有数据
  }
}

/**
 * 结算时记录单人战绩。按 sessionId 幂等，返回更新后的战绩。
 */
export function recordSolo(sessionId: string, summary: SoloSummaryInput): Records {
  try {
    const prev = loadRecords()
    const next = record(prev, sessionId, summary)
    if (next !== prev) {
      saveRecords(next)
    }
    return next
  } catch {
    return emptyRecords()
  }
}

export function clearRecords(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* 静默吞掉 */
  }
}
