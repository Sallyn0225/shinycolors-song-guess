/**
 * 战报取证：把每个预览用例截成图，并对显示列表做断言。
 *
 * 为什么不只截图 —— 战报是一整张画在 canvas 上的图，出问题的方式恰恰是
 * 「看着像那么回事」：文字压在印章底下、某一行掉出纸外、数值算成 NaN 之后
 * 以字符串形式老老实实画了出来。这些在缩略图里全都不显眼。
 *
 * 所以断言直接跑在 `features/shareCard.ts` 产出的显示列表上（预览页把它挂在
 * window.__ticketOps），量的是坐标和字符串，不是像素。
 *
 * 前置：`pnpm --filter @scg/web dev`
 * 用法：node tools/ticket-preview/shoot.mjs [--shot <dir>] [--case <id>]
 */
import fs from 'node:fs'
import path from 'node:path'

import { load } from '../ui-audit/deps.mjs'

const puppeteer = load('puppeteer')

const BASE = process.env.PREVIEW_URL ?? 'http://localhost:5173'
const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : null
}
const SHOT_DIR = arg('--shot')
const ONLY = arg('--case')

/**
 * 浏览器。puppeteer 自带的那份常常没下载（deps.mjs 建议用
 * PUPPETEER_SKIP_DOWNLOAD 装），所以这里优先用系统已装的 Chrome/Edge，
 * 找不到再交给 puppeteer 自己解析。
 *
 * 不做这一步的话，第一次跑的人拿到的是一句「Could not find Chrome」，
 * 而机器上其实装着 Chrome。
 */
function browserPath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH
  const candidates =
    process.platform === 'win32'
      ? [
          'C:/Program Files/Google/Chrome/Application/chrome.exe',
          'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
          'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
          'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        ]
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
          ]
        : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  return candidates.find((p) => fs.existsSync(p)) ?? undefined
}

/** 版面常量，与 features/shareCard.ts 保持一致 */
const CARD = { w: 720, h: 1080 }
const CONTENT = { left: 46, right: 508 }

async function main() {
  const exe = browserPath()
  const browser = await puppeteer.launch({ headless: 'new', ...(exe ? { executablePath: exe } : {}) })
  const page = await browser.newPage()
  await page.setViewport({ width: 1600, height: 1300, deviceScaleFactor: 1 })

  const url = `${BASE}/ticket-preview.html${ONLY ? `?case=${ONLY}` : ''}`
  await page.goto(url, { waitUntil: 'networkidle0' })
  await page.waitForSelector('body[data-ready="true"]', { timeout: 20_000 })

  const findings = await page.evaluate(
    (CARD, CONTENT) => {
      const all = window.__ticketOps
      const out = []
      const push = (c, msg) => out.push({ case: c, msg })

      for (const [id, ops] of Object.entries(all)) {
        const texts = ops.filter((o) => o.k === 'text')
        const stamp = ops.find((o) => o.k === 'stamp')

        // 1) 算坏的数值会被原样画出来，而且不抛任何错
        for (const t of texts) {
          if (/NaN|undefined|null|Infinity/.test(t.text)) push(id, `文本含坏值：「${t.text}」`)
          if (t.text.trim() === '') push(id, '画了一条空文本')
        }

        // 2) 掉出纸外。x 的含义随 align 变（左对齐是左边界，右对齐是右边界），
        //    所以要真的量一次文字宽度再折算 —— 拍脑袋给个固定宽度会把
        //    右对齐的数字列全部误报成越界。
        const probe = document.createElement('canvas').getContext('2d')
        for (const t of texts) {
          probe.font = t.font
          const w = probe.measureText(t.text).width + (t.tracking ?? 0) * Math.max(t.text.length - 1, 0)
          const left = t.align === 'right' ? t.x - w : t.align === 'center' ? t.x - w / 2 : t.x
          if (left < 0 || left + w > CARD.w) {
            push(id, `文本超出纸面：「${t.text}」[${left.toFixed(1)}, ${(left + w).toFixed(1)}]`)
          }
          if (t.y < 0 || t.y > CARD.h) push(id, `文本超出纸面：「${t.text}」y=${t.y}`)
        }

        // 3) 逐题格必须收在版心里。题目数从 10 变 20 时这里最容易溢出
        const ticks = ops.filter((o) => o.k === 'tick')
        if (ticks.length) {
          const last = ticks[ticks.length - 1]
          if (last.x + last.size > CONTENT.right + 0.5) {
            push(id, `逐题格右端 ${(last.x + last.size).toFixed(1)} 超过版心 ${CONTENT.right}`)
          }
          if (ticks.some((t) => t.size <= 0)) push(id, '逐题格算出了非正尺寸')
          if (ticks[0].x < CONTENT.left - 0.5) push(id, '逐题格左端越过版心')
        }

        // 4) 印章是 multiply 盖上去的，落在圆里的文字会读不出来
        if (stamp) {
          for (const t of texts) {
            if (Math.hypot(t.x - stamp.cx, t.y - stamp.cy) < stamp.r) {
              push(id, `文字被印章盖住：「${t.text}」`)
            }
          }
        }

        // 5) 表情缺图会在段位块左边留一个洞，必须带 fallback
        for (const im of ops.filter((o) => o.k === 'image')) {
          if (im.src.startsWith('/emote/') && !im.fallback) push(id, '表情图没有 fallback')
          if (im.w <= 0 || im.h <= 0) push(id, `图片尺寸非正：${im.src}`)
        }

        if (!ops.length || ops[0].k !== 'paper') push(id, '第一条不是纸底')
      }
      return out
    },
    CARD,
    CONTENT,
  )

  if (SHOT_DIR) {
    fs.mkdirSync(SHOT_DIR, { recursive: true })
    for (const el of await page.$$('canvas[data-case]')) {
      const id = await el.evaluate((n) => n.dataset.case)
      await el.screenshot({ path: path.join(SHOT_DIR, `${id}.png`) })
    }
    console.log(`截图写入 ${SHOT_DIR}/`)
  }

  const cases = await page.evaluate(() => Object.keys(window.__ticketOps))
  console.log(`用例 ${cases.length} 个：${cases.join(', ')}`)

  if (findings.length === 0) {
    console.log('✓ 无异常')
  } else {
    console.log(`\n✗ ${findings.length} 处：`)
    for (const f of findings) console.log(`  [${f.case}] ${f.msg}`)
  }

  await browser.close()
  process.exit(findings.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  console.error(`\n预览页起来了吗？前置是 pnpm --filter @scg/web dev（默认 ${BASE}）`)
  process.exit(1)
})
