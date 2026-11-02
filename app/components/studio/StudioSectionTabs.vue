<script setup lang="ts">
/**
 * 页面顶部的一级标签（探索：全部 / 关注 / 榜单；项目：项目 / 资产 / 主体 / 提示词）。
 * 各页面仍是独立路由，方便分享与刷新；标签只负责在同一组页面间切换。
 */
const props = defineProps<{
  items: readonly { to: string, label: string, auth?: boolean }[]
  /** 读屏用的组名 */
  label: string
}>()

const { t } = useI18n()
const localePath = useLocalePath()
const route = useRoute()
const { requireLogin } = useRequireLogin()

const activeTo = computed(() => {
  const hit = props.items.find((item) => {
    const resolved = localePath(item.to)
    return route.path === resolved || route.path.startsWith(`${resolved}/`)
  })
  return hit?.to ?? ''
})

function gotoTab(event: MouseEvent, item: (typeof props.items)[number], navigate: (event?: MouseEvent) => unknown) {
  if (item.auth && !requireLogin(localePath(item.to))) {
    event.preventDefault()
    return
  }
  void navigate(event)
}
</script>

<template>
  <nav class="section-tabs" :aria-label="label">
    <NuxtLink
      v-for="item in items"
      :key="item.to"
      v-slot="{ href, navigate }"
      :to="localePath(item.to)"
      prefetch
      custom
    >
      <a
        :href="href"
        class="section-tabs__item"
        :class="{ 'is-on': activeTo === item.to }"
        :aria-current="activeTo === item.to ? 'page' : undefined"
        @click="gotoTab($event, item, navigate)"
      >
        {{ t(item.label) }}
      </a>
    </NuxtLink>
  </nav>
</template>
