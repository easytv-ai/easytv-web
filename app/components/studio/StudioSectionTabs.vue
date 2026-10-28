<script setup lang="ts">
/**
 * 页面顶部的一级标签（首页：推荐 / 关注 / 榜单；项目：项目 / 资产 / 主体 / 提示词）。
 * 各页面仍是独立路由，方便分享与刷新；标签只负责在同一组页面间切换。
 */
const props = defineProps<{
  items: readonly { to: string, label: string }[]
  /** 读屏用的组名 */
  label: string
}>()

const { t } = useI18n()
const localePath = useLocalePath()
const route = useRoute()

const activeTo = computed(() => {
  const hit = props.items.find((item) => {
    const resolved = localePath(item.to)
    return route.path === resolved || route.path.startsWith(`${resolved}/`)
  })
  return hit?.to ?? ''
})
</script>

<template>
  <nav class="section-tabs" :aria-label="label">
    <NuxtLink
      v-for="item in items"
      :key="item.to"
      :to="localePath(item.to)"
      prefetch
      class="section-tabs__item"
      :class="{ 'is-on': activeTo === item.to }"
      :aria-current="activeTo === item.to ? 'page' : undefined"
    >
      {{ t(item.label) }}
    </NuxtLink>
  </nav>
</template>
