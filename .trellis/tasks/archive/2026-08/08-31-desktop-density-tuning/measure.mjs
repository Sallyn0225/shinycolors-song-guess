/**
 * 桌面端密度收紧的测量门。
 *
 * 在六档视口下量每一屏的纵横溢出、设计单位、版心、选项条高度与可读性地板，
 * 输出一份 JSON。改动前跑一次存成 baseline.json，改动后跑一次存成 after.json，
 * 两份对着看 —— prd.md 的 AC1~AC6 全部由这份输出裁定，不靠肉眼。
 *
 * 用法：
 *   node .trellis/tasks/08-31-desktop-density-tuning/measure.mjs baseline.json
 *   node .trellis/tasks/08-31-desktop-density-tuning/measure.mjs after.json --no-fonts
 *
 * 前置：apps/web 的 dev server（5173）与 apps/server（5179）都在跑。
 */

import { createRequire } from 'node:module'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..', '..')
// puppeteer 装在 impeccable 技能里，不是项目依赖 —— 测量脚本不该往 apps/web 塞 devDependency
const nodeRequire = createRequire(join(REPO, '.claude/skills/impeccable/package.json'))
const puppeteer = nodeRequire('puppeteer')

/**
 * puppeteer 钉死的 Chrome 版本号和 ~/.cache 里已下载的那份未必一致（本机差一个 patch），
 * 缺什么就下什么会拖一次几百 MB。缓存里任何一份 chrome 都够用 —— 这里量的是布局，
 * 不是浏览器行为差异。找不到再退回系统 Chrome。
 */
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const cache = join(homedir(), '.cache', 'puppeteer', 'chrome')
  if (existsSync(cache)) {
    const builds = readdirSync(cache).sort().reverse()
    for (const b of builds) {
      const exe = join(cache, b, 'chrome-win64', 'chrome.exe')
      if (existsSync(exe)) return exe
    }
  }
  for (const p of [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ]) {
    if (existsSync(p)) return p
  }
  return undefined
}

const BASE = process.env.BASE ?? 'http://localhost:5173'

/** 视口是**浏览器视口**尺寸，不是屏幕尺寸：常见笔记本屏高减去约 90px 的浏览器界面 */
const VIEWPORTS = [
  { name: '1366x678', width: 1366, height: 678, screen: '1366x768' },
  { name: '1440x810', width: 1440, height: 810, screen: '1440x900' },
  { name: '1536x774', width: 1536, height: 774, screen: '1536x864' },
  { name: '1920x990', width: 1920, height: 990, screen: '1920x1080' },
  { name: '375x667', width: 375, height: 667, screen: 'iPhone SE' },
  { name: '390x844', width: 390, height: 844, screen: 'iPhone 12' },
]

const noFonts = process.argv.includes('--no-fonts')
const outFile = process.argv[2] ?? 'measure.json'

/** 在页面里跑：把这一刻屏上所有与密度有关的数都取回来 */
function probe() {
  const px = (v) => Math.round(parseFloat(v) * 1000) / 1000
  const main = document.querySelector('main')
  const mr = main?.getBoundingClientRect()

  /*
    --u 不能用 getComputedStyle().getPropertyValue('--u') 读：自定义属性的计算值是
    未解析的 token 串（"clamp(0.78px, 0.0694vw, 1.16px)"），parseFloat 得到 NaN。
    要拿到解析后的长度，只能让它真的参与一次布局 —— 100 倍是为了躲开亚像素舍入。
  */
  const ruler = document.createElement('div')
  ruler.style.cssText = 'position:absolute;visibility:hidden;height:calc(100 * var(--u));width:0'
  document.body.appendChild(ruler)
  const u = Math.round((ruler.getBoundingClientRect().height / 100) * 1000) / 1000
  ruler.remove()

  // 真 px 地板：所有可点元素的最小盒高，以及最小两级字号的实算值
  const clickable = [...document.querySelectorAll('button, a, input, .tap-line')].filter(
    (el) => el.offsetParent !== null && el.getBoundingClientRect().height > 0,
  )
  const minTap = clickable.length
    ? Math.min(...clickable.map((el) => Math.round(el.getBoundingClientRect().height * 100) / 100))
    : null

  const probeFont = (cls) => {
    const s = document.createElement('span')
    s.className = cls
    s.textContent = 'x'
    document.body.appendChild(s)
    const size = px(getComputedStyle(s).fontSize)
    s.remove()
    return size
  }

  return {
    scrollHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
    overflowY: document.documentElement.scrollHeight - window.innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
    u,
    main: mr
      ? {
          left: Math.round(mr.left),
          width: Math.round(mr.width),
          // 两侧留白占视口宽的比例 —— AC4 直接读这一个数
          gutterRatio: Math.round((mr.left / window.innerWidth) * 10000) / 10000,
        }
      : null,
    barHeights: [...document.querySelectorAll('.sc-bar')].map(
      (el) => Math.round(el.getBoundingClientRect().height * 100) / 100,
    ),
    revealSlot: document.querySelector('.sc-revealslot')
      ? Math.round(document.querySelector('.sc-revealslot').getBoundingClientRect().height * 100) / 100
      : null,
    rail: document.querySelector('[role="progressbar"], [role="presentation"]')
      ? Math.round(
          document.querySelector('[role="progressbar"], [role="presentation"]').getBoundingClientRect()
            .height * 100,
        ) / 100
      : null,
    minTap,
    text2xs: probeFont('text-2xs'),
    textXs: probeFont('text-xs'),
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fresh(browser, vp) {
  const page = await browser.newPage()
  await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 })
  if (noFonts) {
    await page.setRequestInterception(true)
    page.on('request', (req) => {
      const url = req.url()
      if (/fonts\.(googleapis|gstatic)\.com|\.woff2?($|\?)/.test(url)) req.abort()
      else req.continue()
    })
  }
  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.fonts.ready)
  await sleep(700) // 入场动画 --dur-base 0.4s，等它落定再量
  return page
}

