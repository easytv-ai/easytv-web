<script setup lang="ts">
import { COMPARE_MODELS, compareTierLabel, estimateYield } from '~/utils/pricing-plans'

const { t } = useI18n()

const { tiers, modelPrices, load } = useBillingCatalog()
onMounted(() => void load())

const UNIT_LABEL: Record<string, string> = { second: t('秒'), image: t('张'), call: t('次') }
/** 对比表的模型：优先运营配置的模型定价，没有时用常量 */
const compareModels = computed(() => {
  const priced = modelPrices.value.filter(item => item.points_per_unit > 0)
  if (!priced.length)
    return COMPARE_MODELS.map(item => ({ ...item }))
  return priced.slice(0, 6).map(item => ({
    name: item.label || item.model,
    unit: UNIT_LABEL[item.unit] ?? t('次'),
    pointsPer: item.member_points_per_unit || item.points_per_unit,
  }))
})
</script>

<template>
  <section class="plan-compare" aria-labelledby="plan-compare-title">
    <h2 id="plan-compare-title">{{ t('每月生成数量 / 每席位') }}</h2>
    <div class="plan-compare__table-wrap">
      <table>
        <thead>
          <tr>
            <th>{{ t('模型') }}</th>
            <th v-for="tier in tiers" :key="tier.id">
              {{ t(tier.name) }} {{ compareTierLabel(tier).slice(tier.name.length + 1) }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="model in compareModels" :key="model.name">
            <th>{{ model.name }}</th>
            <td v-for="tier in tiers" :key="`${tier.id}-${model.name}`">
              {{ estimateYield(tier.monthlyPoints, model.pointsPer) }} {{ model.unit }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p>{{ t('数量按单模型估算，实际消耗随分辨率、时长和所选模型变化。') }}</p>
  </section>
</template>
