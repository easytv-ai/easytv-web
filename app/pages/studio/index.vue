<script setup lang="ts">
const { t } = useI18n()
const { homeTabs } = useStudioNav()

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
    <div class="show-tabs-bar">
      <div class="show-page__inner show-tabs-bar__row">
        <h1 class="sr-only">{{ t('首页') }}</h1>
        <StudioSectionTabs :items="homeTabs" :label="t('首页')" />
      </div>
    </div>
    <div class="show-page__inner show-page__stack">
      <StudioHeroCarousel />
      <StudioCampaignStrip />
      <StudioRecentProjects />
    </div>

    <StudioWorkFeed />
    <StudioWelcomeGift />
  </section>
</template>
