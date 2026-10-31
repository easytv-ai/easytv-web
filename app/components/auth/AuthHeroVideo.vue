<script setup lang="ts">
import { PLACEHOLDER_VIDEO_URL } from '~/utils/media'

const { t } = useI18n()
const heroIndex = ref(0)
let heroTimer: ReturnType<typeof setTimeout> | undefined

const slides = computed(() => [
  { title: t('青春纪实') },
  { title: t('星空山巅') },
  { title: t('礁岸纪实') },
  { title: t('林间飞瀑') },
  { title: t('音乐现场') },
  { title: t('航拍海浪') },
  { title: t('夜城未眠') },
  { title: t('赛博夜雨') },
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

function prevHeroClip() {
  stopHeroRotate()
  heroIndex.value = (heroIndex.value - 1 + slides.value.length) % slides.value.length
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
    <video
      class="xyq-split__video"
      :src="PLACEHOLDER_VIDEO_URL"
      muted
      loop
      autoplay
      playsinline
      preload="metadata"
    />
    <button
      type="button"
      class="xyq-split__arrow is-prev"
      :aria-label="t('上一张')"
      @click="prevHeroClip"
    >
      <UIcon name="i-lucide-chevron-left" class="size-5" />
    </button>
    <button
      type="button"
      class="xyq-split__arrow is-next"
      :aria-label="t('下一张')"
      @click="nextHeroClip"
    >
      <UIcon name="i-lucide-chevron-right" class="size-5" />
    </button>
    <div class="xyq-split__meta">
      <p class="xyq-split__caption">{{ current?.title }}</p>
      <div class="xyq-split__dots" role="tablist">
        <button
          v-for="(slide, index) in slides"
          :key="slide.title"
          type="button"
          :class="{ 'is-on': index === heroIndex }"
          :aria-label="slide.title"
          @click="go(index)"
        />
      </div>
    </div>
  </div>
</template>
