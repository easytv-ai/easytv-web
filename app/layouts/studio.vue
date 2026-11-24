<script setup lang="ts">
const { hydrate, isLoggedIn } = useAuth()
const { restorePricingAfterLogin } = usePricingModal()
const { load: loadAppConfig } = useStudioAppConfig()
const { settingsMounted } = useSettingsModal()
const mobileNavOpen = useState('studio-mobile-nav', () => false)
const route = useRoute()
/** 画布等全屏页：侧栏还在 DOM 里，只是藏起来，回首页不用重新挂菜单 */
const immersive = computed(() => Boolean(route.meta.immersive))

onMounted(() => {
  hydrate()
  void loadAppConfig()
  if (isLoggedIn.value)
    restorePricingAfterLogin()
})
</script>

<template>
  <div class="studio-shell" :class="{ 'is-immersive': immersive }">
    <StudioSidebar :inert="immersive" />
    <button
      v-if="mobileNavOpen"
      type="button"
      class="studio-nav-mask"
      :aria-label="$t('收起菜单')"
      @click="mobileNavOpen = false"
    />
    <div class="studio-main">
      <StudioPromoBanner :inert="immersive" />
      <StudioHeader :inert="immersive" />
      <main class="studio-content">
        <slot />
      </main>
    </div>
    <StudioInbox />
    <StudioWalletPanel />
    <StudioPricingModal />
    <ClientOnly>
      <LazyStudioSettingsModal v-if="settingsMounted" />
    </ClientOnly>
    <ClientOnly>
      <StudioGrowthTasks />
    </ClientOnly>
  </div>
</template>

<style>
@import '~/assets/css/studio-parts/layout.css';
@import '~/assets/css/studio-parts/growth.css';
@import '~/assets/css/studio-parts/shell.css';
</style>
