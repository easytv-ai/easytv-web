<script setup lang="ts">
import { formatYuan } from '~/utils/pricing-plans'

const props = defineProps<{
  amount: number
  origin?: number
}>()

const dir = ref<'up' | 'down'>('up')

watch(() => props.amount, (next, prev) => {
  if (prev == null || next === prev)
    return
  dir.value = next > prev ? 'up' : 'down'
})
</script>

<template>
  <div class="plan-card__price">
    <span class="plan-card__price-main">
      <Transition :name="dir === 'up' ? 'plan-price-up' : 'plan-price-down'" mode="out-in">
        <strong :key="amount">{{ formatYuan(amount) }}</strong>
      </Transition>
    </span>
    <span class="plan-card__price-origin">
      <Transition name="plan-price-fade" mode="out-in">
        <del v-if="origin && origin > amount" :key="origin">{{ formatYuan(origin) }}</del>
      </Transition>
    </span>
  </div>
</template>
