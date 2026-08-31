import { useState } from 'react'

import { emoteAssetUrl, emotePlaceholderSvg, type Tier } from '../features/grade'

interface Props {
  tier: Tier
  /** 结算浮层里空间紧，用小一号 */
  size?: 'md' | 'sm'
  className?: string
}

/**
 * 段位展示：表情 + 称号 + 评价。
 *
 * 文案来自 `features/grade.ts`，与导出战报读的是同一份 —— 页面上写「合格闪友」、
 * 图上写别的，是这种功能最容易出而且没人会发现的 bug。
 */
export function GradeBadge({ tier, size = 'md', className = '' }: Props) {
  // 正式素材在 public/emote/；万一没发上去就落到内置的简笔 SVG，不留破图
  const [src, setSrc] = useState(() => emoteAssetUrl(tier.emote))

  // 表情是带字的贴纸，不是简笔脸：太小就只剩一团色块。战报那边同理放到了 76
  const box = size === 'md' ? 'calc(72 * var(--u))' : 'calc(54 * var(--u))'

  return (
    <div className={`flex items-center gap-4 ${className}`}>
      {/*
        contain 而不是默认的 fill：表情是横幅贴纸（296×256），塞进正方框会被压扁，
        脸横向变宽。战报那边画的时候也是 contain，两处得是同一个形状。
      */}
      <img
        src={src}
        alt=""
        aria-hidden
        className="shrink-0"
        style={{
          width: box,
          height: box,
          minWidth: size === 'md' ? '56px' : '42px',
          objectFit: 'contain',
        }}
        onError={() => setSrc(emotePlaceholderSvg(tier.emote, '#615f90'))}
      />
      <div className="min-w-0">
        <p className={`jp-wrap font-bold text-ink ${size === 'md' ? 'sc-title' : 'text-base'}`}>
          {tier.title}
        </p>
        {/*
          评价用 rose-ink 而不是 sub-rose：#e2669b 在白底上只有 3.2:1，
          过不了正文对比度。见 quality-guidelines「亮的品牌色是面色不是字色」。
        */}
        <p className="jp-wrap text-xs" style={{ color: 'var(--color-rose-ink)' }}>
          {tier.blurb}
        </p>
      </div>
    </div>
  )
}
