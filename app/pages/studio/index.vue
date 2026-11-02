<script setup lang="ts">
const { t } = useI18n()

definePageMeta({
  layout: 'studio',
  middleware: 'auth',
  // 列表页缓存实例：从详情页返回时保留已加载的数据与滚动位置
  keepalive: true,
})

useHead({
  title: t('首页'),
})
</script>

<template>
  <section class="show-page">
    <div class="show-page__inner show-page__stack">
      <StudioHeroCarousel />
      <StudioCampaignStrip />
      <StudioRecentProjects />
    </div>

    <StudioWorkFeed />
    <StudioWelcomeGift />
  </section>
</template>
