/**
 * 取证脚本：用两个 page 真打一局 1v1，把只有对局中才存在的界面量出来。
 *
 * 为什么不靠截图 —— 截图能看出「丑」，看不出「差多少像素」。
 * 这里量的都是眼睛不可靠的量：
 *   · 文本截断（scrollWidth > clientWidth，或 line-clamp 真的裁到了字）
 *   · 横向溢出（documentElement.scrollWidth > innerWidth）
 *   · 触摸热区（可交互元素的实际盒子 < 44px）
 *   · 焦点环有没有被 clip-path 吃掉（看 outline 落在被裁元素上还是包装层上）
 *   · 牌场能不能一屏装下、光带有没有落在场区的几何中线上
 *
 * 前置：`pnpm --filter @scg/server dev` + `pnpm --filter @scg/web dev`
 * 用法：node tools/ui-audit/probe.mjs [--mobile] [--shot <dir>]
 */
import path from 'node:path'
import fs from 'node:fs'

import { load } from './deps.mjs'

const puppeteer = load('puppeteer')

const URL = process.env.PROBE_URL ?? 'http://localhost:5173/'
const MOBILE = process.argv.includes('--mobile')
const shotIdx = process.argv.indexOf('--shot')
const SHOT_DIR = shotIdx >= 0 ? process.argv[shotIdx + 1] : null
if (SHOT_DIR) fs.mkdirSync(SHOT_DIR, { recursive: true })

const VP = MOBILE
  ? { width: 390, height: 844, deviceScaleFactor: 1 }
  : { width: 1536, height: 1024, deviceScaleFactor: 1 }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 按可见文本点按钮 */
async function clickText(page, text, tag = 'button') {
  const ok = await page.evaluate(
    (t, g) => {
      // 取包含该文本的**最小**元素，避免点到祖先
      const hits = [...document.querySelectorAll(g)].filter((e) => (e.textContent ?? '').includes(t))
      const el = hits.sort((a, b) => (a.textContent?.length ?? 0) - (b.textContent?.length ?? 0))[0]
      if (!el) return false
      el.click()
      return true
    },
    text,
    tag,
  )
  if (!ok) throw new Error(`找不到按钮「${text}」`)
  await sleep(350)
}

/** 一屏的结构性体检 */
const AUDIT = () => {
  const res = { truncated: [], tiny: [], overflowX: 0, viewport: [innerWidth, innerHeight] }
  res.overflowX = document.documentElement.scrollWidth - innerWidth

  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    const txt = el.textContent?.trim() ?? ''
    // 只看直接承载文字的叶子节点
    const leaf = [...el.childNodes].every((n) => n.nodeType === 3 || n.nodeType === 8)
    if (leaf && txt) {
      const clipped =
        el.scrollWidth > el.clientWidth + 1 ||
        (cs.webkitLineClamp !== 'none' && el.scrollHeight > el.clientHeight + 1)
      if (clipped && el.clientWidth > 0) {
        res.truncated.push({ text: txt.slice(0, 40), sw: el.scrollWidth, cw: el.clientWidth, fs: cs.fontSize })
      }
    }
    if (el.matches('button,a,input,[role="button"]') && !el.disabled) {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && (r.width < 44 || r.height < 44)) {
        res.tiny.push({ text: txt.slice(0, 24), w: +r.width.toFixed(1), h: +r.height.toFixed(1) })
      }
    }
  }
  return res
}

const report = (name, a) => {
  const bad = a.overflowX > 0 || a.truncated.length || a.tiny.length
  console.log(`\n── ${name}  @${a.viewport[0]}x${a.viewport[1]}  ${bad ? '⚠' : '✓ 无结构问题'}`)
  if (a.overflowX > 0) console.log(`   横向溢出 ${a.overflowX}px`)
  for (const t of a.truncated) console.log(`   截断 "${t.text}"  ${t.sw}>${t.cw}  ${t.fs}`)
  for (const t of a.tiny) console.log(`   热区 "${t.text}"  ${t.w}x${t.h}`)
}

