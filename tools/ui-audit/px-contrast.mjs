/**
 * 取证脚本：把「像素测量出来的对比度」和真实取色对照。
 *
 * 起因：Impeccable 的 detector 遇到 filter / backdrop-filter 祖先时算不出背景，
 * 会退化成逐像素测量，而小字的抗锯齿让多数像素只是部分覆盖 —— 于是它把
 * 真值 16.77:1 的 --color-ink 报成 median 4.2~7.2，把达标的文字全部报成不达标。
 *
 * 做法：deviceScaleFactor=4 截图（这个倍率下字形内部是满覆盖），在目标元素的
 * 包围盒里取离背景**最远**的那个像素当文字色（深底浅字要取最亮的，不是最暗的），
 * 包围盒外一圈的中位数当背景色，按 WCAG 公式算比值，再与声明色对照。
 *
 * 用法：node tools/ui-audit/px-contrast.mjs [url]
 */
import fs from 'node:fs'

import { load } from './deps.mjs'

const puppeteer = load('puppeteer')
const { PNG } = load('pngjs')

const URL = process.argv[2] ?? 'http://localhost:5173/'
const DPR = 4

const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const lum = ([r, g, b]) => 0.2126 * lin(r / 255) + 0.7152 * lin(g / 255) + 0.0722 * lin(b / 255)
const ratio = (a, b) => {
  const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)]
  return (hi + 0.05) / (lo + 0.05)
}
const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')

const browser = await puppeteer.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage()
await page.setViewport({ width: 1536, height: 1024, deviceScaleFactor: DPR })
await page.goto(URL, { waitUntil: 'networkidle0' })
await new Promise((r) => setTimeout(r, 1200)) // 入场动画走完

const targets = await page.evaluate(() => {
  const want = ['ソングゲス', '題数', '片段', '限时', '重听', '10', '8s', '15s', '2', '空札']
  const out = []
  for (const el of document.querySelectorAll('dt,dd,p,span,b,h1')) {
    const t = el.textContent?.trim() ?? ''
    if (!want.includes(t)) continue
    if (el.children.length > 0) continue
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) continue
    const cs = getComputedStyle(el)
    out.push({
      text: t,
      color: cs.color,
      fontSize: cs.fontSize,
      x: r.x, y: r.y, w: r.width, h: r.height,
    })
  }
  return out
})

const buf = await page.screenshot({ type: 'png' })
// 留一张原图，方便人工复核脚本取的像素对不对（根目录的 *.png 已在 .gitignore 里）
fs.writeFileSync('px-contrast-shot.png', buf)
const png = PNG.sync.read(buf)
const at = (x, y) => {
  const i = (png.width * y + x) << 2
  return [png.data[i], png.data[i + 1], png.data[i + 2]]
}

console.log('text'.padEnd(10), 'declared'.padEnd(22), 'px-darkest'.padEnd(11), 'px-bg'.padEnd(9), 'ratio')
for (const t of targets) {
  const x0 = Math.max(0, Math.round(t.x * DPR))
  const y0 = Math.max(0, Math.round(t.y * DPR))
  const x1 = Math.min(png.width - 1, Math.round((t.x + t.w) * DPR))
  const y1 = Math.min(png.height - 1, Math.round((t.y + t.h) * DPR))

  let dark = [255, 255, 255]
  let light = [0, 0, 0]
  const bgs = []
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = at(x, y)
      if (lum(p) < lum(dark)) dark = p
      if (lum(p) > lum(light)) light = p
    }
  }
  // 背景取包围盒外 3px 的一圈
  for (let x = x0; x <= x1; x++) {
    for (const y of [y0 - 3 * DPR, y1 + 3 * DPR]) {
      if (y >= 0 && y < png.height) bgs.push(at(x, y))
    }
  }
  bgs.sort((a, b) => lum(a) - lum(b))
  const bg = bgs[Math.floor(bgs.length / 2)] ?? [255, 255, 255]

  // 深底浅字时最暗的像素是背景本身 —— 取离背景更远的那一端才是字
  const fg = Math.abs(lum(light) - lum(bg)) > Math.abs(lum(dark) - lum(bg)) ? light : dark

  console.log(
    t.text.padEnd(10),
    `${t.color} ${t.fontSize}`.padEnd(22),
    hex(fg).padEnd(11),
    hex(bg).padEnd(9),
    ratio(fg, bg).toFixed(2) + ':1',
  )
}

await browser.close()
