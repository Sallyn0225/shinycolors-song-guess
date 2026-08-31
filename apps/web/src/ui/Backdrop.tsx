import { useEffect, useRef, useState } from 'react'

/**
 * 页面底衬。官网靠两张位图贴出来（bg_back 虹彩镭射膜 + bg_geo 晶体碎片），
 * 这两个文件我们没有，所以纯 CSS/SVG 程序化重建 —— 零字节下载，且能跟着视口走。
 *
 * 六层，自下而上（⓪ 与 ⓪′ 只在 video 开着时存在）：
 *   ⓪ 循环视频     MV 剪辑，无声、cover 铺满、轻微模糊
 *   ⓪′ 乳化遮罩    中心浓、边缘薄的径向白幕，把视频压回「底衬」而不是「画面」
 *   ① 虹彩镭射膜   超大低透明径向渐变叠出粉/薄荷/青/奶油黄的膜感
 *   ② 晶体碎片     多边形图案，rgb(97 95 144 / .02)，几乎看不见但让白色区域有折射质地
 *   ③ 上缘淡出     内容区上缘融入背景（官网的 fade 遮罩）
 *   ④ 前景碎片     只在视口最外缘露一点，叠在内容之上做景深
 *
 * 「几乎看不见」是硬指标不是形容词：一旦纹样能被当成图案读出来，
 * 白玻璃面板的层次就塌了，内容也开始跟底衬抢注意力。视频层受同一条规矩管：
 * 它只负责让白底「有东西在动」，读不出是哪一支 MV 才算调对。
 */

