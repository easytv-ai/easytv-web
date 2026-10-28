<script setup lang="ts">
import PlanPrice from './PlanPrice.vue'
import {
  discountParams,
  formatOff,
  formatValidity,
  formatYuan,
  memberDayDaysLeft,
  memberDayPackPrice,
  type ConfirmPayload,
  type PointsPack,
} from '~/utils/pricing-plans'

const { t } = useI18n()

const emit = defineEmits<{
  buy: [payload: ConfirmPayload]
  back: []
}>()

const { packs, memberDay, memberDayActive, load } = useBillingCatalog()
const { now } = useServerClock()
onMounted(() => void load())

/** 会员日折率文案参数（API.md 9.5 的 pack_discount） */
const memberDayOff = computed(() => discountParams(memberDay.value?.pack_discount ?? 1))
const memberDayChip = computed(() => t('会员日 {rate} 折', memberDayOff.value))
const memberDayLine = computed(() => {
  const md = memberDay.value
  if (!md)
    return ''
  return md.label || t('每月 {day} 日会员日，积分包 {rate} 折', { day: md.day, ...memberDayOff.value })
})

/** 未到会员日时在卡片上提示还有几天，时间基准走 useServerClock() */
const daysLeft = ref(0)
let timer: ReturnType<typeof setInterval> | undefined
function tick() {
  daysLeft.value = memberDayDaysLeft(memberDay.value?.next_at ?? 0, now())
}
watch(memberDay, tick)
onMounted(() => {
  tick()
  timer = setInterval(tick, 60000)
})
onUnmounted(() => {
  if (timer)
    clearInterval(timer)
})
const showComing = computed(() => Boolean(memberDay.value && !memberDayActive.value && memberDayLine.value))

/** 会员日当天按折后价展示，最终价格仍以 POST /billing/quote 为准 */
function packPrice(pack: PointsPack) {
  if (!memberDayActive.value)
    return pack.memberPrice
  return memberDayPackPrice(pack, memberDay.value?.pack_discount ?? 1)
}

function gotoMembership() {
  emit('back')
}

function gotoBuy(pack: PointsPack) {
  const price = packPrice(pack)
  emit('buy', {
    request: { kind: 'points', pack_code: pack.id },
    kind: 'points',
    title: `${pack.points} ${t('积分')} · ${formatValidity(pack.days, t)}`,
    price,
    origin: pack.origin,
    summary: memberDayActive.value
      ? t('会员日 {rate} 折结算，最终价格以订单为准。', memberDayOff.value)
      : t('会员专属价结算。未开通会员将按原价 {price} 支付。', { price: formatYuan(pack.origin) }),
  })
}
</script>

<template>
  <div class="plan-panel">
    <div class="plan-toolbar">
      <p class="plan-panel__note">
        {{ t('积分按档购买，有效期 30 天至 2 年。下方为会员加购价，未开通会员按原价结算。') }}
      </p>
      <button type="button" class="plan-market" @click="gotoMembership">
        {{ t('开通会员') }}
        <UIcon name="i-lucide-chevron-right" class="size-4" />
      </button>
    </div>

    <div class="plan-grid">
      <article
        v-for="pack in packs"
        :key="pack.id"
        class="plan-card"
        :class="{ 'is-featured': pack.days === 365 }"
      >
        <header>
          <h3>{{ pack.points }} {{ t('积分') }}</h3>
          <span class="plan-card__off">{{ formatOff(packPrice(pack), pack.origin, t) }}</span>
        </header>
        <p v-if="pack.days === 365" class="plan-card__badge">{{ t('常用') }}</p>

        <PlanPrice :amount="packPrice(pack)" :origin="pack.origin" />
        <p v-if="memberDayActive" class="plan-card__chip">
          <UIcon name="i-lucide-gift" class="size-3.5" />
          {{ memberDayChip }}
        </p>
        <p v-else-if="showComing" class="plan-card__soon">
          {{ memberDayLine }}<template v-if="daysLeft > 0"> · {{ t('{n} 天后', { n: daysLeft }) }}</template>
        </p>
        <p class="plan-card__points">{{ formatValidity(pack.days, t) }}</p>
        <p class="plan-card__addon">{{ t('会员专属加购价，购买后计入积分钱包') }}</p>

        <button
          type="button"
          class="plan-btn plan-btn--solid"
          @click="gotoBuy(pack)"
        >
          {{ t('购买积分') }}
        </button>

        <ul>
          <li>{{ t('到账 {n} 积分', { n: pack.points }) }}</li>
          <li>{{ formatValidity(pack.days, t) }}{{ t('，到期未用完自动失效') }}</li>
          <li>{{ t('不附带会员权益，可与会员叠加使用') }}</li>
          <li>{{ t('开通会员后按会员价结算') }}</li>
        </ul>
      </article>
    </div>
  </div>
</template>
