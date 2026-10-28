/**
 * 将前端 i18n locale 映射为后端 Accept-Language 语言标签。
 * 与 /api/pricing 约定一致：zh-CN / en / ja…；未知语言由后端回落到 default。
 */
export function mapLocaleToAcceptLanguage(raw: string | undefined | null): string {
  const c = (raw ?? '').trim().toLowerCase().replace(/_/g, '-')
  if (!c)
    return 'zh-CN'
  if (c === 'zh' || c === 'zh-cn' || c === 'zh-hans' || c === 'zh-sg')
    return 'zh-CN'
  if (c === 'zh-tw' || c === 'zh-hk' || c === 'zh-mo' || c === 'zh-hant')
    return 'zh-TW'
  // i18n map 键为 "en"，不要发 en-US
  if (c === 'en' || c.startsWith('en-'))
    return 'en'
  if (c === 'ja' || c.startsWith('ja-'))
    return 'ja'
  if (c === 'fr' || c.startsWith('fr-'))
    return 'fr'
  if (c === 'ru' || c.startsWith('ru-'))
    return 'ru'
  if (c === 'vi' || c.startsWith('vi-'))
    return 'vi'
  return (raw ?? '').trim() || 'zh-CN'
}

/** 从当前 Nuxt i18n 上下文解析 Accept-Language */
export function resolveAcceptLanguageHeader(): string {
  try {
    const nuxtApp = tryUseNuxtApp()
    if (nuxtApp) {
      const i18n = nuxtApp.$i18n as { locale?: string | { value?: string } } | undefined
      const locale = i18n?.locale
      const code = typeof locale === 'string'
        ? locale
        : String(locale?.value ?? '')
      if (code)
        return mapLocaleToAcceptLanguage(code)
    }
  }
  catch {
    // outside Nuxt context
  }

  try {
    const cookie = useCookie<string | null>('i18n_redirected')
    if (cookie.value)
      return mapLocaleToAcceptLanguage(String(cookie.value))
  }
  catch {
    // cookie unavailable
  }

  try {
    const config = useRuntimeConfig()
    const fallback = String(config.public.defaultLocale ?? '')
    if (fallback)
      return mapLocaleToAcceptLanguage(fallback)
  }
  catch {
    // outside Nuxt context
  }

  return 'zh-CN'
}
