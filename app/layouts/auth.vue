<script setup lang="ts">
const { applyThemeToDocument } = useTheme()
const router = useRouter()

useSeoMeta({
  robots: 'noindex, nofollow',
})

const wall = [
  '/images/showcase/mountain.jpg',
  '/images/showcase/coast.jpg',
  '/images/showcase/waterfall.jpg',
  '/images/showcase/portrait.jpg',
  '/images/showcase/music.jpg',
  '/images/showcase/ocean.jpg',
  '/images/showcase/city-night.jpg',
  '/images/showcase/neon-rain.jpg',
  '/images/showcase/desert-road.jpg',
  '/images/showcase/city-walk.jpg',
  '/gifs/showcase/scenic.webp',
  '/gifs/login-hero.webp',
]

const canClose = ref(false)

function closeLogin() {
  router.back()
}

onMounted(() => {
  applyThemeToDocument()
  const back = window.history.state?.back
  canClose.value = typeof back === 'string' && back.length > 0 && !back.endsWith('/login') && back !== '/'
})
</script>

<template>
  <div class="xyq-auth-root">
    <div class="xyq-auth-wall" aria-hidden="true">
      <img v-for="(src, index) in wall" :key="src" :src="src" alt="" :style="{ objectPosition: index % 2 ? 'center top' : 'center' }">
    </div>
    <div class="xyq-auth-dim" aria-hidden="true" />
    <div class="xyq-auth-dialog" role="dialog" aria-modal="true">
      <button v-if="canClose" type="button" class="xyq-auth-close" @click="closeLogin">
        <UIcon name="i-lucide-x" class="size-4" />
      </button>
      <AuthHeroVideo />
      <div class="xyq-split__form">
        <div class="xyq-theme">
          <SiteLocaleSwitcher />
          <ThemeToggle />
        </div>
        <LoginRegister />
      </div>
    </div>
  </div>
</template>
