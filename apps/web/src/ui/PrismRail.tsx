import { useEffect, useRef } from 'react'

import { audio } from '../audio'

/**
 * 一条光。
 *
 * 这是整套界面里唯一会动的东西，它同时回答四件事：
 *   · 还剩多久   —— 光带从两端向中央收
 *   · 现在在播吗 —— 频谱从光带上缘长出，由 AnalyserNode 驱动，是真实响应正在播放的音频
 *   · 走到哪了   —— 答过的题在光带上留下折痕，整局轨迹一直可见
 *   · 谁的地盘   —— mirror 模式下它就是自陣与敵陣之间的那道界线
 *
 * 硬性实现约束（不是风格偏好）：
 *   1. 整个组件只有一个 rAF 循环，全部直写 DOM。任何一帧都不许 setState ——
 *      React 18 的并发调度会批处理每帧 setState，表现就是「有时候没反应」。
 *   2. 收缩用 clip-path，且**不加 transition**。一加就是补间，就不锁时钟了；
 *      这条光带的意义就在于它严格跟着音频时钟走。
 *   3. 时间映射严格线性，不做缓动。
 *   4. 光带在任何宽度下只缩放不换行，不折成两行，不改成环形。
 */

const BARS = 108
/** analyser 的 fftSize 是 256 → 128 个 bin，覆盖 0~24kHz。整组都要读到才能做对数映射 */
const BINS = 128
/** 只用到 ~15kHz（Opus 64kbps 单声道再往上基本是空的），对应 bin 80 */
const BIN_LO = 1
const BIN_HI = 80
/*
  下面三个常量是量出来的，不是试出来的。

  把映射临时换成恒等、在每根柱的中心取样，量得对数映射后的真实分布：
    六等分平均 [.97 .80 .67 .66 .58 .51]   —— 左右只差 1.9 倍
    分位 p05 .44 / p25 .61 / p50 .67 / p75 .80 / p95 .99

  关键是**值域挤在量程上半段**：AnalyserNode 的 minDecibels −100 / maxDecibels −30
  把一段响的混音全映到 0.44~1.0。任何低于 0.44 的拐点都会让每一根顶满 ——
  我先后试过 0.12 与 0.36，两次都是满格的墙，因为拐点定在了数据的下方。
*/
/**
 * 实测的静态频谱剖面（六等分平均，左→右）。
 * 每根柱除以它所在位置的剖面值，全宽就都以 1.0 为基准 ——
 * 这样一个拐点能通吃全宽。乘一条猜的指数斜率做不到这件事：
 * 斜率与真实剖面对不上时，全局拐点必然要么切掉左边、要么放过右边。
 */
const PROFILE_PTS = [0.97, 0.8, 0.67, 0.66, 0.58, 0.51]
/**
 * 拐点与跨度，表示为「当前帧最高柱的比例」。
 * 窗口很窄（0.86~1.00）是因为数据本身压得极紧：getByteFrequencyData 是 dB 刻度，
 * 除以剖面之后，中位柱就落在帧最大值的 88%。拐点必须压到那儿，多数格子才会矮。
 * 用比例而不是绝对值：每首曲子的响度和频谱形状都不同，绝对拐点是在拿单曲调参 ——
 * 实测同一组常量换一首歌就会在「全顶满」和「全贴地」之间跳。
 * 按帧最大值取相对阈值则与曲子无关；又因为它是**全帧**的、不是逐带的，
 * 不会像逐带自适应那样把左右翻过来。
 */
const KNEE = 0.86
const SPAN = 0.14

/** 把六个测点插值成每根柱的除数，模块加载时算一次 */
const PROFILE = Array.from({ length: BARS }, (_, i) => {
  const x = (i / (BARS - 1)) * (PROFILE_PTS.length - 1)
  const a = Math.min(PROFILE_PTS.length - 1, Math.floor(x))
  const b = Math.min(PROFILE_PTS.length - 1, a + 1)
  const f = x - a
  const v = (PROFILE_PTS[a] as number) * (1 - f) + (PROFILE_PTS[b] as number) * f
  // 0.85 次幂：完全抹平会让高频的相对起伏被放大成主角（实测高柱全跑到右边），
  // 留一点自然的低频优势，音乐才不像被均衡器压过
  return Math.max(0.05, Math.pow(v, 0.85))
})

/** 棱镜彩虹取色。与 CSS 里的 --grad-prism 同一组停靠点 */
const PRISM: Array<[number, [number, number, number]]> = [
  [0.0, [0xff, 0x88, 0xff]],
  [0.35, [0x77, 0xff, 0xff]],
  [0.7, [0xff, 0xf3, 0x52]],
  [1.0, [0xff, 0x70, 0x70]],
]

