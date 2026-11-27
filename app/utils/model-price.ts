import type { ModelPromoFields } from '~/types/creative'

type PricedModel = ModelPromoFields & {
  points_per_unit: number
  member_points_per_unit: number
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** 促销是否生效：以服务端算好的 effective_* 为准（含活动价，避免只认模型自己的 promo_points） */
export function modelPromoActive(model: PricedModel | null | undefined): boolean {
  if (!model)
    return false
  const origin = num(model.points_per_unit)
  const eff = num(model.effective_points_per_unit)
  if (eff && origin && eff < origin)
    return true
  return Boolean(model.promo_active && num(model.promo_points_per_unit) && num(model.promo_points_per_unit) < origin)
}

/** 划线价（原价）：会员看会员价，否则标准价；会员价为 0 时回落到标准价 */
export function listedUnitPrice(model: PricedModel, isMember: boolean): number {
  const member = num(model.member_points_per_unit)
  return isMember && member ? member : num(model.points_per_unit)
}

/**
 * 实际扣费单价：优先服务端的 effective_*（促销期内取 min(标准价/会员价, 促销价)），
 * 老接口没有这些字段时按原逻辑取会员价 / 标准价。
 */
export function effectiveUnitPrice(model: PricedModel, isMember: boolean): number {
  const eff = isMember ? num(model.effective_member_points_per_unit) : num(model.effective_points_per_unit)
  if (eff)
    return eff
  return listedUnitPrice(model, isMember)
}

/** 促销展示：促销价、划线原价、标签；未促销或促销价不低于原价时返回 null */
export function modelPromoDisplay(model: PricedModel, isMember: boolean): { price: number, origin: number, label: string } | null {
  if (!modelPromoActive(model))
    return null
  const price = effectiveUnitPrice(model, isMember)
  const origin = listedUnitPrice(model, isMember)
  if (!price || !origin || price >= origin)
    return null
  const label = String(model.campaign_promo_label || model.promo_label || '').trim()
  return { price, origin, label }
}

/**
 * 与服务端 EstimateTaskPoints 按秒计费同一口径：时长截成整数，不足 1 秒按 5 秒。
 * 对应 billing.go paramInt(..., 5) 后再把 <1 抬到 5。
 */
export function estimateSecondDuration(seconds: number, fallback = 5): number {
  const n = Math.trunc(Number(seconds) || 0)
  return n >= 1 ? n : fallback
}

/** 与服务端 EstimateTaskPoints 一致：按秒计费的模型 = 单价 × 时长 × 数量，其余 = 单价 × 数量 */
export function estimateTaskPoints(unitPrice: number, unit: string, count: number, durationSeconds = 0): number {
  const n = Math.max(1, Math.floor(count) || 1)
  if (unit === 'second')
    return unitPrice * Math.max(0, durationSeconds) * n
  return unitPrice * n
}

/** 约一张 2K（1024×1024 再放大 2 倍）。与 billing.go upscaleBillBaseline 一致。 */
export const UPSCALE_BILL_BASELINE = 4_000_000

/**
 * 图片高清积分，与服务端 upscaleBillPoints 同一整数口径。
 * 有原图尺寸：ceil(单价 × 宽 × 高 × 倍数² / 400 万像素)，再和倍数面积比（2→1、4→4、6→9 倍单价）取较高者。
 * 原图小于基准时不压到模型单价以下；没有尺寸时只用面积比。
 */
export function estimateUpscalePoints(unitPrice: number, width: number, height: number, scale: number, count = 1): number {
  const price = Math.floor(Number(unitPrice) || 0)
  if (price <= 0)
    return 0
  const n = Math.max(1, Math.floor(Number(count) || 0) || 1)
  const s = scale === 4 || scale === 6 ? scale : 2
  const floor = price * (s * s / 4)
  const w = Math.floor(Number(width) || 0)
  const h = Math.floor(Number(height) || 0)
  if (w <= 0 || h <= 0)
    return floor * n
  const pixels = BigInt(w) * BigInt(h) * BigInt(s) * BigInt(s)
  const base = BigInt(UPSCALE_BILL_BASELINE)
  let points = (BigInt(price) * pixels + base - 1n) / base
  if (points < BigInt(floor))
    points = BigInt(floor)
  return Number(points) * n
}
