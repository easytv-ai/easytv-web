<script setup lang="ts">
import PlanPrice from './PlanPrice.vue'
import {

  BILLING_CYCLES,
  PLAN_EDITIONS,
  clampTeamSeats,
  cycleLabel,
  editionLabel,
  formatYuan,
  membershipFeatureGroups,
  quoteMembership,
  type BillingCycle,
  type ConfirmPayload,
  type MembershipTier,
  type PlanEdition,
} from '~/utils/pricing-plans'

const { t } = useI18n()

const props = defineProps<{
  edition: PlanEdition
  cycle: BillingCycle
  seats: number
}>()

const emit = defineEmits<{
  'update:edition': [value: PlanEdition]
  'update:cycle': [value: BillingCycle]
  'update:seats': [value: number]
  subscribe: [payload: ConfirmPayload]
  market: []
}>()

const editionModel = computed({
  get: () => props.edition,
  set: (value: PlanEdition) => emit('update:edition', value),
})

const cycleModel = computed({
  get: () => props.cycle,
  set: (value: BillingCycle) => emit('update:cycle', value),
})

const { tiers, cycleRate, teamSeatRate, teamSeatMin, teamSeatMax, load } = useBillingCatalog()
onMounted(() => void load())

const cards = computed(() => {
  const count = props.edition === 'team' ? props.seats : 1
  return tiers.value.map((tier) => {
    const info = quoteMembership(tier, props.cycle, props.edition, props.seats, cycleRate.value, teamSeatRate.value, t)
    return {
      tier,
      seatPrice: Math.round(info.price / count),
      seatOrigin: Math.round(info.origin / count),
      seatPoints: Math.round(info.monthlyPoints / count),
      total: info.price,
      offLabel: info.offLabel,
      groups: membershipFeatureGroups(tier, props.edition, info.monthlyPoints, t),
      quote: info,
    }
  })
})

function nudgeSeats(delta: number) {
  emit('update:seats', clampTeamSeats(props.seats + delta, teamSeatMin.value, teamSeatMax.value))
}

function gotoPointsMarket() {
  emit('market')
}

function gotoSubscribe(tier: MembershipTier) {
  const info = quoteMembership(tier, props.cycle, props.edition, props.seats, cycleRate.value, teamSeatRate.value, t)
  emit('subscribe', {
    request: {
      kind: 'membership',
      plan_code: tier.id,
      edition: props.edition,
      cycle: props.cycle,
      seats: props.edition === 'team' ? props.seats : 1,
    },
    kind: 'membership',
    title: `${editionLabel(props.edition, t)} · ${t(tier.name)} · ${cycleLabel(props.cycle, t)}`,
    price: info.price,
    origin: info.origin,
    summary: props.edition === 'team'
      ? t('{seats} 个席位，每月 {points} 积分进入共享积分池', { seats: props.seats, points: info.monthlyPoints })
      : t('每月到账 {points} 积分，会员期内按账期刷新', { points: info.monthlyPoints }),
    addOnPoints: info.addOnPoints,
    addOnPrice: info.addOnPrice,
  })
}
</script>

<template>
  <div class="plan-panel">
    <div class="plan-editions" role="tablist" :aria-label="t('会员版本')">
      <label
        v-for="item in PLAN_EDITIONS"
        :key="item.id"
        class="plan-editions__item"
        :class="{ 'is-on': edition === item.id }"
      >
        <input
          v-model="editionModel"
          type="radio"
          name="plan-edition"
          :value="item.id"
        >
        <span>{{ t(item.label) }}</span>
      </label>
    </div>

    <div class="plan-toolbar">
      <div class="plan-cycles" role="radiogroup" :aria-label="t('付费周期')">
        <label
          v-for="item in BILLING_CYCLES"
          :key="item.id"
          class="plan-radio"
          :class="{ 'is-on': cycle === item.id }"
        >
          <input
            v-model="cycleModel"
            type="radio"
            name="plan-cycle"
            :value="item.id"
          >
          <span>{{ t(item.label) }}</span>
          <em v-if="item.off">{{ t('{rate} 折', { rate: item.off, pct: Math.round(Number(item.off) * 10), save: 100 - Math.round(Number(item.off) * 10) }) }}</em>
        </label>
      </div>
      <button type="button" class="plan-market" @click="gotoPointsMarket">
        {{ t('积分充值') }}
        <UIcon name="i-lucide-chevron-right" class="size-4" />
      </button>
    </div>

    <div class="plan-grid">
      <article
        v-for="card in cards"
        :key="card.tier.id"
        class="plan-card"
        :class="{ 'is-featured': card.tier.featured }"
      >
        <header>
          <h3>{{ t(card.tier.name) }}</h3>
          <Transition name="plan-price-fade" mode="out-in">
            <span v-if="card.offLabel" :key="card.offLabel" class="plan-card__off">
              {{ card.offLabel }}
            </span>
          </Transition>
        </header>

        <PlanPrice :amount="card.seatPrice" :origin="card.seatOrigin" />
        <p v-if="edition === 'team'" class="plan-card__unit">{{ t('每席位') }}</p>

        <div v-if="edition === 'team'" class="plan-stepper">
          <button type="button" :aria-label="t('减少席位')" @click="nudgeSeats(-1)">−</button>
          <span>{{ seats }} {{ t('席') }}</span>
          <button type="button" :aria-label="t('增加席位')" @click="nudgeSeats(1)">+</button>
          <em>{{ t('合计') }} {{ formatYuan(card.total) }}</em>
        </div>

        <p class="plan-card__points">
          <Transition name="plan-price-fade" mode="out-in">
            <span :key="card.seatPoints">
              {{ card.seatPoints }} {{ t('积分') }} / {{ t('每月') }}{{ edition === 'team' ? ` / ${t('席')}` : '' }}
            </span>
          </Transition>
        </p>

        <button
          type="button"
          class="plan-btn plan-btn--solid"
          @click="gotoSubscribe(card.tier)"
        >
          {{ edition === 'team' ? t('开通团队会员') : t('开通创作会员') }}
        </button>

        <div v-for="group in card.groups" :key="group.title" class="plan-card__group">
          <h4>{{ group.title }}</h4>
          <ul>
            <li v-for="line in group.items" :key="line">{{ line }}</li>
          </ul>
        </div>
      </article>
    </div>
  </div>
</template>
