<script setup lang="ts">
const { applyThemeToDocument } = useTheme()

useSeoMeta({
  robots: 'noindex, nofollow',
})

onMounted(() => {
  applyThemeToDocument()
})
</script>

<template>
  <div class="xyq-auth-root">
    <div class="xyq-split">
      <AuthHeroVideo />
      <div class="xyq-split__form">
        <div class="xyq-theme">
          <SiteLocaleSwitcher />
          <ThemeToggle />
        </div>
        <LoginRegister />
        <p class="xyq-auth-footer">© {{ new Date().getFullYear() }} EasyTV</p>
      </div>
    </div>
  </div>
</template>
