import campaignApi from '~/api/campaign'
import type { Campaign, CampaignPrize, CampaignStatus } from '~/types/creative'
import { campaignPromoItems, campaignPromoLabel } from '~/utils/campaign-promo'

export const CAMPAIGN_DRAFT: CampaignStatus = 0
export const CAMPAIGN_ACTIVE: CampaignStatus = 1
export const CAMPAIGN_ENDED: CampaignStatus = 2
export const CAMPAIGN_SETTLED: CampaignStatus = 3

/**
 * 活动公共逻辑（API.md 8.6）：列表缓存、状态文案、奖池摘要、倒计时。
 * 倒计时一律走 useServerClock().now()，校准后所有倒计时同时受益。
 */
export function useCampaign() {
  const { t } = useI18n()
  const { now } = useServerClock()

  /** 列表结果全站缓存一份：活动页、创作台横幅、发布弹窗共用 */
  const list = useState<Campaign[] | null>('campaign-list', () => null)
  const loading = useState('campaign-list-loading', () => false)
  /** 请求失败且还没有可用列表：页面显示失败，不要写成「暂无活动」 */
  const failed = useState('campaign-list-failed', () => false)

  /** 进行中且已到开始时间的第一个活动，没有就是 null */
  const running = computed(() => {
    const t0 = Math.floor(now() / 1000)
    return (list.value ?? []).find(item => item.status === CAMPAIGN_ACTIVE && (!item.starts_at || item.starts_at <= t0)) ?? null
  })

  /** 拉一次列表，已有成功缓存直接用；force 用于投稿后刷新投稿数。失败不写入空数组，避免下次被当成「没有活动」 */
  async function loadList(force = false) {
    if (loading.value)
      return list.value
    if (list.value && !failed.value && !force)
      return list.value
    loading.value = true
    try {
      const res = await campaignApi.list()
      if (!res?.success || !Array.isArray(res.data)) {
        failed.value = !list.value?.length
        return list.value
      }
      list.value = res.data
      failed.value = false
      return list.value
    }
    catch {
      failed.value = !list.value?.length
      return list.value
    }
    finally {
      loading.value = false
    }
  }

  /** 还没开始（后台已上线但 starts_at 在未来） */
  function notStarted(item: Campaign) {
    return item.status === CAMPAIGN_ACTIVE && item.starts_at > 0 && item.starts_at * 1000 > now()
  }

  function statusLabel(item: Campaign) {
    if (item.status === CAMPAIGN_SETTLED)
      return t('已发奖')
    if (item.status === CAMPAIGN_ENDED)
      return t('已结束')
    return notStarted(item) ? t('即将开始') : t('进行中')
  }

  /** 「剩余 3 天 5 时」；不足一天换成「剩余 5 时 12 分」，结束或未开始返回空串 */
  function countdownText(endsAt: number) {
    const left = endsAt * 1000 - now()
    if (!endsAt || left <= 0)
      return ''
    const days = Math.floor(left / 86400000)
    const hours = Math.floor((left % 86400000) / 3600000)
    const minutes = Math.floor((left % 3600000) / 60000)
    if (days > 0)
      return t('剩余 {d} 天 {h} 时', { d: days, h: hours })
    return t('剩余 {h} 时 {m} 分', { h: hours, m: minutes })
  }

  /** 「第 1 名」/「第 4-10 名」 */
  function prizeRank(prize: CampaignPrize) {
    return prize.rank_to > prize.rank_from
      ? t('第 {from}-{to} 名', { from: prize.rank_from, to: prize.rank_to })
      : t('第 {n} 名', { n: prize.rank_from })
  }

  /** 「300 积分 + 7 天会员」 */
  function prizeReward(prize: CampaignPrize) {
    const parts: string[] = []
    if (prize.points > 0)
      parts.push(t('{n} 积分', { n: prize.points }))
    if (prize.member_days > 0)
      parts.push(t('{n} 天会员', { n: prize.member_days }))
    return parts.join(' + ') || '—'
  }

  function promoItems(item: Campaign | null | undefined) {
    return campaignPromoItems(item)
  }

  /** 卡片上的一句活动价：取第一条标签 */
  function promoSummary(item: Campaign | null | undefined) {
    const first = promoItems(item)[0]
    if (!first)
      return ''
    return campaignPromoLabel(first, t('活动价'))
  }

  /** 卡片上的一句奖池摘要：取第一档，如「第 1 名 300 积分」 */
  function prizeSummary(prizes: CampaignPrize[] | null | undefined) {
    const first = (prizes ?? [])[0]
    if (!first)
      return ''
    return `${prizeRank(first)} ${prizeReward(first)}`
  }

  /** 我的投稿状态：待审 / 已通过 / 第 n 名 */
  function entryStatusLabel(entry: { status: number, rank: number }) {
    if (entry.rank > 0)
      return t('第 {n} 名', { n: entry.rank })
    if (entry.status === 1)
      return t('已通过')
    if (entry.status === 2)
      return t('已驳回')
    return t('待审')
  }

  return {
    list,
    running,
    loading,
    failed,
    loadList,
    notStarted,
    statusLabel,
    countdownText,
    prizeRank,
    prizeReward,
    prizeSummary,
    promoItems,
    promoSummary,
    entryStatusLabel,
  }
}