const browser = await puppeteer.launch({
  channel: 'chrome',
  headless: true,
  protocolTimeout: 120_000,
  args: ['--autoplay-policy=no-user-gesture-required'],
})

const A = await browser.newPage()
const B = await browser.newPage()
await A.setViewport(VP)
await B.setViewport({ width: 1536, height: 1024, deviceScaleFactor: 1 })
await A.goto(URL, { waitUntil: 'networkidle0' })
await B.goto(URL, { waitUntil: 'networkidle0' })
await sleep(900)

const shot = async (page, name) => {
  if (!SHOT_DIR) return
  // 后台标签页的 captureScreenshot 会挂住 —— 必须先切到前台
  await page.bringToFront()
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) })
}

report('首页', await A.evaluate(AUDIT))
await shot(A, MOBILE ? 'start-mobile' : 'start-desktop')

// ── 进大厅 ────────────────────────────────────────────
await clickText(A, '1v1 空札領地戦', 'button')
await clickText(B, '1v1 空札領地戦', 'button')
await sleep(700)
report('大厅', await A.evaluate(AUDIT))
await shot(A, MOBILE ? 'lobby-mobile' : 'lobby-desktop')

// ── 建房 / 加入 ───────────────────────────────────────
await A.type('input[aria-label="昵称"]', 'A')
await clickText(A, '创建房间')
await sleep(700)
const code = await A.evaluate(() => {
  const p = [...document.querySelectorAll('p')].find((e) => /^[A-Z0-9]{6}$/.test(e.textContent?.trim() ?? ''))
  return p?.textContent?.trim()
})
if (!code) throw new Error('没拿到房间码')
console.log(`\n房间码 ${code}`)

await B.type('input[aria-label="昵称"]', 'B')
await B.type('input[aria-label="房间码"]', code)
await clickText(B, '加入')
await sleep(800)
report('房间', await A.evaluate(AUDIT))
await shot(A, MOBILE ? 'room-mobile' : 'room-desktop')

// ── 双方准备 → 记忆阶段 ───────────────────────────────
await clickText(A, '准备')
await sleep(300)
await clickText(B, '准备')
await sleep(1800)
report('牌场·记忆', await A.evaluate(AUDIT))
await shot(A, MOBILE ? 'memorize-mobile' : 'memorize-desktop')

/** 牌面几何：牌是 aria-label=曲名 的 button，装在 敵陣 / 自陣 两个 section 里 */
const GEO = () => {
  const out = {}
  for (const zone of ['敵陣', '自陣']) {
    const sec = document.querySelector(`[aria-label="${zone}"]`)
    if (!sec) continue
    const boxes = [...sec.querySelectorAll('button')].map((b) => b.getBoundingClientRect())
    if (!boxes.length) continue
    // 曲名的 line-clamp-2 有没有真的裁到字（.sc-tile-title 有子元素，
    // 通用的叶子检查看不到它，必须单独量）
    const titles = [...sec.querySelectorAll('.sc-tile-title')]
    const clipped = titles
      .filter((t) => t.scrollHeight > t.clientHeight + 1)
      .map((t) => t.textContent.trim().slice(0, 30))
    out[zone] = {
      n: boxes.length,
      cols: new Set(boxes.map((b) => Math.round(b.x))).size,
      tile: `${Math.round(boxes[0].width)}x${Math.round(boxes[0].height)}`,
      minH: Math.round(Math.min(...boxes.map((b) => b.height))),
      曲名被裁: clipped.length ? clipped : 0,
    }
  }
  return out
}
console.log('   牌面：', JSON.stringify(await A.evaluate(GEO)))

