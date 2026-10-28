<script setup lang="ts">
/**
 * 创作台首页的活动细条：有进行中的活动才显示，取列表里第一个（GET /campaign，API.md 8.6）。
 * 故意做得很薄，不挤占首屏 Banner。
 */
import { useCampaign } from '~/composables/useCampaign'

const { t } = useI18n()
const localePath = useLocalePath()
const { running, loadList, prizeSummary, promoSummary } = useCampaign()

onMounted(() => {
  void loadList()
})
</script>

<template>
  <!-- 列表在 onMounted 才拉，整条放 ClientOnly 里避免水合结构不一致 -->
  <ClientOnly>
    <NuxtLink v-if="running" :to="localePath(`/campaign/${running.slug}`)" class="campaign-strip">
      <UIcon name="i-lucide-trophy" class="size-4 campaign-strip__icon" />
      <strong>{{ running.title }}</strong>
      <span v-if="running.tag" class="campaign-tag">{{ running.tag }}</span>
      <CampaignCountdown :ends-at="running.ends_at" />
      <span v-if="prizeSummary(running.prizes)" class="campaign-strip__prize">{{ prizeSummary(running.prizes) }}</span>
      <span v-if="promoSummary(running)" class="campaign-strip__prize">{{ promoSummary(running) }}</span>
      <span class="campaign-strip__cta">{{ t('投稿参赛') }}<UIcon name="i-lucide-chevron-right" class="size-3.5" /></span>
    </NuxtLink>
  </ClientOnly>
</template>
