import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { COUNTED_UNITS, isCountedUnit, unitColor, unitName } from './units'

interface ManifestUnit {
  id: string
  name: string
  color: string
  kind?: string
}

interface ManifestPublic {
  units: ManifestUnit[]
}

const manifestPath = fileURLToPath(
  new URL('../../../../assets/manifest.public.json', import.meta.url),
)

/**
 * `assets/` 是 1.7GB 商业音源的派生物，不入库也不该入库（见 NOTICE），
 * 所以 CI 上没有这个文件，而本地开发机上有。
 *
 * 这一组断言的**全部价值**在于拿这张手写表去对真实曲库：把 manifest 换成一份入库的
 * fixture，断言就退化成表在自我印证，漏掉一个组合照样全绿。所以宁可在没有曲库的环境里
 * 显式跳过，也不把它降级成假数据。口径与 `ci.yml` 里被排除的 server 那 4 个测试一致 ——
 * 那里的说法是「失败是环境问题不是代码问题」。
 *
 * 读取必须是**惰性**的：`describe.skip` 依然会执行回调体来收集用例，
 * 在顶层直接 readFileSync 的话，跳过与否都已经抛在收集阶段了。
 */
const hasManifest = existsSync(manifestPath)
const describeWithManifest = hasManifest ? describe : describe.skip

describeWithManifest('COUNTED_UNITS 与 manifest 一致性（双向断言）', () => {
  const manifest = hasManifest
    ? (JSON.parse(readFileSync(manifestPath, 'utf-8')) as ManifestPublic)
    : { units: [] as ManifestUnit[] }
  const nonShuffleInManifest = manifest.units.filter((u) => u.kind !== 'shuffle')

  it('9 个常设组合 + 全体曲，数量与 manifest 中非 shuffle 组合一致', () => {
    expect(COUNTED_UNITS).toHaveLength(9)
    expect(nonShuffleInManifest).toHaveLength(9)
  })

  it('COUNTED_UNITS 中的每一项都在 manifest 中存在且非 shuffle，名字和代表色一致', () => {
    const manifestMap = new Map(manifest.units.map((u) => [u.id, u]))
    for (const unit of COUNTED_UNITS) {
      const fromManifest = manifestMap.get(unit.id)
      expect(fromManifest, `manifest 中缺少组合 ${unit.id}`).toBeDefined()
      expect(fromManifest?.kind).not.toBe('shuffle')
      expect(unit.name).toBe(fromManifest?.name)
      expect(unit.color).toBe(fromManifest?.color)
    }
  })

  it('manifest 中的每个非 shuffle 组合都在 COUNTED_UNITS 中', () => {
    // Set<string> 而不是让它推成字面量联合：断言的输入来自 manifest，是普通 string，
    // 推成联合就得在调用点补一次 as any，那正好把这条断言想抓的错误一起消掉了
    const tableIds = new Set<string>(COUNTED_UNITS.map((u) => u.id))
    for (const unit of nonShuffleInManifest) {
      expect(tableIds.has(unit.id), `${unit.id} 未包含在 COUNTED_UNITS 表中`).toBe(true)
    }
  })
})

describe('units 辅助函数', () => {
  it('isCountedUnit 正确判定', () => {
    expect(isCountedUnit('illumination-stars')).toBe(true)
    expect(isCountedUnit('shinycolors')).toBe(true)
    expect(isCountedUnit('Team.Luna')).toBe(false)
    expect(isCountedUnit(null)).toBe(false)
    expect(isCountedUnit('unknown-id')).toBe(false)
  })

  it('unitName 取组合日文名，未知回落到 id', () => {
    expect(unitName('straylight')).toBe('ストレイライト')
    expect(unitName('random-unit')).toBe('random-unit')
  })

  it('unitColor 取组合代表色，未知回落到 var(--color-primary)', () => {
    expect(unitColor('alstroemeria')).toBe('#ff699e')
    expect(unitColor('unknown')).toBe('var(--color-primary)')
  })
})
