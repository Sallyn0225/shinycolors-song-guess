import { useTranslation } from 'react-i18next'

import { sfx } from '../sfx'
import { Cut } from '../ui/Cut'

const SIZE = 'max(44px, calc(46 * var(--u)))'

const NEXT_LANG: Record<string, 'zh' | 'ja' | 'en'> = {
  zh: 'ja',
  ja: 'en',
  en: 'zh',
}

const LABELS: Record<string, { short: string; label: string }> = {
  zh: { short: '中', label: '语言切换（当前：简体中文）' },
  ja: { short: '日', label: '言語切替（現在：日本語）' },
  en: { short: 'EN', label: 'Switch Language (Current: English)' },
}

export function LanguageSwitch() {
  const { i18n } = useTranslation()
  const rawLang = i18n.resolvedLanguage || i18n.language || 'zh'
  const current = rawLang.startsWith('ja') ? 'ja' : rawLang.startsWith('en') ? 'en' : 'zh'

  const toggle = () => {
    sfx.play('click')
    const next = NEXT_LANG[current] ?? 'zh'
    void i18n.changeLanguage(next)
  }

  const item = LABELS[current] ?? LABELS.zh!

  return (
    <Cut
      shape="slant"
      elevation="sm"
      className="relative flex items-center justify-center glass-lit"
      style={{ width: SIZE, height: SIZE }}
    >
      <span
        aria-hidden
        className="cut-ring cut-ring-slant"
        style={{
          ['--ring' as string]: '1.5px',
          ['--ring-color' as string]: 'var(--color-primary)',
        }}
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={item.label}
        className="relative flex h-full w-full items-center justify-center font-bold tracking-tight text-primary transition-[color,transform] duration-300 ease-[var(--ease-prism)] hover:-translate-y-px active:translate-y-0"
        style={{ fontSize: 'max(13px, calc(14 * var(--u)))', fontFamily: 'Jost, sans-serif' }}
      >
        {item.short}
      </button>
    </Cut>
  )
}
