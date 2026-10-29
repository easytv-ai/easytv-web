<script setup lang="ts">
const { t } = useI18n()
const heroIndex = ref(0)
let heroTimer: ReturnType<typeof setTimeout> | undefined

const slides = computed(() => [
  { src: '/gifs/login-hero.webp', title: t('青春纪实') },
  { src: '/gifs/showcase/scenic.webp', title: t('星空山巅') },
  { src: '/gifs/showcase/coast.webp', title: t('礁岸纪实') },
  { src: '/gifs/showcase/waterfall.webp', title: t('林间飞瀑') },
  { src: '/gifs/showcase/music.webp', title: t('音乐现场') },
  { src: '/gifs/showcase/ocean.webp', title: t('航拍海浪') },
  { src: '/gifs/showcase/city-night.webp', title: t('夜城未眠') },
  { src: '/gifs/showcase/neon-rain.webp', title: t('赛博夜雨') },
])

const current = computed(() => slides.value[heroIndex.value] ?? slides.value[0])

function stopHeroRotate() {
  if (heroTimer) {
    clearTimeout(heroTimer)
    heroTimer = undefined
  }
}

function go(index: number) {
  heroIndex.value = index
}

function nextHeroClip() {
  stopHeroRotate()
  heroIndex.value = (heroIndex.value + 1) % slides.value.length
}

function startHeroRotate() {
  stopHeroRotate()
  heroTimer = setTimeout(nextHeroClip, 5000)
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
      :src="current?.src"
      alt=""
      decoding="async"
    >
    <div class="xyq-split__meta">
      <p class="xyq-split__caption">{{ current?.title }}</p>
      <div class="xyq-split__dots" role="tablist">
        <button
          v-for="(slide, index) in slides"
          :key="slide.src"
          type="button"
          :class="{ 'is-on': index === heroIndex }"
          :aria-label="slide.title"
          @click="go(index)"
        />
      </div>
    </div>
  </div>
</template>
