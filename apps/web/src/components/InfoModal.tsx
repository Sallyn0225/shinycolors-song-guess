import { useEffect, useRef, useState, type ReactNode } from 'react'

import { sfx } from '../sfx'
import { Button } from '../ui/Button'
import { Overlay, OverlayMark } from '../ui/Overlay'

interface Props {
  onClose: () => void
}

/** 三页的抬头。正文每页结构差太多，各自一个小节组件在文件下方 */
const PAGES: { kana: string; latin: string; title: string }[] = [
  { kana: 'アソビカタ', latin: 'HOW TO PLAY', title: '玩法' },
  { kana: '免責事項', latin: 'DISCLAIMER', title: '免责声明' },
  { kana: 'カンシャ', latin: 'CREDITS', title: '致谢' },
]

/** 致谢清单。链接是自绘 <a>，click 音得手动补 —— 与 ui/Button 内部那条规矩对齐 */
const CREDITS: { name: string; url: string; purpose: string }[] = [
  {
    name: 'MSST-WebUI',
    url: 'https://github.com/SUC-DriverOld/MSST-WebUI',
    purpose: '用于部分伴奏的分离',
  },
  {
    name: 'Irodori-TTS',
    url: 'https://github.com/Aratako/Irodori-TTS',
    purpose: '用于角色语音的合成',
  },
  {
    name: '闪耀色彩表情包',
    url: 'https://aldiba.github.io/shinycolors-stickers/',
    purpose: '表情包的制作',
  },
  {
    name: 'ヨルシカ猜歌小游戏',
    url: 'https://www.bilibili.com/toy/yorushika_song_guess/index.html',
    purpose: '本项目的灵感来源',
  },
]

/* 页码指示的分段方块：斜切小平行四边形。颜色当「数据」用 ——
   与 RoomCard 那枚菱形同一条规矩，不按文字对比度要求挑色 */
const SEG_CLIP = 'polygon(calc(6 * var(--u)) 0, 100% 0, calc(100% - 6 * var(--u)) 100%, 0 100%)'

/** 小节标题。页标题是 text-lg 的 ink，这一级降一档、换 primary 作第二层 */
function Subhead({ children }: { children: ReactNode }) {
  return <p className="text-sm font-bold text-primary">{children}</p>
}

/** 正文段。jp-wrap 管日文术语的断行 */
function Para({ children }: { children: ReactNode }) {
  return <p className="jp-wrap text-sm leading-relaxed text-ink-sub">{children}</p>
}

/** 第一页：两种玩法 */
function PlayBody() {
  return (
    <div className="flex flex-col" style={{ gap: 'calc(18 * var(--u))' }}>
      <section className="flex flex-col" style={{ gap: 'calc(7 * var(--u))' }}>
        <Subhead>单机 · 听节奏猜歌</Subhead>
        <Para>
          播放一段抽掉人声的伴奏片段，在限定时间内从选项中认出它是哪首歌。
          考的是对编曲与节奏的记忆，不是歌词。
        </Para>
        <Para>
          两个难度（<span lang="ja">イージー</span> / <span lang="ja">ハード</span>
          ）在片段长度、时限与干扰项上不同：<span lang="ja">イージー</span>{' '}
          片段长、干扰项来自不同组合；<span lang="ja">ハード</span>{' '}
          片段更短、时限更紧，选项全是同组合或曲名相近的曲子。
        </Para>
      </section>
      <section className="flex flex-col" style={{ gap: 'calc(7 * var(--u))' }}>
        <Subhead>
          联机 · 1v1 <span lang="ja">空札領地戦</span>
        </Subhead>
        <Para>
          日式歌牌（<span lang="ja">かるた</span>）玩法的 1v1 抢牌对局：听歌抢下场上对应的手牌，
          还有<span lang="ja">送り札</span>、<span lang="ja">お手つき</span>
          ，以及只会被播放、场上没有对应牌的<span lang="ja">空札</span>。 先清空
          <span lang="ja">自陣</span>者胜。
        </Para>
        <Para>
          完整规则在联机页面 —— 关掉这个弹窗，从首页的「1v1{' '}
          <span lang="ja">空札領地戦</span>」进入查看。
        </Para>
      </section>
    </div>
  )
}

/** 第二页：免责声明。口径照抄仓库根 NOTICE 的「非官方声明」，不另造说法 */
function DisclaimerBody() {
  return (
    <div className="flex flex-col" style={{ gap: 'calc(10 * var(--u))' }}>
      <Para>
        本项目是非官方、非商业的粉丝作品，与株式会社万代南梦宫娱乐（BANDAI NAMCO
        Entertainment）、「<span lang="ja">アイドルマスター シャイニーカラーズ</span>
        」的开发运营方及 283Production 均无任何关联，亦未获其认可或授权。
      </Para>
      <Para>
        游戏内使用的角色语音、图像等素材，版权归 BANDAI NAMCO Entertainment Inc.
        所有，仅以非商业粉丝创作的目的使用。
      </Para>
      <Para>本项目已开源，源码见 GitHub 仓库。</Para>
    </div>
  )
}