function prismAt(t: number): string {
  const x = Math.min(1, Math.max(0, t))
  let i = 0
  while (i < PRISM.length - 2 && (PRISM[i + 1] as (typeof PRISM)[number])[0] < x) i++
  const [p0, c0] = PRISM[i] as (typeof PRISM)[number]
  const [p1, c1] = PRISM[i + 1] as (typeof PRISM)[number]
  const f = p1 === p0 ? 0 : (x - p0) / (p1 - p0)
  const r = Math.round(c0[0] + (c1[0] - c0[0]) * f)
  const g = Math.round(c0[1] + (c1[1] - c0[1]) * f)
  const b = Math.round(c0[2] + (c1[2] - c0[2]) * f)
  return `rgb(${r},${g},${b})`
}

export interface Crease {
  /** 在光带上的位置，0~1 */
  at: number
  tone: 'good' | 'bad' | 'pending'
}

interface Props {
  /**
   * 取剩余时间比例 0~1。传函数而不是数值：倒计时靠 rAF 直接写 DOM。
   * 不传则光带常亮（首页、大厅那种没有计时的场合）。
   */
  getRemaining?: () => number
  /** 画频谱。默认画 */
  spectrum?: boolean
  /** 走过的折痕 */
  creases?: Crease[]
  /** top：频谱向上长。mirror：上下对称，光带本身成为分界线。idle：只有一条静止的光 */
  mode?: 'top' | 'mirror' | 'idle'
  /** 无障碍：这条光带在计什么 */
  label?: string
  className?: string
}

