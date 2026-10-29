<script setup lang="ts">
const { t } = useI18n()

definePageMeta({
  layout: 'studio',
  // 列表页缓存实例：从详情页返回时保留已加载的数据与滚动位置
  keepalive: true,
})

useHead({ title: t('探索') })
</script>

<template>
  <section class="agent-page explore-page">
    <h1 class="sr-only">{{ t('探索') }}</h1>
    <div class="agent-feed">
      <StudioWorkFeed :hot="false" :title="t('探索')" />
    </div>
  </section>
</template>
