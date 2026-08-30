/**
 * 战报画笔：把 `features/shareCard.ts` 算好的显示列表画到 canvas 上。
 *
 * 这里**只画不判断** —— 没有一行代码知道什么是「答对」或「お手つき」。
 * 游戏知识全在显示列表那一侧，所以这个文件可以待在 `ui/`。
 */

import { ACCENT, CARD_H, CARD_W, INK, PAPER, type DrawOp, type ImageRequest } from '../features/shareCard'

/** 导出倍率。逻辑 720×1080 → 实际 1440×2160 */
export const SCALE = 2

// ─────────────────────────────────────────────────────────
// 前置资源
// ─────────────────────────────────────────────────────────

/**
 * 等字体真正可用再画。
 *
 * `ctx.font` 在字体没加载完时会**静默回退**到默认字体，并按回退字体的宽度排版 ——
 * 结果是一张字距全错、还不会报任何错的图。这是本功能唯一一个「看起来成功了的失败」。
 *
 * 加载失败不抛：按回退字体出图，总好过把人卡在对话框里。
 */
export async function ensureFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return
  const wanted = [
    '700 78px Jost',
    '700 28px Jost',
    '700 20px Jost',
    '600 16px Jost',
    '600 10px Jost',
    '700 26px "Noto Sans JP"',
    '700 16px "Noto Sans JP"',
    '400 15px "Noto Sans JP"',
    '400 12px "Noto Sans JP"',
  ]
  await Promise.all(wanted.map((f) => document.fonts.load(f).catch(() => undefined)))
}

export type ImageBag = Map<string, HTMLImageElement>

function loadOne(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    // 封面与表情都是同源（/thumb 由服务端给，dev 下 vite 代理；/emote 是前端静态资源），
    // 所以不设 crossOrigin，canvas 也不会被污染，toBlob 不会抛 SecurityError。
    img.src = src
  })
}

/**
 * 预加载图片。主地址拿不到就试 fallback；两个都不行的**不放进 Map**，
 * 画笔遇到缺图跳过这一条 —— 某张封面 404 不该让整张战报画不出来。
 *
 * 结果一律以主地址为键，所以画笔不需要知道自己拿到的是正片还是替补。
 */
export async function loadImages(reqs: readonly ImageRequest[]): Promise<ImageBag> {
  const bag: ImageBag = new Map()
  await Promise.all(
    reqs.map(async ({ src, fallback }) => {
      const img = (await loadOne(src)) ?? (fallback ? await loadOne(fallback) : null)
      if (img) bag.set(src, img)
    }),
  )
  return bag
}

// ─────────────────────────────────────────────────────────
// 纸纹
// ─────────────────────────────────────────────────────────

/**
 * 噪点按尺寸缓存。1440×2160 是三百多万个像素，每次导出重算一遍
 * 会在点「导出」到出图之间插进一段肉眼可见的卡顿。
 */
const noiseCache = new Map<string, HTMLCanvasElement>()

function noiseLayer(w: number, h: number): HTMLCanvasElement | null {
  const key = `${w}x${h}`
  const hit = noiseCache.get(key)
  if (hit) return hit

  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const c = cv.getContext('2d')
  if (!c) return null

  const data = c.createImageData(w, h)
  const px = data.data
  for (let i = 0; i < px.length; i += 4) {
    px[i] = 0x2b
    px[i + 1] = 0x2c
    px[i + 2] = 0x5e
    // 大部分像素完全透明，少数带一点点墨。均匀铺满会变成灰雾，不是纸
    px[i + 3] = Math.random() < 0.26 ? Math.floor(Math.random() * 24) : 0
  }
  c.putImageData(data, 0, 0)
  noiseCache.set(key, cv)
  return cv
}

// ─────────────────────────────────────────────────────────
// 主入口
// ─────────────────────────────────────────────────────────

export function paintTicket(ctx: CanvasRenderingContext2D, ops: readonly DrawOp[], images: ImageBag): void {
  ctx.save()
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0)
  ctx.textBaseline = 'alphabetic'

  for (const op of ops) {
    // 套印不准：粉色版整体偏一点点再印一层淡的。双色丝网印最典型的瑕疵，
    // 也是这个风格最容易被认出来的地方。靛蓝版不偏——两版都偏就成了单纯的模糊。
    if (opColor(op) === ACCENT) {
      ctx.save()
      ctx.globalAlpha = 0.3
      ctx.translate(1.5, -1)
      drawOne(ctx, op, images)
      ctx.restore()
    }
    drawOne(ctx, op, images)
  }

  ctx.restore()
}

