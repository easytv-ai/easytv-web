<script setup lang="ts">
const { t } = useI18n()
const heroIndex = ref(0)
let heroTimer: ReturnType<typeof setTimeout> | undefined

const heroClips = [
  '/gifs/login-hero.webp',
  '/gifs/showcase/scenic.webp',
  '/gifs/showcase/coast.webp',
  '/gifs/showcase/waterfall.webp',
  '/gifs/showcase/music.webp',
  '/gifs/showcase/ocean.webp',
  '/gifs/showcase/city-night.webp',
  '/gifs/showcase/neon-rain.webp',
  '/gifs/showcase/desert-road.webp',
  '/gifs/showcase/city-walk.webp',
]

const currentHero = computed(() => heroClips[heroIndex.value] ?? heroClips[0])

function stopHeroRotate() {
  if (heroTimer) {
    clearTimeout(heroTimer)
    heroTimer = undefined
  }
}

function nextHeroClip() {
  stopHeroRotate()
  heroIndex.value = (heroIndex.value + 1) % heroClips.length
}

function startHeroRotate() {
  stopHeroRotate()
  heroTimer = setTimeout(nextHeroClip, 6000)
}

watch(heroIndex, () => {
  startHeroRotate()
})

onMounted(() => {
  startHeroRotate()
})

onUnmounted(() => {
  stopHeroRotate()
})
</script>

<template>
  <div class="xyq-split__visual">
    <img
      class="xyq-split__video"
      :src="currentHero"
      alt=""
      decoding="async"
    >
    <p class="xyq-split__caption">{{ t('EasyTV · 一镜成片') }}</p>
  </div>
</template>
