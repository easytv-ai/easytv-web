/**
 * 将 vue-i18n / 浏览器返回的语言标识对齐到 `nuxt.config` 里 `i18n.locales[].code`
 *（例如 `zh-CN`、`zh_Hans` → `zh`，`zh-TW` → `zh-tw`）。
 */
export function canonicalI18nLocaleCode(
  raw: string | undefined | null,
  locales: ReadonlyArray<{ code: string; language?: string }>,
  /** 匹配不到时的兜底 code；随部署包的默认语言传入（如国内包 zh、海外包 en） */
  defaultCode = 'zh',
): string {
  const list = locales.filter((l): l is { code: string; language?: string } => typeof l.code === 'string')
  if (!list.length)
    return defaultCode

  const r = (raw ?? '').trim()
  if (!r) {
    return list.find(l => l.code === defaultCode)?.code ?? list[0]!.code
  }

  for (const l of list) {
    if (l.code === r)
      return l.code
    if (l.language && l.language === r)
      return l.code
  }

  const norm = (s: string) => s.toLowerCase().replace(/_/g, '-')
  const rl = norm(r)
  for (const l of list) {
    if (norm(l.code) === rl)
      return l.code
    if (l.language && norm(l.language) === rl)
      return l.code
  }

  if (rl === 'zh-cn' || rl === 'zh-hans' || rl === 'zh-sg' || rl === 'zho-cn')
    return list.find(l => l.code === 'zh')?.code ?? list[0]!.code
  if (rl === 'zh-tw' || rl === 'zh-hk' || rl === 'zh-mo' || rl === 'zh-hant' || rl === 'zho-tw')
    return list.find(l => l.code.toLowerCase() === 'zh-tw')?.code ?? list[0]!.code

  return list.find(l => l.code === defaultCode)?.code ?? list[0]!.code
}