function opColor(op: DrawOp): string | undefined {
  switch (op.k) {
    case 'text':
    case 'vtext':
    case 'rule':
    case 'stamp':
    case 'barcode':
      return op.color
    case 'rect':
      return op.stroke ?? op.fill
    default:
      return undefined
  }
}

function drawOne(ctx: CanvasRenderingContext2D, op: DrawOp, images: ImageBag): void {
  switch (op.k) {
    case 'paper':
      return paintPaper(ctx, op.w, op.h)
    case 'rect':
      return paintRect(ctx, op)
    case 'rule':
      return paintRule(ctx, op)
    case 'text':
      return paintText(ctx, op)
    case 'vtext':
      return paintVText(ctx, op)
    case 'image':
      return paintImage(ctx, op, images)
    case 'hole':
      return paintHole(ctx, op)
    case 'stamp':
      return paintStamp(ctx, op)
    case 'barcode':
      return paintBarcode(ctx, op)
    case 'tick':
      return paintTick(ctx, op)
  }
}

// ─────────────────────────────────────────────────────────
// 各原语
// ─────────────────────────────────────────────────────────

function paintPaper(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, w, h)
  /*
    噪点按**逻辑**分辨率生成，再由 drawImage 放大到导出分辨率。
    不是为了省事：像素级白噪是 PNG 的压缩率杀手，按 1440×2160 生成时
    整张图 3.5MB，其中绝大部分是噪点的熵。放大一倍后颗粒成块、且被
    插值柔化，压缩率回来了，看着也更像纸纤维而不是电视雪花。
  */
  const n = noiseLayer(Math.round(w), Math.round(h))
  if (!n) return
  // 关掉插值，让放大后是干净的 2×2 色块。开着插值的话每个像素都被算成一个
  // 新的中间值，熵一点没降，PNG 还是压不动（实测同一张图 3.45MB → 1.46MB）。
  const smooth = ctx.imageSmoothingEnabled
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(n, 0, 0, w, h)
  ctx.imageSmoothingEnabled = smooth
}

function paintRect(ctx: CanvasRenderingContext2D, op: Extract<DrawOp, { k: 'rect' }>): void {
  if (op.fill) {
    ctx.fillStyle = op.fill
    ctx.fillRect(op.x, op.y, op.w, op.h)
  }
  if (op.stroke) {
    ctx.strokeStyle = op.stroke
    ctx.lineWidth = op.lw ?? 1
    ctx.strokeRect(op.x, op.y, op.w, op.h)
  }
}

function paintRule(ctx: CanvasRenderingContext2D, op: Extract<DrawOp, { k: 'rule' }>): void {
  ctx.save()
  ctx.strokeStyle = op.color
  ctx.lineWidth = op.lw
  ctx.setLineDash(op.dash ?? [])
  ctx.beginPath()
  ctx.moveTo(op.x1, op.y1)
  ctx.lineTo(op.x2, op.y2)
  ctx.stroke()
  ctx.restore()
}

/** 逐字推进，因为 Canvas 没有 letter-spacing（Safari 至今不支持 ctx.letterSpacing） */
function paintText(ctx: CanvasRenderingContext2D, op: Extract<DrawOp, { k: 'text' }>): void {
  ctx.fillStyle = op.color
  ctx.font = op.font
  const align = op.align ?? 'left'

  if (!op.tracking) {
    ctx.textAlign = align
    ctx.fillText(op.text, op.x, op.y)
    return
  }

  const chars = [...op.text]
  const widths = chars.map((c) => ctx.measureText(c).width)
  const total = widths.reduce((a, b) => a + b, 0) + op.tracking * Math.max(chars.length - 1, 0)
  let x = align === 'center' ? op.x - total / 2 : align === 'right' ? op.x - total : op.x

  ctx.textAlign = 'left'
  chars.forEach((c, i) => {
    ctx.fillText(c, x, op.y)
    x += widths[i]! + op.tracking!
  })
}

function paintVText(ctx: CanvasRenderingContext2D, op: Extract<DrawOp, { k: 'vtext' }>): void {
  ctx.fillStyle = op.color
  ctx.font = op.font
  ctx.textAlign = 'center'
  let y = op.y
  for (const c of [...op.text]) {
    ctx.fillText(c, op.x, y)
    y += op.step
  }
}

function paintImage(ctx: CanvasRenderingContext2D, op: Extract<DrawOp, { k: 'image' }>, images: ImageBag): void {
  const img = images.get(op.src)
  if (!img) return // 缺图就不画。破图比没图难看得多

  const iw = img.naturalWidth || op.w
  const ih = img.naturalHeight || op.h

  if (op.fit === 'contain') {
    const s = Math.min(op.w / iw, op.h / ih)
    const w = iw * s
    const h = ih * s
    ctx.drawImage(img, op.x + (op.w - w) / 2, op.y + (op.h - h) / 2, w, h)
    return
  }

  // cover：裁源图的中间一块
  const s = Math.max(op.w / iw, op.h / ih)
  const sw = op.w / s
  const sh = op.h / s
  ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, op.x, op.y, op.w, op.h)
}

