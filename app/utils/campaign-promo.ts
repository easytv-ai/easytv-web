import type { Campaign, CampaignPromoItem } from '~/types/creative'

type RawPromo = {
  model?: unknown
  models?: unknown
  rate?: unknown
  points?: unknown
  label?: unknown
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function normalizeItem(raw: RawPromo): CampaignPromoItem[] {
  const rate = num(raw.rate)
  const points = Math.trunc(num(raw.points))
  const hasRate = rate > 0 && rate < 1
  const hasPoints = points >= 1
  if (!hasRate && !hasPoints)
    return []
  const names = [
    ...(Array.isArray(raw.models) ? raw.models : []),
    raw.model,
  ].map(name => String(name ?? '').trim().toLowerCase()).filter(Boolean)
  const label = String(raw.label ?? '').trim()
  return names.map(model => ({
    model,
    rate: hasRate ? rate : undefined,
    points: hasPoints ? points : undefined,
    label,
  }))
}

/** 兼容旧接口只回 model_promo 字符串、还没有 model_promo_items 的情况 */
export function parseCampaignModelPromo(raw: string | null | undefined): CampaignPromoItem[] {
  const text = String(raw ?? '').trim()
  if (!text || text === 'null' || text === '""')
    return []
  try {
    const data = JSON.parse(text) as RawPromo | RawPromo[]
    const nodes = Array.isArray(data) ? data : [data]
    const seen = new Map<string, CampaignPromoItem>()
    for (const node of nodes) {
      if (!node || typeof node !== 'object')
        continue
      for (const item of normalizeItem(node))
        seen.set(item.model, item)
    }
    return [...seen.values()]
  }
  catch {
    return []
  }
}

export function campaignPromoItems(item: Campaign | null | undefined): CampaignPromoItem[] {
  if (!item)
    return []
  if (Array.isArray(item.model_promo_items) && item.model_promo_items.length)
    return item.model_promo_items
  return parseCampaignModelPromo(item.model_promo)
}

export function campaignPromoLabel(item: CampaignPromoItem, fallback: string): string {
  return String(item.label || '').trim() || fallback
}
