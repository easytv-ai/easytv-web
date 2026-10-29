<script setup lang="ts">
const { hydrate, isLoggedIn } = useAuth()
const { restorePricingAfterLogin } = usePricingModal()
const { load: loadAppConfig } = useStudioAppConfig()

onMounted(() => {
  hydrate()
  void loadAppConfig()
  if (isLoggedIn.value)
    restorePricingAfterLogin()
})
</script>

<template>
  <div class="studio-shell">
    <StudioSidebar />
    <div class="studio-main">
      <StudioPromoBanner />
      <StudioHeader />
      <main class="studio-content">
        <slot />
      </main>
    </div>
    <StudioInbox />
    <StudioWalletPanel />
    <StudioPricingModal />
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
