import { sfx } from '../sfx'

/** 作者的个人链接聚合页 */
const AUTHOR_URL = 'https://linktr.ee/sallyn0225'

/**
 * 首页页脚：非官方声明 + 署名。
 *
 * 不画分隔线也不加框 —— 这套系统里「界线」由光带承担（见 Start 的注释），
 * 页脚与上方内容之间只靠间距分开。
 *
 * 声明这一句是 NOTICE 里那段「非官方声明」的短版，措辞照抄，不另造说法；
 * 完整版在信息弹窗第二页（components/InfoModal.tsx），这里只留一行。
 * 两处都改的时候记得对齐，别让短版比长版说得多。
 */
export function Footer() {
  return (
    <footer className="anim-appear mt-10 sm:mt-6" style={{ animationDelay: '400ms' }}>
      {/*
        桌面一行两端对齐，窄屏折成两行 —— 折了也只多一行小字的高度。
        用 justify-between 而不是居中：这两句不是同一件事的两半，
        左边是法律口径、右边是署名，靠视口两端分开比靠间距分开更读得出来。
      */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1 text-xs text-ink-faint">
        <p className="jp-wrap">
          非官方粉丝作品 · 与 BANDAI NAMCO Entertainment 及 283Production 无关联
        </p>
        <p className="latin">
          unofficial fanart{' '}
          {/*
            站内文字链接的既有写法：下划线常驻 + primary，hover 换 accent-ink。
            与 InfoModal 的致谢链接同款，自绘 <a> 的 click 音也照样手动补一声。
          */}
          <a
            href={AUTHOR_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => sfx.play('click')}
            className="font-semibold text-primary underline decoration-primary-lt underline-offset-4 transition-colors hover:text-accent-ink hover:decoration-accent-ink"
          >
            @SallynP
          </a>
        </p>
      </div>
    </footer>
  )
}
