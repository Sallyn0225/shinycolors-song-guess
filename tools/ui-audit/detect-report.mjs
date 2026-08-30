/**
 * 把 Impeccable detector 的 --json 输出按规则分组打印。
 * 它默认的文本输出每条都附一大段规则说明，30 条就刷满一屏，看不出哪几类。
 *
 * 用法：
 *   node .claude/skills/impeccable/scripts/detect.mjs <url> --json > out.json
 *   node tools/ui-audit/detect-report.mjs out.json [--shape]
 */
import fs from 'node:fs'

const file = process.argv[2]
const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
const list = raw.findings ?? raw
if (process.argv[3] === '--shape') {
  console.log(JSON.stringify(list[0], null, 1))
  process.exit(0)
}
const by = new Map()
for (const f of list) {
  const k = f.antipattern ?? f.rule ?? f.ruleId ?? f.id ?? '?'
  if (!by.has(k)) by.set(k, [])
  by.get(k).push(f)
}
for (const [k, v] of [...by].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n### ${k}  (${v.length})`)
  for (const f of v) {
    console.log(`  · [${f.severity}] ${f.snippet ?? f.message ?? ''}`)
  }
}
