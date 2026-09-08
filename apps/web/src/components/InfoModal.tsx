import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { sfx } from '../sfx'
import { Button } from '../ui/Button'
import { Overlay, OverlayMark } from '../ui/Overlay'

interface Props {
  onClose: () => void
}

/** 三页的固定三语抬头。正文每页结构差太多，各自一个小节组件在文件下方 */
const PAGES: { kana: string; latin: string; title: string }[] = [
  { kana: 'アソビカタ', latin: 'HOW TO PLAY', title: '玩法' },
  { kana: '免責事項', latin: 'DISCLAIMER', title: '免责声明' },
  { kana: 'カンシャ', latin: 'CREDITS', title: '致谢' },
]

/** 致谢清单。链接是自绘 <a>，click 音得手动补 —— 与 ui/Button 内部那条规矩对齐 */
const CREDITS: { name: string; url: string }[] = [
  {
    name: 'MSST-WebUI',
    url: 'https://github.com/SUC-DriverOld/MSST-WebUI',
  },
  {
    name: 'Irodori-TTS',
    url: 'https://github.com/Aratako/Irodori-TTS',
  },
  {
    name: '闪耀色彩表情包',
    url: 'https://aldiba.github.io/shinycolors-stickers/',
  },
  {
    name: 'ヨルシカ猜歌小游戏',
    url: 'https://www.bilibili.com/toy/yorushika_song_guess/index.html',
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

/**
 * 术语条：加粗术语 + 破折号 + 解释，同一段里行内排。
 *
 * 不做成 dt/dd 两行：这四条要连着读，拆行会把「一段规则」读成「四个小节」，
 * 而它们本来就是一句话能说完的东西。行内的 dt/dd 靠字重分层，与站内别处一致。
 */
function Term({ name, jp, children }: { name: string; jp?: boolean; children: ReactNode }) {
  return (
    <p className="jp-wrap text-sm leading-relaxed text-ink-sub">
      <b className="font-bold text-ink" {...(jp ? { lang: 'ja' } : {})}>
        {name}
      </b>
      {' —— '}
      {children}
    </p>
  )
}

/** 第一页：两种玩法 */
function PlayBody() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col" style={{ gap: 'calc(18 * var(--u))' }}>
      <section className="flex flex-col" style={{ gap: 'calc(7 * var(--u))' }}>
        <Subhead>{t('info.playHeading')}</Subhead>
        <Para>{t('info.playP1')}</Para>
        <Para>{t('info.playP2')}</Para>
      </section>
      <section className="flex flex-col" style={{ gap: 'calc(7 * var(--u))' }}>
        <Subhead>{t('info.versusHeading')}</Subhead>
        <Para>{t('info.versusP1')}</Para>
        <Term name={t('info.karafudaName')} jp>{t('info.karafudaDescription')}</Term>
        <Term name={t('info.kimarijiName')} jp>{t('info.kimarijiDescription')}</Term>
        <Term name={t('info.okuriName')} jp>{t('info.okuriDescription')}</Term>
        <Term name={t('info.otetsukiName')} jp>{t('info.otetsukiDescription')}</Term>
        <Para>{t('info.rulesHint')}</Para>
      </section>
    </div>
  )
}

/** 第二页：免责声明。口径照抄仓库根 NOTICE 的「非官方声明」，不另造说法 */
function DisclaimerBody() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col" style={{ gap: 'calc(10 * var(--u))' }}>
      <Para>{t('info.disclaimerP1Modal')}</Para>
      <Para>{t('info.disclaimerP2Modal')}</Para>
      <Para>{t('info.openSource')}</Para>
    </div>
  )
}

/** 第三页：致谢 */
function CreditsBody() {
  const { t } = useTranslation()
  const purposeKeys = ['info.creditMsst', 'info.creditIrodori', 'info.creditStickers', 'info.creditYorushika'] as const
  const credits = CREDITS.map((credit, index) => ({
    ...credit,
    purpose: t(purposeKeys[index] ?? purposeKeys[0]),
  }))
  return (
    <div>
      <Para>{t('info.creditsIntro')}</Para>
      <ul className="mt-4 flex flex-col" style={{ gap: 'calc(14 * var(--u))' }}>
        {credits.map((c) => (
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
              <span className="sr-only">{t('common.externalLink')}</span>
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
  const { t } = useTranslation()
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
    <Overlay label={t('info.modalTitle')}>
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
              {t('common.pagePrevious')}
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
              {t('common.pageNext')}
            </Button>
          </div>
          <p className="sr-only" role="status" aria-live="polite">
            {t('common.pageStatus', { current: page + 1, total: PAGES.length, title: current?.title })}
          </p>

          <div className="mt-3">
            <Button variant="ghost" size="md" full onClick={onClose}>
              {t('info.close')}
            </Button>
          </div>
        </div>
      </span>
    </Overlay>
  )
}
