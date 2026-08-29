import fs from 'node:fs/promises'

import { DIFFICULTY_PRESETS, type Difficulty } from '@scg/shared'
import { generateSoloRound, type SoloSong } from '@scg/game-core'

import { PRIVATE_MANIFEST } from './manifest.js'

interface PrivateManifest {
  songs: Array<{
    id: string
    title: string
    album: string
    unit: string | null
    confusableGroup: string | null
    slices: Array<{ index: number; degradeLevel: number }>
    neighbours: Array<{ id: string; sim: number }>
  }>
}

/** 把 private manifest 转成 game-core 需要的出题输入 */
export async function loadSoloCatalog(): Promise<{
  songs: SoloSong[]
  titleById: Map<string, string>
  unitById: Map<string, string | null>
}> {
  const raw = JSON.parse(await fs.readFile(PRIVATE_MANIFEST, 'utf8')) as PrivateManifest
  const titleById = new Map(raw.songs.map((s) => [s.id, s.title]))
  const unitById = new Map(raw.songs.map((s) => [s.id, s.unit]))
  const songs: SoloSong[] = raw.songs.map((s) => ({
    id: s.id,
    unit: s.unit,
    album: s.album,
    confusableGroup: s.confusableGroup,
    neighbours: s.neighbours,
    sliceCount: s.slices.length,
  }))
  return { songs, titleById, unitById }
}

/**
 * 用真实曲库出一轮题并打印出来。
 * 合成数据测不出真实曲库的边角（迷你组合、unit 为 null 的合同曲、易混淆组）。
 */
export async function previewSoloRound(difficulty: Difficulty, seed: string): Promise<void> {
  const { songs, titleById, unitById } = await loadSoloCatalog()
  const preset = DIFFICULTY_PRESETS[difficulty]

  process.stdout.write(
    `\n【${preset.label}】${preset.questionCount} 题 · 片段 ${preset.clipSeconds}s · 限时 ${preset.answerSeconds}s · ` +
      `${preset.optionCount} 选 1 · 重听 ${preset.replays} 次 · 干扰项 ${preset.distractors}\n\n`,
  )

  const round = generateSoloRound(songs, difficulty, seed)
  let sameUnitTotal = 0
  let distractorTotal = 0

  round.questions.forEach((q, i) => {
    const answerUnit = unitById.get(q.songId) ?? null
    process.stdout.write(`  ${String(i + 1).padStart(2)}. 答案：${titleById.get(q.songId)}\n`)
    for (const opt of q.optionIds) {
      const isAnswer = opt === q.songId
      const u = unitById.get(opt) ?? null
      if (!isAnswer) {
        distractorTotal++
        if (answerUnit && u === answerUnit) sameUnitTotal++
      }
      process.stdout.write(
        `        ${isAnswer ? '✓' : ' '} ${(titleById.get(opt) ?? opt).padEnd(38)} ${u ?? '—'}\n`,
      )
    }
    process.stdout.write('\n')
  })

  if (distractorTotal > 0) {
    process.stdout.write(
      `  干扰项中同组合占比：${((sameUnitTotal / distractorTotal) * 100).toFixed(0)}%（${sameUnitTotal}/${distractorTotal}）\n`,
    )
  }
}

/** 大批量跑一遍，检查真实曲库下会不会出异常或退化 */
export async function stressSolo(rounds = 300): Promise<void> {
  const { songs, unitById } = await loadSoloCatalog()
  process.stdout.write(`\n[stress] 曲库 ${songs.length} 首，每个难度各跑 ${rounds} 轮…\n`)

  for (const difficulty of ['easy', 'hard'] as const) {
    let questions = 0
    let sameUnit = 0
    let distractors = 0
    const optionUse = new Map<string, number>()

    for (let i = 0; i < rounds; i++) {
      const round = generateSoloRound(songs, difficulty, `stress-${difficulty}-${i}`)
      for (const q of round.questions) {
        questions++
        const au = unitById.get(q.songId) ?? null
        if (new Set(q.optionIds).size !== q.optionIds.length) {
          throw new Error(`选项重复：${q.songId}`)
        }
        if (!q.optionIds.includes(q.songId)) throw new Error(`答案不在选项里：${q.songId}`)
        for (const o of q.optionIds) {
          if (o === q.songId) continue
          distractors++
          if (au && (unitById.get(o) ?? null) === au) sameUnit++
          optionUse.set(o, (optionUse.get(o) ?? 0) + 1)
        }
      }
    }

    const preset = DIFFICULTY_PRESETS[difficulty]
    const coverage = optionUse.size / songs.length
    process.stdout.write(
      `  ${preset.label}: ${questions} 题 · 同组合干扰项 ${((sameUnit / distractors) * 100).toFixed(0)}% · ` +
        `曲库覆盖 ${(coverage * 100).toFixed(0)}%（${optionUse.size}/${songs.length} 首出现过）\n`,
    )
  }
  process.stdout.write(`[stress] 通过：无重复选项、答案始终在选项内\n`)
}
