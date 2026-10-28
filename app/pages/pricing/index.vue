<script setup lang="ts">
import PlanBoard from '~/components/pricing/PlanBoard.vue'
import { parseProductTab, type ProductTab } from '~/utils/pricing-plans'

const { t } = useI18n()

definePageMeta({
  layout: 'studio',
})

useSeoMeta({
  description: t('EasyTV 会员与积分定价：入门、创作、专业、旗舰四档会员每月到账积分，视频模型按会员价结算；积分包 30 天到 2 年有效。'),
})

useHead({
  title: t('定价'),
})

const route = useRoute()
const router = useRouter()

const tab = computed({
  get: () => parseProductTab(route.query.tab),
  set: (value: ProductTab) => {
    const query = { ...route.query }
    if (value === 'membership')
      delete query.tab
    else
      query.tab = value
    void router.replace({ path: route.path, query })
  },
})
</script>

<template>
  <PlanBoard v-model:tab="tab" />
</template>
