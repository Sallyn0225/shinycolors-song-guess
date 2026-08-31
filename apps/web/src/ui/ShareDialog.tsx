import { useCallback, useEffect, useRef, useState } from 'react'

import { CARD_H, CARD_W, collectImageRequests, type DrawOp, type Measure } from '../features/shareCard'

import { Button } from './Button'
import { Field } from './Field'
import { Overlay, OverlayMark } from './Overlay'
import { ensureFonts, loadImages, measurer, paintTicket, prepareCanvas, type ImageBag } from './ticketPainter'

interface Props {
  /** 对话框的无障碍名 */
  label: string
  /** 预填的 ID */
  defaultId: string
  /** 文件名里那一段，区分单机与联机 */
  kind: string
  build: (playerId: string, measure: Measure) => DrawOp[]
  onClose: () => void
}

const ID_KEY = 'scg.shareId'
const MAX_ID = 16 // 与联机 nickname 上限一致

/** localStorage 在无痕模式下会直接抛，读写都得兜住 */
function readSavedId(): string {
  try {
    return localStorage.getItem(ID_KEY) ?? ''
  } catch {
    return ''
  }
}

function saveId(v: string): void {
  try {
    localStorage.setItem(ID_KEY, v)
  } catch {
    /* 记不住就算了，不该因此挡住导出 */
  }
}

function fileName(kind: string, id: string, at: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}`
  // Windows 的文件名禁用字符，留着会导致下载被静默改名或失败
  const safe = id.trim().replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, MAX_ID) || '匿名P'
  return `战报-${kind}-${safe}-${stamp}.png`
}

/**
 * 导出战报对话框：填 ID → 预览 → 下载。
 *
 * 纯本地渲染，不发任何网络请求，也不动对局状态 ——
 * 联机结算浮层里开关它一次，再战投票不该因此被取消。
 */
export function ShareDialog({ label, defaultId, kind, build, onClose }: Props) {
  const [id, setId] = useState(() => readSavedId() || defaultId)
  const [ready, setReady] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bagRef = useRef<ImageBag>(new Map())
  // build 每次渲染都是新函数，放进 effect 依赖会导致无限重绘
  const buildRef = useRef(build)
  buildRef.current = build

  /** 重画一次。图片已经在 bagRef 里，所以改 ID 只走这一步 */
  const repaint = useCallback((playerId: string) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = prepareCanvas(canvas)
    if (!ctx) return
    paintTicket(ctx, buildRef.current(playerId, measurer(ctx)), bagRef.current)
  }, [])

  // 首绘：先等字体，再把图片一次性加载好
  useEffect(() => {
    let alive = true
    void (async () => {
      await ensureFonts()
      if (!alive) return

      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = prepareCanvas(canvas)
      if (!ctx) return

      // 先构一次只为了知道要加载哪些图，扔掉结果
      const probe = buildRef.current(id, measurer(ctx))
      bagRef.current = await loadImages(collectImageRequests(probe))
      if (!alive) return

      repaint(id)
      setReady(true)
    })()
    return () => {
      alive = false
    }
    // 只跑一次：ID 变化走下面那个 effect，不需要重新加载图片
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 改 ID 只重算显示列表并重画
  useEffect(() => {
    if (ready) repaint(id)
  }, [id, ready, repaint])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const download = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    saveId(id.trim())
    setNote(null)

    canvas.toBlob((blob) => {
      if (!blob) {
        setNote('这个浏览器没能生成图片。可以长按上面的预览图另存。')
        return
      }
      // 一律走浏览器下载，不探测 navigator.share。
      // 曾经优先用系统分享（手机上能直接发进聊天），但 Windows 的 Chrome / Edge
      // 同样宣称支持带文件的 Web Share，于是桌面端点「保存图片」弹出的是共享面板，
      // 而不是把文件落到本地 —— 按钮写着「保存」就该保存。
      saveBlob(blob, fileName(kind, id, new Date()), setNote)
    }, 'image/png')
  }, [id, kind])

  return (
    <Overlay label={label} z={60}>
      {/*
        Overlay 是 justify-center 的，溢出会平分到上下两端，而滚动条只能往下走 ——
        内容一高，卡片顶部就滚不回来了（quality-guidelines 记过这个坑）。
        所以卡片自己封顶并可滚，永远不会有够不着的部分。
      */}
      <span
        className="cut-shadow-lg anim-appear w-full"
        style={{ maxWidth: 'var(--page-card)', maxHeight: '92dvh', overflowY: 'auto' }}
      >
        <div className="glass-lit cut-card px-7 pt-11 pb-7 text-left">
          <OverlayMark />

          <p className="mt-4 text-lg font-bold text-ink">导出战报</p>
          <p className="jp-wrap mt-1 text-xs text-ink-sub">
            填一个 ID，它会印在图上。留空则显示「匿名P」。
          </p>

          <label className="mt-5 block">
            <span className="text-2xs font-semibold tracking-[0.3em] text-primary">你的 ID</span>
            <span className="mt-2 block">
              <Field
                value={id}
                maxLength={MAX_ID}
                placeholder="匿名P"
                onChange={(e) => setId(e.target.value)}
              />
            </span>
          </label>

          {/*
            预览就是最终产物本身：同一张 canvas 缩小显示，不另画一份低配版。
            两套渲染路径必然会走形，而且走形的那次正好是导出的那次。
          */}
          <div className="mt-5 flex justify-center">
            {/*
              尺寸给在 height 上、width 交给 aspect-ratio，而不是 width:100% + object-fit。
              canvas 的内容永远铺满元素盒子，盒子比例一旦不对画面就直接被拉伸，
              而 object-fit 能不能救回来取决于浏览器把 canvas 当不当替换元素。
              让盒子本身就是 2:3，就没有可拉伸的余地。
            */}
            <canvas
              ref={canvasRef}
              role="img"
              aria-label="战报预览"
              className="block max-w-full"
              style={{
                height: 'min(calc(400 * var(--u)), 40dvh)',
                aspectRatio: `${CARD_W} / ${CARD_H}`,
                opacity: ready ? 1 : 0.3,
                transition: 'opacity 300ms var(--ease-prism)',
              }}
            />
          </div>

          <p role="status" aria-live="polite" className="jp-wrap mt-3 min-h-[1.5em] text-xs text-ink-sub">
            {note ?? (ready ? '长按或右键预览图也可以直接保存。' : '正在生成…')}
          </p>

          <div className="mt-5 flex flex-col gap-3">
            <Button variant="primary" size="lg" full disabled={!ready} onClick={download}>
              保存图片
            </Button>
            <Button variant="ghost" size="md" full onClick={onClose}>
              返回
            </Button>
          </div>
        </div>
      </span>
    </Overlay>
  )
}

/** 唯一的保存路径：造一个带 download 的 <a> 交给浏览器下载器 */
function saveBlob(blob: Blob, name: string, setNote: (s: string) => void): void {
  let url: string | null = null
  try {
    url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    // iOS Safari 与旧 Firefox 只对挂在文档里的锚点派发默认行为，
    // 游离节点上的 click() 会被静默吞掉 —— 桌面 Chrome 不需要这步，但它无害
    a.style.display = 'none'
    document.body.append(a)
    a.click()
    a.remove()
    // 立刻 revoke 会让部分浏览器来不及取到内容，下载出一个 0 字节文件
    setTimeout(() => URL.revokeObjectURL(url as string), 10_000)
    setNote('已开始下载，去浏览器的下载列表里找它。')
  } catch {
    if (url) URL.revokeObjectURL(url)
    setNote('下载被浏览器拦下了。可以长按上面的预览图另存。')
  }
}
