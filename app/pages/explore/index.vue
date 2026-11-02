<script setup lang="ts">
const { t } = useI18n()
const { exploreTabs } = useStudioNav()

definePageMeta({
  layout: 'studio',
  // 列表页缓存实例：从详情页返回时保留已加载的数据与滚动位置
  keepalive: true,
})

useHead({ title: t('探索') })
</script>

<template>
  <section class="show-page explore-page">
    <div class="agent-feed">
      <div class="show-tabs-bar">
        <div class="show-page__inner show-tabs-bar__row">
          <h1 class="sr-only">{{ t('探索') }}</h1>
          <StudioSectionTabs :items="exploreTabs" :label="t('探索')" />
        </div>
      </div>
      <StudioWorkFeed :hot="false" hide-title />
    </div>
  </section>
</template>
