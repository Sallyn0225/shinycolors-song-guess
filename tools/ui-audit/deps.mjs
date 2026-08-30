/**
 * puppeteer / pngjs 的解析。
 *
 * 这两个包只有取证脚本要用，不该进 apps/web 或任何一个 workspace 包的依赖里 ——
 * 它们跟产物无关，装进去只会让每个人的 `pnpm install` 多拉一个浏览器。
 *
 * 所以按「装在哪儿就从哪儿找」处理：先走正常解析（装在仓库任意上层都能找到），
 * 找不到再看 Impeccable skill 自带的那份（.claude/ 不入库，但本机常有）。
 * 两处都没有就把安装命令直接打出来，别让人对着一句 ERR_MODULE_NOT_FOUND 猜。
 */
import { createRequire } from 'node:module'
import path from 'node:path'

const HERE = createRequire(import.meta.url)
const SKILL = path.resolve('.claude/skills/impeccable/package.json')

export function load(name) {
  for (const req of [HERE, tryRequire(SKILL)]) {
    if (!req) continue
    try {
      return req(name)
    } catch {
      /* 换下一个位置 */
    }
  }
  console.error(
    `找不到 ${name}。取证脚本的依赖不进 workspace，就地装一份即可：\n` +
      `  npm install --prefix tools/ui-audit puppeteer pngjs\n` +
      `（puppeteer 会优先用系统安装的 Chrome，可以 PUPPETEER_SKIP_DOWNLOAD=true 跳过自带浏览器）`,
  )
  process.exit(1)
}

function tryRequire(pkgJsonPath) {
  try {
    return createRequire(pkgJsonPath)
  } catch {
    return null
  }
}
