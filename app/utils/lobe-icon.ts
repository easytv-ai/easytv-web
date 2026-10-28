/** 与 @lobehub/icons-static-svg 包版本保持一致（管理端 lobeIcon.ts 同一套） */
const LOBE_ICON_STATIC_VERSION = '1.91.0'

const LOBE_ICON_CDN_BASES = [
  `https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@${LOBE_ICON_STATIC_VERSION}/icons`,
  `https://unpkg.com/@lobehub/icons-static-svg@${LOBE_ICON_STATIC_VERSION}/icons`,
]

/** static-svg 包中没有对应 `-color.svg` 的厂商，写成 OpenAI.Color 也只拉 openai.svg */
const LOBE_SLUGS_WITHOUT_COLOR_VARIANT = new Set([
  'openai',
  'anthropic',
])

/** PascalCase 组件名片段 → 文件名片段，如 ByteDance → bytedance，Color → color */
export function iconNameToSlugPart(part: string): string {
  return part.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
}

/** 数据库里存的完整图标 URL，不走 lobehub CDN */
export function isExternalIconUrl(icon: string | null | undefined): boolean {
  const trimmed = icon?.trim()
  if (!trimmed)
    return false
  return /^https?:\/\//i.test(trimmed)
    || trimmed.startsWith('data:')
    || trimmed.startsWith('/')
}

/**
 * 对齐管理端 getLobeIconSlugCandidates：
 * ByteDance.Color → bytedance-color.svg，再回退 bytedance.svg
 * OpenAI.Color → openai.svg（没有 openai-color）
 */
export function getLobeIconSlugCandidates(iconName: string | null | undefined): string[] {
  const trimmed = iconName?.trim()
  if (!trimmed || isExternalIconUrl(trimmed))
    return []

  const segments = trimmed.split('.')
  const baseSlug = iconNameToSlugPart(segments[0] ?? '')
  if (!baseSlug)
    return []

  const slugs: string[] = []
  const subComponent = segments[1]
  const wantsColor = subComponent === 'Color'
    || (Boolean(subComponent) && /^[A-Z]/.test(subComponent!) && !subComponent!.includes('=')
      && iconNameToSlugPart(subComponent!) === 'color')

  if (wantsColor && LOBE_SLUGS_WITHOUT_COLOR_VARIANT.has(baseSlug)) {
    slugs.push(baseSlug)
    return slugs
  }

  if (subComponent && /^[A-Z]/.test(subComponent) && !subComponent.includes('='))
    slugs.push(`${baseSlug}-${iconNameToSlugPart(subComponent)}`)

  slugs.push(baseSlug)
  return [...new Set(slugs)]
}

export function getLobeIconSlugCandidatesForFetch(iconName: string | null | undefined): string[] {
  const trimmed = iconName?.trim()
  if (!trimmed)
    return []

  const candidates = getLobeIconSlugCandidates(trimmed)
  const segments = trimmed.split('.')
  const baseSlug = iconNameToSlugPart(segments[0] ?? '')
  const colorSlug = `${baseSlug}-color`
  const hasExplicitVariant = segments.length > 1
    && /^[A-Z]/.test(segments[1] ?? '')
    && !segments[1]?.includes('=')

  if (
    !hasExplicitVariant
    && baseSlug
    && !LOBE_SLUGS_WITHOUT_COLOR_VARIANT.has(baseSlug)
    && !candidates.includes(colorSlug)
  )
    return [...candidates, colorSlug]

  return candidates
}

function prepareInlineSvgMarkup(svg: string): string {
  return svg.replace(/<svg\b([^>]*)>/i, (_match, attrs: string) => {
    const cleaned = attrs
      .replace(/\s(width|height)=("[^"]*"|'[^']*')/gi, '')
      .replace(/\sstyle=("[^"]*"|'[^']*')/gi, '')
    return `<svg${cleaned} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">`
  })
}

const iconNameCache = new Map<string, string>()
const slugSvgCache = new Map<string, string>()
const slugMissCache = new Set<string>()
const slugSvgInflight = new Map<string, Promise<string | null>>()
const iconNameInflight = new Map<string, Promise<string | null>>()

async function fetchCdnSvg(slug: string): Promise<string | null> {
  if (slugMissCache.has(slug))
    return null
  const cached = slugSvgCache.get(slug)
  if (cached)
    return cached
  const pending = slugSvgInflight.get(slug)
  if (pending)
    return pending

  const request = (async (): Promise<string | null> => {
    for (const base of LOBE_ICON_CDN_BASES) {
      try {
        const raw = await $fetch<string>(`${base}/${slug}.svg`, { responseType: 'text' })
        if (raw?.includes('<svg')) {
          slugSvgCache.set(slug, raw)
          return raw
        }
      }
      catch {
        // 换下一个 CDN
      }
    }
    slugMissCache.add(slug)
    return null
  })()

  slugSvgInflight.set(slug, request)
  try {
    return await request
  }
  finally {
    slugSvgInflight.delete(slug)
  }
}

/** 按图标名拉内联 SVG。ByteDance.Color 这类名字只打 CDN，不打模型详情。同名并发共用一次请求。 */
export async function fetchLobeInlineSvg(iconName: string | null | undefined): Promise<string | null> {
  const trimmed = iconName?.trim()
  if (!trimmed || isExternalIconUrl(trimmed))
    return null

  const cached = iconNameCache.get(trimmed)
  if (cached)
    return cached
  const pending = iconNameInflight.get(trimmed)
  if (pending)
    return pending

  const request = (async (): Promise<string | null> => {
    for (const slug of getLobeIconSlugCandidatesForFetch(trimmed)) {
      const raw = await fetchCdnSvg(slug)
      if (!raw)
        continue
      const markup = prepareInlineSvgMarkup(raw)
      iconNameCache.set(trimmed, markup)
      return markup
    }
    return null
  })()

  iconNameInflight.set(trimmed, request)
  try {
    return await request
  }
  finally {
    iconNameInflight.delete(trimmed)
  }
}
