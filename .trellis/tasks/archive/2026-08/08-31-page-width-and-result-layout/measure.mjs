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

    /*
      结算页专用。三件事要能被裁定，肉眼一件都判不准：

      - listBox / listScroll：容器实高与内容实高。两者相等 = 限高没生效（或题少到不必滚）；
        listScroll > listBox = 正在滚，此时页面高度与题数脱钩，这才是 R2 想要的状态。
      - itemCount：题数。10 与 20 两局的 scrollHeight 要相等，得先证明两局题数确实不同。
      - actionsBottom：按钮行底缘的**文档**坐标。判「按钮够不够得着」只能用它减 innerHeight，
        用视口坐标会因为量的时候页面滚没滚而变。
    */
    itemCount: document.querySelectorAll('.sc-resultlist li, main > ol > li').length || null,
    listBox: document.querySelector('.sc-resultlist')
      ? Math.round(document.querySelector('.sc-resultlist').getBoundingClientRect().height)
      : null,
    listScroll: document.querySelector('.sc-resultlist')
      ? document.querySelector('.sc-resultlist').scrollHeight
      : null,
    actionsBottom: (() => {
      const btn = [...document.querySelectorAll('button')].find((b) =>
        b.textContent?.includes('再来一局'),
      )
      if (!btn) return null
      return Math.round(btn.getBoundingClientRect().bottom + window.scrollY)
    })(),
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

  /*
    开场遮罩（Splash）是这份脚本上一版之后才加的，它盖在首页之上。
    不关掉它，六档的「Start」量到的全是遮罩自己 —— 上一版跑出来
    overflowY 恒为 0、gutter 恒为 -，看着像「全都通过」，其实一屏没量到。
    遮罩是 role="dialog"，点它任意处即关；等它离开 DOM 再往下走。
  */
  const splash = await page.$('[role="dialog"]')
  if (splash) {
    await page.evaluate(() => document.querySelector('[role="dialog"]')?.click())
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 10000 })
    await sleep(700)
  }
  return page
}

/**
 * 打完一整局，停在结算页。
 *
 * 只按 `1`：答对答错都不影响版面高度（逐题行是等高的），而「一直选同一个」
 * 是唯一不依赖题目内容、每档都能复现的走法。
 */
async function toResult(page) {
  for (let i = 0; i < 60; i += 1) {
    await sleep(350)
    const done = await page.evaluate(() => {
      const t = document.body.innerText
      if (t.includes('查看结算')) return 'finish'
      if (t.includes('RESULT')) return 'done'
      return t.includes('下一题') ? 'next' : 'answer'
    })
    if (done === 'done') break
    if (done === 'finish' || done === 'next') await page.keyboard.press('Enter')
    else await page.keyboard.press('1')
  }
  await page.waitForFunction(() => document.body.innerText.includes('RESULT'), { timeout: 20000 })
  await sleep(900) // 逐题行 anim-appear 最迟 500ms 延迟
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

  /*
    ── Result ──────────────────────────────────────────
    简单（10 题）与困难（20 题）各打一局。这两档的 scrollHeight 必须**相等** ——
    「页面不再被曲目列表拉长」这句话没有别的可测量定义。
    只在桌面最紧的一档和两个手机档跑：一局要按 10~20 次键，六档全跑要几分钟，
    而这条验收关心的是「页面高度与题数脱钩」，它与视口宽度无关。
  */
  if (['1366x678', '375x667', '390x844'].includes(vp.name)) {
    for (const [idx, label] of [
      [0, 'Result/easy-10'],
      [1, 'Result/hard-20'],
    ]) {
      const page = await fresh(browser, vp)
      try {
        await page.waitForSelector('section[aria-label="选择难度"] button')
        await page.evaluate((i) => {
          document.querySelectorAll('section[aria-label="选择难度"] button')[i].click()
        }, idx)
        await page.waitForSelector('.sc-bar', { timeout: 15000 })
        await toResult(page)
        results.push({
          viewport: vp.name,
          screen: vp.screen,
          screenName: label,
          ...(await page.evaluate(probe)),
        })
      } catch (e) {
        results.push({ viewport: vp.name, screenName: label, error: String(e).slice(0, 200) })
      }
      await page.close()
    }
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
  pad('mainW', 7),
  pad('bars', 22),
  pad('slot', 7),
  pad('minTap', 7),
  pad('items', 6),
  pad('list', 12),
  pad('btnReach', 9),
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
    pad(r.main ? r.main.width : '-', 7),
    pad(r.barHeights.length ? r.barHeights.join(',') : '-', 22),
    pad(r.revealSlot ?? '-', 7),
    pad(r.minTap ?? '-', 7),
    pad(r.itemCount ?? '-', 6),
    // 容器高/内容高。两数相等 = 没在滚，页面高度仍绑着题数
    pad(r.listBox != null ? `${r.listBox}/${r.listScroll}` : '-', 12),
    // 按钮底缘露出视口多少 px：0 = 首屏就够得着
    pad(
      r.actionsBottom != null
        ? (() => {
            const over = r.actionsBottom - r.innerHeight
            return over > 0 ? `+${over} ✗` : `0 ✓`
          })()
        : '-',
      9,
    ),
  )
}
console.log(`\n→ ${join(HERE, outFile)}`)
