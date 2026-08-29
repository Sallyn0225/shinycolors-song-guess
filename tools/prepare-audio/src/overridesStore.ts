import fs from 'node:fs/promises'
import path from 'node:path'

import { DATA_DIR } from './config.js'

const OVERRIDES_PATH = path.join(DATA_DIR, 'overrides.json')

export interface OverrideEntry {
  unit?: string
  units?: string[]
  performers?: string[]
  note?: string
}

interface OverridesFile {
  byTitle: Record<string, OverrideEntry>
  [k: string]: unknown
}

async function read(): Promise<OverridesFile> {
  const raw = await fs.readFile(OVERRIDES_PATH, 'utf8')
  const parsed = JSON.parse(raw) as OverridesFile
  if (!parsed.byTitle) parsed.byTitle = {}
  return parsed
}

async function write(file: OverridesFile): Promise<void> {
  // 保留 _comment / _resolvedViaAlbum 等说明性字段，只动 byTitle
  await fs.writeFile(OVERRIDES_PATH, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
}

export async function listOverrides(): Promise<Record<string, OverrideEntry>> {
  return (await read()).byTitle
}

/** 写入/更新一条归属覆盖。unit 与 performers 至少给一个 */
export async function setOverride(title: string, entry: OverrideEntry): Promise<void> {
  const file = await read()
  const clean: OverrideEntry = {}
  if (entry.unit) clean.unit = entry.unit
  if (entry.units?.length) clean.units = entry.units
  if (entry.performers?.length) clean.performers = entry.performers
  clean.note = entry.note?.trim() || '在归属编辑器中人工确认'
  file.byTitle[title] = clean
  await write(file)
}

/** 移除覆盖，回到自动决议 */
export async function clearOverride(title: string): Promise<void> {
  const file = await read()
  delete file.byTitle[title]
  await write(file)
}