export function PrismRail({
  getRemaining,
  spectrum = true,
  creases,
  mode = 'top',
  label,
  className = '',
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef(0)

  const levels = useRef(new Float32Array(BINS))
  const smooth = useRef(new Float32Array(BARS))
  /** 剖面归一后的中间量，避免每帧分配 */
  const shaped = useRef(new Float32Array(BARS))

  // 每帧从 ref 读最新的取值函数，避免把 effect 绑在它的身份上重启 rAF
  const getRemainingRef = useRef(getRemaining)
  getRemainingRef.current = getRemaining
  const modeRef = useRef(mode)
  modeRef.current = mode
  const spectrumRef = useRef(spectrum)
  spectrumRef.current = spectrum

  useEffect(() => {
    const canvas = canvasRef.current
    const track = trackRef.current
    const root = rootRef.current
    if (!canvas || !track || !root) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (w === 0 || h === 0) return
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    let lastPct = -1

    const frame = () => {
      rafRef.current = requestAnimationFrame(frame)

      // ── 收缩：直写 clip-path，无 transition，严格线性 ──────────
      const get = getRemainingRef.current
      const remaining = get ? Math.max(0, Math.min(1, get())) : 1
      const inset = (1 - remaining) * 50
      track.style.clipPath = `inset(0 ${inset}% 0 ${inset}%)`

      // aria 值最多每 1% 更新一次，别让读屏软件被每帧刷屏
      const pct = Math.round(remaining * 100)
      if (pct !== lastPct) {
        root.setAttribute('aria-valuenow', String(pct))
        lastPct = pct
      }

      // ── 频谱 ────────────────────────────────────────────────
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (w === 0 || h === 0) return
      ctx.clearRect(0, 0, w, h)
      if (!spectrumRef.current) return

      // 直接问引擎在不在出声，不依赖 React state
      const got = audio.isPlaying && audio.spectrum(levels.current)
      const mirror = modeRef.current === 'mirror'
      const baseY = mirror ? h / 2 : h
      const maxLen = mirror ? h / 2 : h

      /*
        这条频谱的性格由三件事决定，三件都不能省：

        ① 对数频率映射。fftSize=256 → 128 个 bin 线性覆盖 0~24kHz，而 64kbps 单声道
           Opus 的能量几乎全在 5kHz 以下。线性取样会把四分之三的宽度分给一段近乎
           无声的高频，画出来就是「左边一堆、右边全平」。按倍频程取样，每一格才都落在
           有内容的地方。

        ② 除以实测的静态剖面。低频比高频响（实测六等分 [.97 .80 .67 .66 .58 .51]），
           不校正右半边就恒暗。用「除以剖面」而不是「乘一条斜率」：斜率对不上真实剖面时，
           后面那个全局拐点必然要么切掉左边、要么放过右边。

        ③ 绝对映射，不做任何逐帧/逐带归一。
           这一条是试错换来的：按帧峰值归一会在「左重」和「右重」之间硬切
           （TILT 1 → [36,9,3,3,1]，TILT 5 → [1,1,5,22,35]，中间没有稳定区间）；
           按每格自己的近期平均归一，则每根都停在自己的平均线上 —— 实测 CV 掉到 0.05，
           整条光带成了一堵等高的墙。两者都是反馈回路，都会自己走掉。
           固定拐点没有回路：响的带高、静的带矮、同一带随音乐起伏，全部可静态推演。

        另外，AnalyserNode 的 minDecibels −100 / maxDecibels −30 把一段响的混音全映到
        0.44~1.0 —— 拐点定在这个区间之下就是一堵满格的墙。先后试过 0.12 和 0.36，都是。
      */
      // ① 对数取样 + ② 除以静态剖面
      let frameMax = 1e-4
      for (let i = 0; i < BARS; i++) {
        const t = i / (BARS - 1)
        const pos = BIN_LO * Math.pow(BIN_HI / BIN_LO, t)
        const lo = Math.floor(pos)
        const hi2 = Math.min(BINS - 1, lo + 1)
        const f = pos - lo
        const v = got ? (levels.current[lo] ?? 0) * (1 - f) + (levels.current[hi2] ?? 0) * f : 0
        const n = v / (PROFILE[i] as number)
        shaped.current[i] = n
        if (n > frameMax) frameMax = n
      }
      // ③ 以本帧最高柱为 1，取相对拐点
      for (let i = 0; i < BARS; i++) {
        const rel = shaped.current[i]! / frameMax
        const above = Math.min(1, Math.max(0, (rel - KNEE) / SPAN))
        const target0 = got ? 0.02 + 0.78 * above ** 1.35 : 0
        const target = reduce ? target0 * 0.4 : target0
        const prev = smooth.current[i] ?? 0
        // 起快落慢，但落得没那么慢 —— 慢回落正是把频谱抹平成栅栏的元凶
        smooth.current[i] = prev + (target - prev) * (target > prev ? 0.6 : 0.3)
      }

      const step = w / BARS
      const barW = Math.max(1, step * 0.46)
      for (let i = 0; i < BARS; i++) {
        const level = smooth.current[i] ?? 0
        if (level <= 0.004) continue
        const len = Math.max(1, level * maxLen)
        const x = i * step + (step - barW) / 2
        ctx.fillStyle = prismAt(i / BARS)
        ctx.globalAlpha = 0.35 + level * 0.65
        ctx.fillRect(x, baseY - len, barW, len)
        if (mirror) ctx.fillRect(x, baseY, barW, len)
      }
      ctx.globalAlpha = 1
    }

    rafRef.current = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
    }
  }, [])

  /*
    频谱带的高度就是它的动态范围上限。原来 top 只有 46u（≈49px），
    而 comp 的频谱带约 140px —— 峰再高也长不出来，只能摊成栅栏。

    但这个高度只在**真的画频谱**时才有意义。光带线本身是 bottom: 0，
    所以 spectrum={false} 的场合（首页、大厅）这 112u 全部变成光带上方的空白：
    实测 1440 宽下段落底边 y=231、光带 y≈370，中间 139px 一无所有，
    首页 Hero 因此看着像浮在左上角。没有频谱就只占光带自己的 3px。

    mirror 不参与这个判断：牌场的光带必须落在场区几何中线上，
    那条线的全部意义就是「自陣与敵陣之间的界线」（见 index.css 的 .sc-panelrow）。
  */
  const span =
    mode === 'mirror' ? 'calc(120 * var(--u))' : spectrum ? 'calc(112 * var(--u))' : '3px'

  return (
    <div
      ref={rootRef}
      className={`relative w-full ${className}`.trim()}
      style={{ height: span }}
      {...(getRemaining
        ? {
            role: 'progressbar' as const,
            'aria-valuemin': 0,
            'aria-valuemax': 100,
            'aria-label': label ?? '剩余时间',
          }
        : { role: 'presentation' as const })}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />

      {/* 未点亮的轨道兜底，让「收掉了多少」看得出来 */}
      <div
        aria-hidden
        className="absolute inset-x-0"
        style={{
          top: mode === 'mirror' ? 'calc(50% - 1.5px)' : 'auto',
          bottom: mode === 'mirror' ? 'auto' : 0,
          height: '3px',
          background: 'rgb(162 162 192 / .34)',
        }}
      />
      {/* 点亮的那一段。白底上 1px 的彩虹会被冲掉，所以给 3px 并垫一层紫影 */}
      <div
        ref={trackRef}
        aria-hidden
        className="absolute inset-x-0"
        style={{
          top: mode === 'mirror' ? 'calc(50% - 1.5px)' : 'auto',
          bottom: mode === 'mirror' ? 'auto' : 0,
          height: '3px',
          background: 'var(--grad-prism)',
          boxShadow: '0 1px 6px rgb(71 68 150 / .28)',
        }}
      />

      {/* 折痕：答过的题留在光带上，整局的轨迹一直可见 */}
      {creases && creases.length > 0 && (
        <div aria-hidden className="pointer-events-none absolute inset-x-0" style={{ bottom: 0 }}>
          {creases.map((c, i) => (
            <span
              key={i}
              className="absolute block"
              style={{
                left: `${c.at * 100}%`,
                bottom: '-1px',
                width: '3px',
                height: c.tone === 'pending' ? 'calc(6 * var(--u))' : 'calc(12 * var(--u))',
                transform: 'translateX(-1px)',
                // 判定色在 Play、Result 与这条光带上必须一致，
                // 否则「答对」在三处是三种颜色
                background:
                  c.tone === 'good'
                    ? 'var(--color-correct)'
                    : c.tone === 'bad'
                      ? 'var(--color-wrong)'
                      : 'transparent',
                boxShadow:
                  c.tone === 'pending' ? 'inset 0 0 0 1px rgb(162 162 192 / .6)' : undefined,
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