function paintHole(ctx: CanvasRenderingContext2D, op: Extract<DrawOp, { k: 'hole' }>): void {
  // 孔用纸色填、靛蓝描边：看着像纸被真打穿了，而不是画了个圆
  ctx.fillStyle = PAPER
  ctx.beginPath()
  ctx.arc(op.cx, op.cy, op.r, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = 0.8
  ctx.stroke()
}

function paintStamp(ctx: CanvasRenderingContext2D, op: Extract<DrawOp, { k: 'stamp' }>): void {
  ctx.save()
  ctx.translate(op.cx, op.cy)
  ctx.rotate(op.rotate)
  // multiply：印章是盖在已经印好的内容上的，不该把下面的东西挡掉
  ctx.globalCompositeOperation = 'multiply'
  ctx.globalAlpha = 0.85
  ctx.strokeStyle = op.color
  ctx.fillStyle = op.color

  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(0, 0, op.r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.arc(0, 0, op.r - 7, 0, Math.PI * 2)
  ctx.stroke()

  // 环形小字：绕一整圈均分，每个字自己也要转到切线方向
  const ring = [...op.ring]
  if (ring.length > 0) {
    ctx.font = '600 9px Jost, sans-serif'
    ctx.textAlign = 'center'
    const step = (Math.PI * 2) / ring.length
    ring.forEach((c, i) => {
      ctx.save()
      ctx.rotate(i * step)
      ctx.translate(0, -(op.r - 15))
      ctx.fillText(c, 0, 0)
      ctx.restore()
    })
  }

  ctx.font = `700 ${op.main.length >= 3 ? 24 : 32}px "Noto Sans JP", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(op.main, 0, 1)
  ctx.textBaseline = 'alphabetic'
  ctx.restore()
}

function paintBarcode(ctx: CanvasRenderingContext2D, op: Extract<DrawOp, { k: 'barcode' }>): void {
  ctx.fillStyle = op.color
  // 线性同余：同一个种子出同一组条纹，所以同一局导出两次条码长得一样
  let s = op.seed >>> 0
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
  let x = op.x
  while (x < op.x + op.w) {
    const bar = 1 + Math.floor(next() * 3)
    const gap = 1 + Math.floor(next() * 3)
    const draw = Math.min(bar, op.x + op.w - x)
    if (draw > 0) ctx.fillRect(x, op.y, draw, op.h)
    x += bar + gap
  }
}

function paintTick(ctx: CanvasRenderingContext2D, op: Extract<DrawOp, { k: 'tick' }>): void {
  const { x, y, size: s } = op

  if (op.state === 'skip') {
    // 未作答画空框：和「答错」必须一眼能分开，光靠颜色深浅不够
    ctx.strokeStyle = INK
    ctx.lineWidth = 1.2
    ctx.strokeRect(x + 0.6, y + 0.6, s - 1.2, s - 1.2)
    return
  }

  ctx.fillStyle = op.state === 'ok' ? INK : ACCENT
  ctx.fillRect(x, y, s, s)

  ctx.strokeStyle = PAPER
  ctx.lineWidth = Math.max(1.6, s * 0.11)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  if (op.state === 'ok') {
    ctx.moveTo(x + s * 0.24, y + s * 0.52)
    ctx.lineTo(x + s * 0.43, y + s * 0.71)
    ctx.lineTo(x + s * 0.77, y + s * 0.3)
  } else {
    ctx.moveTo(x + s * 0.29, y + s * 0.29)
    ctx.lineTo(x + s * 0.71, y + s * 0.71)
    ctx.moveTo(x + s * 0.71, y + s * 0.29)
    ctx.lineTo(x + s * 0.29, y + s * 0.71)
  }
  ctx.stroke()
}

// ─────────────────────────────────────────────────────────
// 画布
// ─────────────────────────────────────────────────────────

/** 按导出倍率准备好一张画布 */
export function prepareCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  canvas.width = CARD_W * SCALE
  canvas.height = CARD_H * SCALE
  return canvas.getContext('2d')
}

/** 交给显示列表用的量测函数。字体要先 set 再 measure，否则量的是上一次的字体 */
export function measurer(ctx: CanvasRenderingContext2D): (text: string, font: string) => number {
  return (text, font) => {
    ctx.font = font
    return ctx.measureText(text).width
  }
}
