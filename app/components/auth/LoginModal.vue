<script setup lang="ts">
const { t } = useI18n()
const { open, tab, closeLogin } = useLoginModal()
const { applyThemeToDocument } = useTheme()

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape')
    closeLogin()
}

watch(open, (value) => {
  if (!import.meta.client)
    return
  if (value) {
    applyThemeToDocument()
    window.addEventListener('keydown', onKeydown)
  }
  else {
    window.removeEventListener('keydown', onKeydown)
  }
})

onUnmounted(() => {
  if (import.meta.client)
    window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="login-modal" @click.self="closeLogin">
      <div class="xyq-auth-dialog" role="dialog" aria-modal="true" :aria-label="t('欢迎登录')">
        <button type="button" class="xyq-auth-close" :aria-label="t('关闭')" @click="closeLogin">
          <UIcon name="i-lucide-x" class="size-4" />
        </button>
        <AuthHeroVideo />
        <div class="xyq-split__form">
          <div class="xyq-theme">
            <SiteLocaleSwitcher />
            <ThemeToggle />
          </div>
          <LoginRegister :initial-tab="tab" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
