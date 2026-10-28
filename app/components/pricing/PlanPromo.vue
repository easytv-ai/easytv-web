<script setup lang="ts">
import { discountParams, memberDayDaysLeft } from '~/utils/pricing-plans'

const { t } = useI18n()

const { promo, promoEndsAt, memberDay, memberDayActive, load } = useBillingCatalog()
const { now } = useServerClock()

/** 文案优先用 GET /billing/plans 的 promo.title / subtitle，接口没配时回退到常量文案 */
const promoTitle = computed(() => String(promo.value?.title ?? '').trim() || t('年会员最低 {rate} 折', { rate: '6.2', pct: 62, save: 38 }))
const promoSubtitle = computed(() => String(promo.value?.subtitle ?? '').trim() || t('创作会员限时优惠，视频模型会员价结算，9 月 11 日 24 点截止'))

/** 秒级刷新的时间基准，会员日「x 天后」跟促销倒计时共用一个 tick */
const nowMs = ref(0)

/** 会员日（API.md 9.5）：day>0 才展示，当天提示已生效，否则提示还有几天 */
const memberDayOff = computed(() => discountParams(memberDay.value?.pack_discount ?? 1))
const memberDayText = computed(() => {
  const md = memberDay.value
  if (!md)
    return ''
  const line = md.label || t('每月 {day} 日会员日，积分包 {rate} 折', { day: md.day, ...memberDayOff.value })
  if (memberDayActive.value)
    return `${line} · ${t('今天生效')}`
  const days = memberDayDaysLeft(md.next_at, nowMs.value || now())
  return days > 0 ? `${line} · ${t('{n} 天后', { n: days })}` : line
})

const remain = ref({ days: '00', hours: '00', minutes: '00', seconds: '00', ended: false })
let timer: ReturnType<typeof setInterval> | undefined

function pad(n: number) {
  return String(Math.max(0, n)).padStart(2, '0')
}

function tick() {
  nowMs.value = now()
  const left = promoEndsAt.value - Date.now()
  if (left <= 0) {
    remain.value = { days: '00', hours: '00', minutes: '00', seconds: '00', ended: true }
    return
  }
  const days = Math.floor(left / 86400000)
  const hours = Math.floor((left % 86400000) / 3600000)
  const minutes = Math.floor((left % 3600000) / 60000)
  const seconds = Math.floor((left % 60000) / 1000)
  remain.value = {
    days: pad(days),
    hours: pad(hours),
    minutes: pad(minutes),
    seconds: pad(seconds),
    ended: false,
  }
}

onMounted(() => {
  void load()
  tick()
  timer = setInterval(tick, 1000)
})

onUnmounted(() => {
  if (timer)
    clearInterval(timer)
})
</script>

<template>
  <div class="plan-promo">
    <div class="plan-promo__copy">
      <strong>{{ promoTitle }}</strong>
      <span>{{ promoSubtitle }}</span>
      <p v-if="memberDayText" class="plan-promo__member-day" :class="{ 'is-on': memberDayActive }">
        <UIcon name="i-lucide-gift" class="size-3.5" />
        {{ memberDayText }}
      </p>
    </div>
    <div v-if="!remain.ended" class="plan-promo__time" :aria-label="t('活动倒计时')">
      <b>{{ remain.days }}</b><em>{{ t('天') }}</em>
      <b>{{ remain.hours }}</b><em>{{ t('时') }}</em>
      <b>{{ remain.minutes }}</b><em>{{ t('分') }}</em>
      <b>{{ remain.seconds }}</b><em>{{ t('秒') }}</em>
    </div>
    <p v-else class="plan-promo__ended">{{ t('本轮活动已结束') }}</p>
  </div>
</template>
