/**
 * 页面底衬。官网靠两张位图贴出来（bg_back 虹彩镭射膜 + bg_geo 晶体碎片），
 * 这两个文件我们没有，所以纯 CSS/SVG 程序化重建 —— 零字节下载，且能跟着视口走。
 *
 * 四层，自下而上：
 *   ① 虹彩镭射膜   超大低透明径向渐变叠出粉/薄荷/青/奶油黄的膜感
 *   ② 晶体碎片     多边形图案，rgb(97 95 144 / .02)，几乎看不见但让白色区域有折射质地
 *   ③ 上缘淡出     内容区上缘融入背景（官网的 fade 遮罩）
 *   ④ 前景碎片     只在视口最外缘露一点，叠在内容之上做景深
 *
 * 「几乎看不见」是硬指标不是形容词：一旦纹样能被当成图案读出来，
 * 白玻璃面板的层次就塌了，内容也开始跟底衬抢注意力。
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

export function Backdrop() {
  return (
    <>
      {/* ① 虹彩镭射膜。白底上极淡的粉、青、黄虹光，不是彩色背景 */}
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
            'var(--color-ground)',
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
