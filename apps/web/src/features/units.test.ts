import { readFileSync } from 'node:fs'
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

describe('COUNTED_UNITS 与 manifest 一致性（双向断言）', () => {
  const manifestPath = fileURLToPath(
    new URL('../../../../assets/manifest.public.json', import.meta.url),
  )
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as ManifestPublic
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
