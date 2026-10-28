<script setup lang="ts">
const { t } = useI18n()
const localePath = useLocalePath()
const route = useRoute()

const router = useRouter()

const isLegalPage = computed(() => route.path.includes('/legal/'))

useSeoMeta({
  robots: 'noindex, nofollow',
})

/** 协议页的关闭：有站内来路就回上一页，否则回首页（已登录会进创作台） */
function closeLegal() {
  if (import.meta.client && window.history.state?.back)
    router.back()
  else
    void router.push(localePath('/'))
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !isLegalPage.value || event.defaultPrevented)
    return
  const target = event.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable))
    return
  closeLegal()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div
    class="ea-simple-shell flex min-h-screen flex-col"
    :class="isLegalPage ? 'ea-legal-shell' : 'bg-[var(--ea-bg)] text-[color:var(--ea-text)]'"
  >
    <header class="ea-header ea-simple-shell__header shrink-0">
      <div class="flex h-16 w-full items-center justify-between px-6">
        <NuxtLink
          :to="localePath('/')"
          class="flex shrink-0 items-center gap-2.5 no-underline"
          :aria-label="t('返回首页')"
        >
          <img
            src="/images/logo.svg"
            alt="EasyTV"
            width="112"
            height="29"
            class="h-7 w-auto max-w-[min(140px,36vw)] shrink-0 object-contain object-left sm:h-8"
          >
        </NuxtLink>

        <div class="flex shrink-0 items-center gap-5">
          <SiteLocaleSwitcher />
          <ThemeToggle />
          <button
            v-if="isLegalPage"
            type="button"
            class="trash-modal__close ea-simple-shell__close"
            :aria-label="`${t('关闭')} (Esc)`"
            @click="closeLegal"
          >
            <UIcon name="i-lucide-x" class="size-5" />
            <span class="canvas-tip canvas-tip--down">{{ t('关闭') }} <kbd>Esc</kbd></span>
          </button>
        </div>
      </div>
    </header>

    <main
      class="ea-simple-shell__main flex flex-1 px-4 sm:px-6 lg:px-8"
      :class="isLegalPage ? 'min-h-0 justify-start py-8' : 'items-center justify-center py-12'"
    >
      <slot />
    </main>

    <footer class="ea-simple-shell__footer shrink-0 border-t py-6">
      <p class="text-center text-sm">
        © {{ new Date().getFullYear() }} EasyTV
      </p>
    </footer>
  </div>
</template>