/** 晶体碎片。手写多边形，不落磁盘资源 */
function shards(alpha: number, sparse: boolean): string {
  const polys = sparse
    ? 'M0 0 168 62 74 214Z M690 40 800 0 762 196Z M300 560 480 452 548 640Z'
    : 'M0 0 168 62 74 214Z M286 0 402 128 236 178Z M690 40 800 0 762 196Z ' +
      'M470 246 630 300 530 424Z M0 330 148 386 44 528Z M300 560 480 452 548 640Z ' +
      'M62 660 254 604 180 780Z M690 552 800 640 640 764Z M420 700 566 664 512 800Z'
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">` +
    `<path d="${polys}" fill="rgb(97 95 144 / ${alpha})"/></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

/**
 * z-index 必须是负的，不能是 0。
 *
 * 按 CSS 的绘制顺序，`position: fixed` + `z-index: 0` 的层排在
 * 「非定位元素的行内内容」之后 —— 也就是说它会盖住普通文字，
 * 只有被 filter（.cut-shadow）或定位包起来的元素才幸存。
 * 表现极具迷惑性：卡片正常、标题和普通按钮凭空消失。
 * #root 自带 z-index: 1 的层叠上下文，所以负值不会跑到页面之外。
 */
const FIXED = {
  position: 'fixed',
  inset: 0,
  pointerEvents: 'none',
  zIndex: -1,
} as const

/**
 * 乳化遮罩。这四个数是按对比度倒推的，不是凭手感调的。
 *
 * 内容列宽只有 var(--page-main)，整列都落在 52% 半径以内，那一圈必须 ≥ .90：
 * 视频最暗的一帧（YAVG=16，开头黑场）合成出来的底上，--color-primary 在 .90
 * 是 4.56:1、在 .88 就掉到 4.38:1 —— Stat 的小标正是这个色。
 * 视口最外缘没有文字，放到 .72 让视频透出来，动感全靠那一圈。
 *
 * 想让视频更清楚就往下调，但先回头看一眼上面那个 4.38。
 */
const VEIL =
  'radial-gradient(126% 104% at 50% 48%, ' +
  'rgb(247 246 251 / .94) 0%, rgb(247 246 251 / .91) 52%, ' +
  'rgb(247 246 251 / .84) 80%, rgb(247 246 251 / .72) 100%)'

/**
 * 循环视频层。
 *
 * `muted` 必须同时写在 JSX 和 ref 里：React 把它当普通属性渲染，
 * 而部分浏览器只认开始播放前就已经置上的 **property**，漏了 ref 这一步，
 * 自动播放会被静音策略拦下 —— 表现是首屏一张静止的首帧，控制台什么都不报。
 *
 * scale(1.06) 是给 blur 补边的：模糊会把边缘像素向外晕开成半透明，
 * 不放大就能在四边看到一圈发白的软边。
 *
 * brightness+contrast 是在压动态范围，不是在调好看：这段片子里有 1.2% 的帧
 * 暗到 YAVG<40（开头黑场和几处转场），原样铺出来就是白页面上突然糊一块脏灰。
 * 压完最暗帧从 16 抬到 38，遮罩才接得住。
 */
function VideoLayer() {
  const ref = useRef<HTMLVideoElement>(null)
  /*
    拿到第一帧之前 <video> 画出来是**黑**的，不是透明的。这层铺满整屏，
    在慢网上那 4MB 到齐之前首屏就是一整块黑 —— 比没有视频难看得多。
    所以先 opacity:0，等 canplay 再淡进来。
  */
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.muted = true
    // 缓存命中时 canplay 可能在 effect 跑之前就过去了，补一次现场检查
    if (el.readyState >= 3) setReady(true)
    // 自动播放被拒不是错误，只是这台设备上没有动效，静静地留在首帧即可
    void el.play().catch(() => {})
  }, [])

  return (
    <video
      ref={ref}
      aria-hidden
      tabIndex={-1}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      disablePictureInPicture
      src="/bg/loop.mp4"
      onCanPlay={() => setReady(true)}
      style={{
        ...FIXED,
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        filter: 'brightness(1.18) contrast(0.82) saturate(1.15) blur(calc(3 * var(--u)))',
        transform: 'scale(1.06)',
        opacity: ready ? 1 : 0,
        transition: 'opacity 900ms var(--ease-prism)',
      }}
    />
  )
}

/**
 * 声明了减弱动效就整层不要 —— 不是暂停在首帧，是连那 4MB 都不下。
 * 这套 index.css 里 prefers-reduced-motion 一直是「关掉」而不是「放慢」，
 * 一屏满画幅的循环视频更没有理由破例。
 */
function useCalmed(): boolean {
  const [calm, setCalm] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setCalm(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return calm
}

export function Backdrop({ video = false }: { video?: boolean }) {
  // 先无条件取值再判断 —— 写成 `video && !useCalmed()` 会因短路跳过 hook
  const calmed = useCalmed()
  const on = video && !calmed

  // 挂在 <html> 上而不是就近包一层：--color-ink-faint 要在有视频时压深一档
  // （见 index.css 里 [data-ambient] 那段），而用它的文字散在各屏各组件里
  useEffect(() => {
    if (!on) return
    document.documentElement.dataset['ambient'] = ''
    return () => {
      delete document.documentElement.dataset['ambient']
    }
  }, [on])

  return (
    <>
      {on && <VideoLayer />}
      {/* ⓪′ 乳化遮罩。只有铺了视频才需要，纯底衬时这一层是多余的一次合成 */}
      {on && <div aria-hidden style={{ ...FIXED, background: VEIL }} />}
      {/* ① 虹彩镭射膜。白底上极淡的粉、青、黄虹光，不是彩色背景。
          有视频时底色必须让开 —— --color-ground 是不透明的，留着会把视频整块盖死 */}
      <div
        aria-hidden
        style={{
          ...FIXED,
          background: [
            'radial-gradient(90% 62% at 8% -6%, rgb(255 186 214 / .20), transparent 66%)',
            'radial-gradient(84% 58% at 96% 2%, rgb(94 226 255 / .16), transparent 68%)',
            'radial-gradient(96% 66% at 82% 104%, rgb(255 243 130 / .11), transparent 70%)',
            'radial-gradient(88% 60% at -4% 96%, rgb(162 162 192 / .20), transparent 66%)',
            'radial-gradient(64% 46% at 46% 44%, rgb(160 255 226 / .08), transparent 74%)',
            ...(on ? [] : ['var(--color-ground)']),
          ].join(','),
        }}
      />
      {/* ② 晶体碎片。几乎看不见，只给白色区域一点结晶折射的质地 */}
      <div
        aria-hidden
        style={{
          ...FIXED,
          backgroundImage: shards(0.02, false),
          backgroundSize: 'calc(900 * var(--u)) calc(900 * var(--u))',
        }}
      />
      {/* ③ 上缘淡出：内容区顶端融进底色 */}
      <div
        aria-hidden
        style={{
          position: 'fixed',
          insetInline: 0,
          top: 0,
          height: 'calc(220 * var(--u))',
          zIndex: -1,
          pointerEvents: 'none',
          background: 'linear-gradient(180deg, rgb(255 255 255 / .6) 0%, transparent 100%)',
        }}
      />
      {/* ④ 前景碎片：叠在内容之上做景深，只在最外缘露一点 */}
      <div
        aria-hidden
        style={{
          ...FIXED,
          zIndex: 2,
          backgroundImage: shards(0.032, true),
          backgroundSize: 'calc(1400 * var(--u)) calc(1400 * var(--u))',
          maskImage: 'radial-gradient(104% 88% at 50% 50%, transparent 84%, #000 100%)',
          WebkitMaskImage: 'radial-gradient(104% 88% at 50% 50%, transparent 84%, #000 100%)',
        }}
      />
    </>
  )
}
