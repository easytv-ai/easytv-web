import type { BillingQuoteRequest } from '~/types/creative'

export type ProductTab = 'membership' | 'points'

/** 文案翻译函数（组件里传 useI18n().t）；默认只做 {name} 插值、不翻译 */
export type PlanTranslator = (key: string, params?: Record<string, unknown>) => string
export const plainT: PlanTranslator = (key, params) =>
  key.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))
export type PlanEdition = 'creator' | 'team'
export type BillingCycle = 'month' | 'quarter' | 'year'

export const PLAN_EDITIONS = [
  { id: 'creator' as const, label: '创作会员' },
  { id: 'team' as const, label: '团队版会员' },
]

export const BILLING_CYCLES = [
  { id: 'year' as const, label: '按年购买', off: '6.2' },
  { id: 'quarter' as const, label: '按季购买', off: '8.5' },
  { id: 'month' as const, label: '按月购买', off: '' },
]

export const TEAM_SEAT_MIN = 2
export const TEAM_SEAT_MAX = 10
export const PROMO_ENDS_AT = Date.parse('2026-09-12T00:00:00+08:00')

export const COMPARE_MODELS = [
  { name: 'Seedance 2.0 · 720P', unit: '秒', pointsPer: 8 },
  { name: 'Seedance 2.0 Fast', unit: '秒', pointsPer: 5 },
  { name: '通用图片', unit: '张', pointsPer: 2 },
] as const

export type FeatureGroup = {
  title: string
  items: string[]
}

export const CYCLE_MONTHS: Record<BillingCycle, number> = {
  month: 1,
  quarter: 3,
  year: 12,
}

/** 相对月付现价的周期系数 */
export const CYCLE_RATE: Record<BillingCycle, number> = {
  month: 1,
  quarter: 0.85,
  year: 0.62,
}

export const TEAM_SEAT_RATE = 0.9

export type MembershipTier = {
  id: string
  name: string
  featured?: boolean
  monthlyOrigin: number
  monthlyPrice: number
  monthlyPoints: number
  addOnPoints: number
  addOnPrice: number
  concurrent: number
  storage: string
}

export const MEMBERSHIP_TIERS: MembershipTier[] = [
  {
    id: 'starter',
    name: '入门',
    monthlyOrigin: 199,
    monthlyPrice: 129,
    monthlyPoints: 800,
    addOnPoints: 400,
    addOnPrice: 36,
    concurrent: 6,
    storage: '50 GB',
  },
  {
    id: 'creator',
    name: '创作',
    featured: true,
    monthlyOrigin: 399,
    monthlyPrice: 259,
    monthlyPoints: 1800,
    addOnPoints: 800,
    addOnPrice: 69,
    concurrent: 10,
    storage: '130 GB',
  },
  {
    id: 'pro',
    name: '专业',
    monthlyOrigin: 999,
    monthlyPrice: 599,
    monthlyPoints: 5800,
    addOnPoints: 2400,
    addOnPrice: 199,
    concurrent: 16,
    storage: '200 GB',
  },
  {
    id: 'flagship',
    name: '旗舰',
    monthlyOrigin: 1999,
    monthlyPrice: 999,
    monthlyPoints: 15800,
    addOnPoints: 6000,
    addOnPrice: 459,
    concurrent: 20,
    storage: '500 GB',
  },
]

export type PointsPack = {
  id: string
  points: number
  days: number
  origin: number
  memberPrice: number
}

export const POINTS_PACKS: PointsPack[] = [
  { id: 'p30', points: 600, days: 30, origin: 39, memberPrice: 26 },
  { id: 'p90', points: 1800, days: 90, origin: 99, memberPrice: 69 },
  { id: 'p365', points: 6000, days: 365, origin: 299, memberPrice: 199 },
  { id: 'p730', points: 20000, days: 730, origin: 799, memberPrice: 499 },
]

export type MembershipQuote = {
  origin: number
  price: number
  monthlyPoints: number
  months: number
  offLabel: string
  addOnPoints: number
  addOnPrice: number
}

export type ConfirmPayload = {
  kind: ProductTab
  title: string
  price: number
  origin: number
  summary: string
  addOnPoints?: number
  addOnPrice?: number
  /** 提交给 POST /billing/quote 与 POST /user/order 的商品参数 */
  request: BillingQuoteRequest
}

export function parseProductTab(value: unknown): ProductTab {
  return value === 'points' ? 'points' : 'membership'
}

export function formatYuan(amount: number): string {
  return `¥${amount}`
}

export function formatMoney(amount: number): string {
  const n = Number(amount)
  if (!Number.isFinite(n))
    return '¥0.00'
  return `¥${n.toFixed(2)}`
}

export function formatPoints(amount: number): string {
  const n = Number(amount)
  if (!Number.isFinite(n))
    return '0'
  return new Intl.NumberFormat('zh-CN').format(n)
}

export function formatOff(price: number, origin: number, tr: PlanTranslator = plainT): string {
  if (!origin || price >= origin)
    return ''
  const off = Math.round((price / origin) * 100) / 10
  const text = Number.isInteger(off) ? String(off) : off.toFixed(1)
  const pct = Math.round(off * 10)
  return tr('限时 {rate} 折', { rate: text, pct, save: 100 - pct })
}

