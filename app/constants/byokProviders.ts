/**
 * 自带密钥：支持的服务商（type 对应渠道类型 value，label 与渠道类型名称一致）。
 * 后端还没有用户侧 BYOK 接口，设置页不开放入口。接口就绪后再挂 Tab，不要先做死页面。
 */
export const BYOK_PROVIDERS = [
  // 国内
  { slug: 'deepseek', type: 43, region: 'domestic', icon: 'DeepSeek.Color', iconSlug: 'deepseek' },
  { slug: 'tongyi', type: 17, region: 'domestic', icon: 'Qwen.Color', iconSlug: 'qwen' },
  { slug: 'baidu', type: 15, region: 'domestic', icon: 'Baidu.Color', iconSlug: 'baidu' },
  { slug: 'doubao', type: 45, region: 'domestic', icon: 'Doubao.Color' },
  { slug: 'zhipu', type: 26, region: 'domestic', icon: 'Zhipu.Color' },
  { slug: 'moonshot', type: 25, region: 'domestic', icon: 'Moonshot.Color' },
  { slug: 'minimax', type: 35, region: 'domestic', icon: 'Minimax.Color', iconSlug: 'minimax' },
  { slug: 'hunyuan', type: 23, region: 'domestic', icon: 'Hunyuan.Color' },
  { slug: 'spark', type: 18, region: 'domestic', icon: 'Spark.Color' },
  { slug: 'yi', type: 31, region: 'domestic', icon: 'Yi.Color' },
  // 海外
  { slug: 'openai', type: 1, region: 'overseas', icon: 'OpenAI.Color', iconSlug: 'openai' },
  { slug: 'anthropic', type: 14, region: 'overseas', icon: 'Claude.Color', iconSlug: 'anthropic' },
  { slug: 'gemini', type: 24, region: 'overseas', icon: 'Gemini.Color', iconSlug: 'google' },
  { slug: 'azure', type: 3, region: 'overseas', icon: 'Azure.Color' },
  { slug: 'mistral', type: 42, region: 'overseas', icon: 'Mistral.Color' },
  { slug: 'xai', type: 48, region: 'overseas', icon: 'XAI.Color' },
  // 中转站：OpenAI 兼容中转站（api2gpt / openrouter / 自建中转等），base_url 与模型列表由用户自填
  { slug: 'relay-openai', type: 1, region: 'relay', icon: 'OpenAI.Color', iconSlug: 'openai' },
  { slug: 'relay-custom', type: 8, region: 'relay', icon: 'Custom', iconSlug: 'custom' },
] as const

export type ByokProviderSlug = (typeof BYOK_PROVIDERS)[number]['slug']

export type ByokProviderRegion = 'domestic' | 'overseas' | 'relay'

export type ByokProviderEntry = (typeof BYOK_PROVIDERS)[number]

/** 旧 slug 兼容（历史数据 / 接口返回值） */
export const BYOK_LEGACY_SLUG_MAP: Partial<Record<string, ByokProviderSlug>> = {
  qwen: 'tongyi',
  alibaba: 'tongyi',
}

export const BYOK_DOMESTIC_SLUGS = BYOK_PROVIDERS
  .filter(p => p.region === 'domestic')
  .map(p => p.slug)

export const BYOK_OVERSEAS_SLUGS = BYOK_PROVIDERS
  .filter(p => p.region === 'overseas')
  .map(p => p.slug)

export const BYOK_RELAY_SLUGS = BYOK_PROVIDERS
  .filter(p => p.region === 'relay')
  .map(p => p.slug)

export const BYOK_PROVIDER_SLUGS = BYOK_PROVIDERS.map(p => p.slug)

export const BYOK_DEFAULT_PROVIDER_SLUG: ByokProviderSlug = 'deepseek'

/** slug → 渠道 type（由 BYOK_PROVIDERS 自动生成） */
export const BYOK_PROVIDER_TYPE = Object.fromEntries(
  BYOK_PROVIDERS.map(p => [p.slug, p.type]),
) as Record<ByokProviderSlug, number>

/** type → slug（仅 type 唯一对应一个 slug 时才有值） */
const BYOK_TYPE_TO_SLUG = (() => {
  const slugsByType = new Map<number, ByokProviderSlug[]>()
  for (const p of BYOK_PROVIDERS) {
    const list = slugsByType.get(p.type) ?? []
    list.push(p.slug)
    slugsByType.set(p.type, list)
  }
  const map: Partial<Record<number, ByokProviderSlug>> = {}
  for (const [type, slugs] of slugsByType) {
    if (slugs.length === 1)
      map[type] = slugs[0]
  }
  return map
})()

export function byokProviderEntry(slug: ByokProviderSlug): ByokProviderEntry | undefined {
  return BYOK_PROVIDERS.find(p => p.slug === slug)
}

export function byokProviderType(slug: ByokProviderSlug): number {
  return BYOK_PROVIDER_TYPE[slug]
}

export function byokProviderIcon(slug: ByokProviderSlug): string | undefined {
  return byokProviderEntry(slug)?.icon
}

export function byokProviderIconSlug(slug: ByokProviderSlug): string {
  const entry = byokProviderEntry(slug)
  if (entry && 'iconSlug' in entry && entry.iconSlug)
    return entry.iconSlug
  return entry?.slug ?? slug
}

export function normalizeByokProviderSlug(raw: string): ByokProviderSlug | undefined {
  const trimmed = raw.trim()
  if (!trimmed)
    return undefined
  if ((BYOK_PROVIDER_SLUGS as readonly string[]).includes(trimmed))
    return trimmed as ByokProviderSlug
  return BYOK_LEGACY_SLUG_MAP[trimmed]
}

export function byokProviderSlugFromType(type: number): ByokProviderSlug | undefined {
  return BYOK_TYPE_TO_SLUG[type]
}

/** OpenAI 官方默认 Base URL（同后端 constant.ChannelBaseURLs[1]），用于区分官方直连与中转站 */
export const OPENAI_OFFICIAL_BASE_URL = 'https://api.openai.com'

/**
 * 按渠道 type + base_url 解析 slug。
 * type=1 被 openai 与 relay-openai 共用（唯一映射失效）：base_url 为空或官方地址 → openai，
 * 指向第三方地址 → relay-openai；其余 type 走唯一映射（type=8 → relay-custom）。
 */
export function byokProviderSlugFromChannel(type: number, baseUrl?: string): ByokProviderSlug | undefined {
  if (type === 1) {
    const url = (baseUrl ?? '').trim().replace(/\/+$/, '')
    return (!url || url === OPENAI_OFFICIAL_BASE_URL) ? 'openai' : 'relay-openai'
  }
  return BYOK_TYPE_TO_SLUG[type]
}

export function byokProviderRegion(slug: ByokProviderSlug): ByokProviderRegion {
  return byokProviderEntry(slug)?.region ?? 'domestic'
}

/** 是否为中转站服务商（base_url + 模型列表由用户自填） */
export function byokProviderIsRelay(slug: ByokProviderSlug): boolean {
  return byokProviderRegion(slug) === 'relay'
}
