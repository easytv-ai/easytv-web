<script setup lang="ts">
const { t } = useI18n()
const localePath = useLocalePath()
const route = useRoute()
const { resourceLinks } = useStudioNav()

const collapsed = useState('studio-sidebar-collapsed', () => false)
const navRef = ref<HTMLElement | null>(null)
const indicatorOn = ref(false)
const indicatorInstant = ref(true)
const indicatorStyle = ref({
  width: '0px',
  height: '0px',
  transform: 'translate3d(0, 0, 0)',
})

let indicatorTimer = 0
let navObserver: ResizeObserver | null = null

function matchesPath(path: string) {
  const resolved = localePath(path)
  return route.path === resolved || route.path.startsWith(`${resolved}/`)
}

function isActive(item: { to: string, match: readonly string[] }) {
  if (item.match.some(matchesPath))
    return true
  if (item.to === '/studio')
    return route.path === localePath('/studio')
  return matchesPath(item.to)
}

const activeKey = computed(() => resourceLinks.find(item => isActive(item))?.to ?? '')

/** 选中底跟着当前项平移；收起侧栏或尺寸变化时直接对齐，避免从角落滑出来 */
function syncIndicator(animate: boolean) {
  const active = navRef.value?.querySelector<HTMLElement>('a.is-active')
  if (!active) {
    indicatorOn.value = false
    return
  }
  const canSlide = animate && indicatorOn.value
  indicatorInstant.value = !canSlide
  indicatorOn.value = true
  indicatorStyle.value = {
    width: `${active.offsetWidth}px`,
    height: `${active.offsetHeight}px`,
    transform: `translate3d(${active.offsetLeft}px, ${active.offsetTop}px, 0)`,
  }
  if (canSlide)
    return
  window.clearTimeout(indicatorTimer)
  indicatorTimer = window.setTimeout(() => {
    indicatorInstant.value = false
  }, 60)
}

function toggleCollapsed() {
  collapsed.value = !collapsed.value
}

watch(activeKey, (_key, previous) => {
  syncIndicator(previous != null)
}, { flush: 'post' })

watch(collapsed, () => {
  syncIndicator(false)
}, { flush: 'post' })

onMounted(() => {
  syncIndicator(false)
  if (typeof ResizeObserver === 'undefined' || !navRef.value)
    return
  navObserver = new ResizeObserver(() => syncIndicator(false))
  navObserver.observe(navRef.value)
  navRef.value.querySelectorAll('a').forEach(link => navObserver?.observe(link))
})

onBeforeUnmount(() => {
  window.clearTimeout(indicatorTimer)
  navObserver?.disconnect()
})
</script>

<template>
  <aside class="studio-sidebar" :class="{ 'is-collapsed': collapsed }">
    <div class="studio-sidebar__top">
      <NuxtLink
        v-if="!collapsed"
        :to="localePath('/agent')"
        class="studio-sidebar__brand"
      >
        <img src="/images/logo.svg" alt="EasyTV" width="28" height="28">
        <span>EasyTV</span>
      </NuxtLink>

      <button
        v-if="collapsed"
        type="button"
        class="studio-sidebar__logo-btn"
        :aria-label="t('展开侧边栏')"
        @click="toggleCollapsed"
      >
        <img src="/images/logo.svg" alt="EasyTV" width="28" height="28" class="studio-sidebar__logo-icon">
        <UIcon name="i-lucide-panel-left" class="studio-sidebar__expand-icon size-4" />
        <span class="studio-sidebar__tip">{{ t('展开侧边栏') }}</span>
      </button>

      <button
        v-else
        type="button"
        class="studio-sidebar__toggle"
        :aria-label="t('收起菜单')"
        @click="toggleCollapsed"
      >
        <UIcon name="i-lucide-panel-left" class="size-4" />
        <span class="canvas-tip">{{ t('收起菜单') }}</span>
      </button>
    </div>

    <nav ref="navRef" class="studio-nav">
      <span
        class="studio-nav__indicator"
        :class="{ 'is-on': indicatorOn, 'is-instant': indicatorInstant }"
        :style="indicatorStyle"
        aria-hidden="true"
      />
      <NuxtLink
        v-for="item in resourceLinks"
        :key="item.to"
        :to="localePath(item.to)"
        prefetch
        :class="{ 'is-active': isActive(item) }"
      >
        <UIcon :name="item.icon" class="size-4" />
        <span class="studio-nav__label-text">{{ t(item.label) }}</span>
        <span class="studio-sidebar__tip">{{ t(item.label) }}</span>
      </NuxtLink>
    </nav>
  </aside>
</template>