/** 纵向排布：牌场能不能一屏装下 —— 限时抢牌时滚动去找自己的牌等于没得玩 */
const VFIT = () => {
  const box = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) }
  }
  const own = document.querySelector('[aria-label="自陣"]')
  const belowFold = own
    ? [...own.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().bottom > innerHeight).length
    : null
  const rail = document.querySelector('[role="progressbar"]')
  const field = document.querySelector('.sc-field')
  let railOffMidline = null
  if (rail && field) {
    const fr = field.getBoundingClientRect()
    const rr = rail.getBoundingClientRect()
    railOffMidline = Math.round(rr.top + rr.height / 2 - (fr.top + fr.height / 2))
  }
  return {
    doc: document.documentElement.scrollHeight,
    vp: innerHeight,
    敵陣: box('[aria-label="敵陣"]'),
    場: box('.sc-field'),
    自陣: box('[aria-label="自陣"]'),
    自陣越过折线的牌: belowFold,
    光带偏离中线: railOffMidline,
  }
}
console.log('   纵向：', JSON.stringify(await A.evaluate(VFIT)))

// ── 焦点环：Tab 到一张牌，看焦点框是被 clip-path 吃掉还是上提到了包装层 ──
await A.bringToFront()
await A.evaluate(() => {
  const b = document.querySelector('[aria-label="敵陣"] button')
  b?.focus()
})
await A.keyboard.press('Tab')
const focus = await A.evaluate(() => {
  const el = document.activeElement
  if (!el || el === document.body) return { error: '焦点没落在任何元素上' }
  const cs = getComputedStyle(el)
  const wrap = el.closest('.cut-shadow, .cut-shadow-sm, .cut-shadow-lg')
  const wcs = wrap ? getComputedStyle(wrap) : null
  return {
    落在: `${el.tagName} ${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 20)}`,
    该元素被裁: cs.clipPath !== 'none',
    自身outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
    包装层outline: wrap ? `${wcs.outlineStyle} ${wcs.outlineWidth} ${wcs.outlineColor}` : '没有包装层',
  }
})
console.log('   Tab 焦点：', JSON.stringify(focus, null, 1).replace(/\n/g, '\n   '))
await shot(A, MOBILE ? 'focus-mobile' : 'focus-desktop')

// ── 双方点「我记好了」，直接进听取 ────────────────────
await clickText(A, '我记好了')
await clickText(B, '我记好了')
await sleep(2500)
report('牌场·听取', await A.evaluate(AUDIT))
console.log('   牌面：', JSON.stringify(await A.evaluate(GEO)))
console.log('   纵向：', JSON.stringify(await A.evaluate(VFIT)))
await shot(A, MOBILE ? 'listen-mobile' : 'listen-desktop')

// ── 抢跑触发 お手つき ─────────────────────────────────
const tapped = await A.evaluate(() => {
  const b = document.querySelector('[aria-label="敵陣"] button:not([disabled])')
  if (!b) return null
  const label = b.getAttribute('aria-label')
  b.click()
  return label
})
console.log(`\n   抢点了敵陣的「${tapped}」`)
// live 区（role=status）与回合播报是两个时刻的东西，整段采样一遍再去重
const READ = () =>
  [...document.querySelectorAll('[role="status"],[aria-live]')]
    .map((e) => e.textContent?.trim())
    .filter(Boolean)
const seen = new Set()
const rail = []
let caught = false
for (let i = 0; i < 16; i++) {
  const now = await A.evaluate(READ)
  for (const s of now) seen.add(s)
  // 判罚那一帧只存在几秒，采到就立刻截 —— 事后再截多半已经翻篇了
  if (!caught && now.some((s) => s.includes('お手つき') || s.includes('送り札'))) {
    caught = true
    await shot(A, MOBILE ? 'penalty-mobile' : 'penalty-desktop')
  }
  rail.push(
    await A.evaluate(() => document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')),
  )
  await sleep(900)
}
console.log('   光带读数：', rail.join(' '))
console.log('   播报（整回合去重）：')
for (const s of seen) console.log(`     · ${s}`)
await shot(A, MOBILE ? 'otetsuki-mobile' : 'otetsuki-desktop')
report('牌场·お手つき/揭晓', await A.evaluate(AUDIT))
console.log('   牌面：', JSON.stringify(await A.evaluate(GEO)))
console.log('   纵向：', JSON.stringify(await A.evaluate(VFIT)))

await browser.close()