/** 第三页：致谢 */
function CreditsBody() {
  return (
    <div>
      <Para>本站建立在以下项目之上：</Para>
      <ul className="mt-4 flex flex-col" style={{ gap: 'calc(14 * var(--u))' }}>
        {CREDITS.map((c) => (
          <li key={c.name}>
            {/*
              站内第一批文字链接 —— 下划线常驻，别处没有任何东西长得像链接，
              不画线的话没人知道这几行名字点得动。
              primary 对白底 5.5:1，hover 换 accent-ink（压深过的青，4.9:1）。
            */}
            <a
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => sfx.play('click')}
              className="jp-wrap text-sm font-semibold text-primary underline decoration-primary-lt underline-offset-4 transition-colors hover:text-accent-ink hover:decoration-accent-ink"
            >
              {c.name}
              <span className="sr-only">（在新标签页打开）</span>
            </a>
            <p className="jp-wrap mt-1 text-xs text-ink-faint">{c.purpose}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

const BODIES: ReactNode[] = [<PlayBody />, <DisclaimerBody />, <CreditsBody />]

/**
 * 展示信息弹窗：玩法 / 免责声明 / 致谢，三页可翻。
 *
 * 「开 / 关」归 Start 屏管 —— 弹窗卸载时页码一起扔掉，每次打开都从第一页开始。
 * 弹层本体复用 ui/Overlay：模态语义、进场聚焦、Tab 圈闭、明底遮罩都在那一层。
 */
export function InfoModal({ onClose }: Props) {
  const [page, setPage] = useState(0)
  const cardRef = useRef<HTMLDivElement>(null)

  // Esc 关闭 —— 与 ShareDialog 同一条键盘通道
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /*
    翻到边界页时，正被聚焦的那颗翻页按钮会随 disabled 一起失焦 ——
    浏览器把焦点返回 body，而 Overlay 的 Tab 圈闭只在自己持有焦点时成立，
    此后 Tab 会穿到弹窗后面的首页按钮上去。翻页渲染完检查一遍，
    焦点掉了就收回弹窗内第一个可用控件（恰好是边界页上还活着的那颗翻页钮）。
  */
  useEffect(() => {
    const card = cardRef.current
    if (!card || card.contains(document.activeElement)) return
    card.querySelector<HTMLElement>('button:not([disabled]), [href]')?.focus()
  }, [page])

  // 页头。noUncheckedIndexedAccess 给数组取值挂 undefined —— page 被按钮
  // disabled 挡在界内，真越界也只是这几行字渲染为空，不会崩
  const current = PAGES[page]

  return (
    <Overlay label="游戏信息">
      {/*
        卡片自己封顶可滚：Overlay 是 justify-center 的，内容高出视口会平分到
        上下两端，而滚动条只能往下走 —— 顶部会滚不回来（ShareDialog 记过这个坑）。
      */}
      <span
        className="cut-shadow-lg anim-appear w-full"
        style={{ maxWidth: 'var(--page-card)', maxHeight: '92dvh', overflowY: 'auto' }}
      >
        <div ref={cardRef} className="glass-lit cut-card px-7 pt-11 pb-7 text-left">
          <OverlayMark />

          {/* 日文那一半单独标 lang，拉丁那一半不标（见 ui/SectionTitle 的说明） */}
          <p
            className="mt-4 text-2xs font-semibold text-primary"
            style={{ letterSpacing: 'var(--tracking-title)' }}
          >
            <span lang="ja">{current?.kana}</span> / {current?.latin}
          </p>
          <p className="mt-1.5 text-lg font-bold text-ink">{current?.title}</p>

          {/* key 换页即重挂 —— 每页都走一遍 .anim-appear 的模糊转清晰 */}
          <div key={page} className="anim-appear mt-5">
            {BODIES[page]}
          </div>

          {/* 翻页行。首末页对应方向置灰即可，不必藏 —— 置灰本身说出了「到头了」 */}
          <div className="mt-7 flex items-center justify-between gap-3">
            <Button
              variant="glass"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              上一页
            </Button>
            {/*
              页码指示：眼睛看分段方块，读屏听下面那行 sr-only 状态 ——
              换页属于「看文字变化才知道」的事，按无障碍基线得挂 live region。
            */}
            <span aria-hidden className="flex items-center" style={{ gap: 'calc(6 * var(--u))' }}>
              {PAGES.map((_, i) => (
                <span
                  key={i}
                  className="block"
                  style={{
                    width: 'calc(20 * var(--u))',
                    height: 'calc(6 * var(--u))',
                    background: i === page ? 'var(--color-primary)' : 'var(--color-primary-lt)',
                    clipPath: SEG_CLIP,
                  }}
                />
              ))}
            </span>
            <Button
              variant="glass"
              size="sm"
              disabled={page === PAGES.length - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </Button>
          </div>
          <p className="sr-only" role="status" aria-live="polite">
            第 {page + 1} / {PAGES.length} 页：{current?.title}
          </p>

          <div className="mt-3">
            <Button variant="ghost" size="md" full onClick={onClose}>
              关闭
            </Button>
          </div>
        </div>
      </span>
    </Overlay>
  )
}