/** 折扣系数 → 折率文案：0.8 → 「8」，0.85 → 「8.5」 */
export function discountRate(discount: number): string {
  const off = Math.round(Number(discount) * 1000) / 100
  return Number.isInteger(off) ? String(off) : off.toFixed(1)
}

/** 折扣系数 → 折率文案参数：0.8 → { rate: '8', pct: 80, save: 20 }，en / ja 用 {save} 表述 */
export function discountParams(discount: number): { rate: string, pct: number, save: number } {
  const rate = discountRate(discount)
  const pct = Math.round(Number(rate) * 10)
  return { rate, pct, save: 100 - pct }
}

/**
 * 会员日积分包价：按原价打折（API.md 9.5「不与会员价叠加计算两次，取折后价」），
 * 会员价本身更低时仍按会员价，最终价格以 POST /billing/quote 为准。
 */
export function memberDayPackPrice(pack: PointsPack, discount: number): number {
  const rate = Number(discount)
  if (!(rate > 0) || rate >= 1)
    return pack.memberPrice
  return Math.min(pack.memberPrice, Math.round(pack.origin * rate))
}

/** 距离下个会员日还有几天；已到或没有 next_at 返回 0 */
export function memberDayDaysLeft(nextAt: number, nowMs: number): number {
  const target = Number(nextAt) * 1000
  if (!(target > 0))
    return 0
  const left = target - nowMs
  if (left <= 0)
    return 0
  return Math.max(1, Math.ceil(left / 86400000))
}

export function formatValidity(days: number, tr: PlanTranslator = plainT): string {
  if (days >= 730)
    return tr('有效期 2 年')
  if (days >= 365)
    return tr('有效期 1 年')
  return tr('有效期 {n} 天', { n: days })
}

export function quoteMembership(
  tier: MembershipTier,
  cycle: BillingCycle,
  edition: PlanEdition,
  seats: number,
  rates: Record<BillingCycle, number> = CYCLE_RATE,
  seatRate: number = TEAM_SEAT_RATE,
  tr: PlanTranslator = plainT,
): MembershipQuote {
  const months = CYCLE_MONTHS[cycle]
  const seatCount = edition === 'team' ? seats : 1
  const teamRate = edition === 'team' ? seatRate : 1
  const origin = tier.monthlyOrigin * months * seatCount
  const price = Math.round(tier.monthlyPrice * months * (rates[cycle] ?? 1) * seatCount * teamRate)
  return {
    origin,
    price,
    monthlyPoints: tier.monthlyPoints * seatCount,
    months,
    offLabel: formatOff(price, origin, tr),
    addOnPoints: tier.addOnPoints * seatCount,
    addOnPrice: Math.round(tier.addOnPrice * seatCount * (edition === 'team' ? seatRate : 1)),
  }
}

export function membershipFeatureGroups(
  tier: MembershipTier,
  edition: PlanEdition,
  monthlyPoints: number,
  tr: PlanTranslator = plainT,
): FeatureGroup[] {
  const video = {
    title: tr('视频权益'),
    items: [
      edition === 'team'
        ? tr('每月 {n} 积分进入共享积分池', { n: monthlyPoints })
        : tr('每月 {n} 积分', { n: monthlyPoints }),
      tr('视频 / 图片模型会员折扣'),
      tr('去水印导出'),
      tr('1080P 高清导出'),
    ],
  }
  if (edition === 'team') {
    return [
      video,
      {
        title: tr('协作效率'),
        items: [tr('{n} 路并发生成', { n: tier.concurrent }), tr('多人协作画布'), tr('{size} 共享云存储', { size: tier.storage })],
      },
      {
        title: tr('管理'),
        items: [tr('席位管理'), tr('用量看板')],
      },
    ]
  }
  return [
    video,
    {
      title: tr('创作效率'),
      items: [tr('{n} 路并发生成', { n: tier.concurrent }), tr('{size} 云存储', { size: tier.storage }), tr('支持 CLI 工具')],
    },
  ]
}

export function compareTierLabel(tier: MembershipTier): string {
  if (tier.monthlyPoints >= 1000)
    return `${tier.name} ${(tier.monthlyPoints / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return `${tier.name} ${tier.monthlyPoints}`
}

export function estimateYield(points: number, pointsPer: number): number {
  return Math.max(0, Math.floor(points / pointsPer))
}

export function clampTeamSeats(seats: number, min = TEAM_SEAT_MIN, max = TEAM_SEAT_MAX): number {
  return Math.min(max, Math.max(min, seats))
}

export function cycleLabel(cycle: BillingCycle, tr: PlanTranslator = plainT): string {
  return tr(BILLING_CYCLES.find(item => item.id === cycle)?.label ?? '月付')
}

export function editionLabel(edition: PlanEdition, tr: PlanTranslator = plainT): string {
  return tr(PLAN_EDITIONS.find(item => item.id === edition)?.label ?? '创作版')
}
