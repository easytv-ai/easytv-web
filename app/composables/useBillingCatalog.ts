import billingApi from '~/api/billing'
import type { BillingCatalog, BillingPromo, MemberDay, ModelPrice } from '~/types/creative'
import {
  CYCLE_RATE,
  MEMBERSHIP_TIERS,
  POINTS_PACKS,
  PROMO_ENDS_AT,
  TEAM_SEAT_MAX,
  TEAM_SEAT_MIN,
  TEAM_SEAT_RATE,
  type BillingCycle,
  type MembershipTier,
  type PointsPack,
} from '~/utils/pricing-plans'

/**
 * 定价目录：GET /billing/plans 的会员计划 / 积分包 / 促销 / 支付方式，
 * 映射成定价页组件一直在用的 MembershipTier / PointsPack 形状；接口不可用时回退到常量。
 */
export function useBillingCatalog() {
  const tiers = useState<MembershipTier[]>('billing-tiers', () => MEMBERSHIP_TIERS)
  const packs = useState<PointsPack[]>('billing-packs', () => POINTS_PACKS)
  const promo = useState<BillingPromo | null>('billing-promo', () => null)
  const payMethods = useState<BillingCatalog['pay_methods']>('billing-pay-methods', () => ({ wechat_native: false, alipay_f2f: false }))
  const modelPrices = useState<ModelPrice[]>('billing-model-prices', () => [])
  const loaded = useState('billing-catalog-loaded', () => false)
  const loading = useState('billing-catalog-loading', () => false)

  /** 周期系数：促销有效期内用后台配置，否则全部按 1 */
  const cycleRate = computed<Record<BillingCycle, number>>(() => {
    const p = promo.value
    if (!p)
      return CYCLE_RATE
    const active = p.enabled && (!p.ends_at || p.ends_at * 1000 > Date.now())
    if (!active)
      return { month: 1, quarter: 1, year: 1 }
    return {
      month: p.cycle_rate.month ?? 1,
      quarter: p.cycle_rate.quarter ?? 1,
      year: p.cycle_rate.year ?? 1,
    }
  })
  const teamSeatRate = computed(() => promo.value?.team_seat_rate ?? TEAM_SEAT_RATE)
  const teamSeatMin = computed(() => promo.value?.team_seat_min ?? TEAM_SEAT_MIN)
  const teamSeatMax = computed(() => promo.value?.team_seat_max ?? TEAM_SEAT_MAX)
  /** 会员日（API.md 9.5）：后端没配或 day=0 时为 null，前端一律按「没有会员日」处理 */
  const memberDay = computed<MemberDay | null>(() => {
    const raw = promo.value?.member_day
    if (!raw)
      return null
    const day = Number(raw.day) || 0
    if (day <= 0)
      return null
    return {
      day,
      pack_discount: Number(raw.pack_discount) || 1,
      active: raw.active === true,
      next_at: Number(raw.next_at) || 0,
      label: String(raw.label ?? '').trim(),
    }
  })
  /** 今天是会员日，且确实有折扣 */
  const memberDayActive = computed(() => {
    const md = memberDay.value
    return Boolean(md?.active && md.pack_discount > 0 && md.pack_discount < 1)
  })

  const promoEndsAt = computed(() => promo.value?.ends_at ? promo.value.ends_at * 1000 : PROMO_ENDS_AT)
  const promoActive = computed(() => {
    const p = promo.value
    if (!p)
      return PROMO_ENDS_AT > Date.now()
    return p.enabled && (!p.ends_at || p.ends_at * 1000 > Date.now())
  })

  async function load(force = false) {
    if (!import.meta.client || loading.value || (loaded.value && !force))
      return
    loading.value = true
    try {
      const [catalogRes, priceRes] = await Promise.all([billingApi.catalog(), billingApi.modelPrices()])
      if (catalogRes?.success && catalogRes.data) {
        const data = catalogRes.data
        if (data.plans?.length) {
          tiers.value = data.plans.map(p => ({
            id: p.code,
            name: p.name,
            featured: p.featured,
            monthlyOrigin: p.monthly_origin,
            monthlyPrice: p.monthly_price,
            monthlyPoints: p.monthly_points,
            addOnPoints: p.add_on_points,
            addOnPrice: p.add_on_price,
            concurrent: p.concurrent,
            storage: `${p.storage_gb} GB`,
          }))
        }
        if (data.packs?.length) {
          packs.value = data.packs.map(p => ({
            id: p.code,
            points: p.points,
            days: p.valid_days,
            origin: p.origin,
            memberPrice: p.member_price,
          }))
        }
        promo.value = data.promo ?? null
        payMethods.value = data.pay_methods ?? { wechat_native: false, alipay_f2f: false }
        loaded.value = true
      }
      if (priceRes?.success && Array.isArray(priceRes.data))
        modelPrices.value = priceRes.data
    }
    finally {
      loading.value = false
    }
  }

  return {
    tiers,
    packs,
    promo,
    payMethods,
    modelPrices,
    loaded,
    cycleRate,
    teamSeatRate,
    teamSeatMin,
    teamSeatMax,
    promoEndsAt,
    promoActive,
    memberDay,
    memberDayActive,
    load,
  }
}
