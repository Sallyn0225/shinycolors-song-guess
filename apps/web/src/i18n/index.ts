import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import zh from './locales/zh.json'
import ja from './locales/ja.json'
import en from './locales/en.json'

export const defaultNS = 'translation'
export const resources = {
  zh: { translation: zh },
  ja: { translation: ja },
  en: { translation: en },
} as const

export type SupportedLocale = 'zh' | 'ja' | 'en'

const STORAGE_KEY = 'scg.lang'

export function getSavedLocale(): SupportedLocale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'zh' || saved === 'ja' || saved === 'en') return saved
  } catch {
    /* Safari 无痕模式 QuotaExceededError 兜底 */
  }

  const nav = typeof navigator !== 'undefined' ? navigator.language.toLowerCase() : ''
  if (nav.startsWith('ja')) return 'ja'
  if (nav.startsWith('en')) return 'en'
  return 'zh'
}

export function setHtmlLang(lang: string) {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang
  }
}

const initialLang = getSavedLocale()
setHtmlLang(initialLang)

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: initialLang,
    fallbackLng: 'zh',
    interpolation: {
      escapeValue: false,
    },
  })

i18n.on('languageChanged', (lng) => {
  setHtmlLang(lng)
  try {
    localStorage.setItem(STORAGE_KEY, lng)
  } catch {
    /* 无痕模式写入失败静默跳过 */
  }
})

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNS
    resources: (typeof resources)['zh']
  }
}

export default i18n