/** 首页 → 点第一档难度 → 单人猜歌。返回停在 answering 的 page */
async function toPlay(page) {
  await page.waitForSelector('section[aria-label="选择难度"] button')
  await page.evaluate(() =>
    document.querySelector('section[aria-label="选择难度"] button').click(),
  )
  await page.waitForSelector('.sc-bar', { timeout: 15000 })
  await sleep(900) // 四条选项条各有 60ms 的入场错位
  return page
}

const results = []

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: findChrome(),
  args: ['--no-sandbox', '--mute-audio'],
})

for (const vp of VIEWPORTS) {
  // ── Start ────────────────────────────────────────────
  {
    const page = await fresh(browser, vp)
    results.push({ viewport: vp.name, screen: vp.screen, screenName: 'Start', ...(await page.evaluate(probe)) })
    await page.close()
  }

  /*
    Play：answering 与 revealed 必须是**同一题**，否则 AC2 的差值没有意义。

    还要专门抓一次**答对**的揭晓：答错时右列只有「不正解」一行，答对才多出
    「+N 速度 +M」第二行 —— 揭晓槽被撑高的最坏情况只在答对时出现。
    答案事前不可知，所以逐题试，直到出现 .text-correct 或用完题目。
  */
  {
    const page = await fresh(browser, vp)
    try {
      await toPlay(page)
      results.push({
        viewport: vp.name,
        screen: vp.screen,
        screenName: 'Play/answering',
        ...(await page.evaluate(probe)),
      })

      let gotCorrect = false
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await page.keyboard.press(String((attempt % 4) + 1))
        await sleep(900) // 等 /answer 回来 + 揭晓块入场（anim-appear 最迟 120ms 延迟）
        /*
          不能用 .text-correct 判定：正确答案那条选项条上的对勾图标也带这个类，
          每次揭晓都命中，于是「答对」恒为真。揭晓块里的「正解 / 不正解」才是唯一的判据。
        */
        const correct = await page.evaluate(() => {
          const t = document.querySelector('.sc-revealslot')?.textContent ?? ''
          return t.includes('正解') && !t.includes('不正解')
        })
        if (attempt === 0) {
          results.push({
            viewport: vp.name,
            screen: vp.screen,
            screenName: 'Play/revealed',
            correct,
            ...(await page.evaluate(probe)),
          })
        }
        if (correct) {
          if (attempt > 0) {
            results.push({
              viewport: vp.name,
              screen: vp.screen,
              screenName: 'Play/revealed-hit',
              correct: true,
              ...(await page.evaluate(probe)),
            })
          }
          gotCorrect = true
          break
        }
        await page.keyboard.press('Enter') // 下一题
        await page.waitForFunction(() => !document.querySelector('.sc-revealslot .anim-appear'), {
          timeout: 15000,
        })
        await sleep(700)
      }
      if (!gotCorrect) {
        results.push({ viewport: vp.name, screenName: 'Play/revealed-hit', error: '12 题内没答对，本档没抓到最坏情况' })
      }
    } catch (e) {
      results.push({ viewport: vp.name, screenName: 'Play', error: String(e).slice(0, 200) })
    }
    await page.close()
  }

  // ── Lobby（对战入口）：只验横向溢出与版心 ────────────
  {
    const page = await fresh(browser, vp)
    try {
      await page.evaluate(() => {
        const bars = [...document.querySelectorAll('section[aria-label="选择难度"] button')]
        bars[bars.length - 1].click()
      })
      await sleep(1200)
      results.push({
        viewport: vp.name,
        screen: vp.screen,
        screenName: 'Lobby',
        ...(await page.evaluate(probe)),
      })
    } catch (e) {
      results.push({ viewport: vp.name, screenName: 'Lobby', error: String(e).slice(0, 200) })
    }
    await page.close()
  }
}

await browser.close()

const payload = { base: BASE, noFonts, at: new Date().toISOString(), results }
writeFileSync(join(HERE, outFile), JSON.stringify(payload, null, 2))

// 控制台上直接给出 AC 判定，不必回头翻 JSON
const pad = (s, n) => String(s).padEnd(n)
console.log(
  pad('viewport', 10),
  pad('screen', 16),
  pad('u', 7),
  pad('overflowY', 10),
  pad('overflowX', 10),
  pad('gutter%', 9),
  pad('bars', 22),
  pad('slot', 7),
  pad('minTap', 7),
)
for (const r of results) {
  if (r.error) {
    console.log(pad(r.viewport, 10), pad(r.screenName, 16), 'ERROR', r.error)
    continue
  }
  console.log(
    pad(r.viewport, 10),
    pad(r.screenName, 16),
    pad(r.u, 7),
    pad(r.overflowY > 0 ? `+${r.overflowY} ✗` : `${r.overflowY} ✓`, 10),
    pad(r.overflowX > 0 ? `+${r.overflowX} ✗` : `${r.overflowX} ✓`, 10),
    pad(r.main ? `${(r.main.gutterRatio * 100).toFixed(1)}%` : '-', 9),
    pad(r.barHeights.length ? r.barHeights.join(',') : '-', 22),
    pad(r.revealSlot ?? '-', 7),
    pad(r.minTap ?? '-', 7),
  )
}
console.log(`\n→ ${join(HERE, outFile)}`)
