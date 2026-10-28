<script setup lang="ts">
import contentApi from '~/api/content'
import workApi from '~/api/work'
import { resolveMediaUrl } from '~/utils/media'

const { t } = useI18n()

const localePath = useLocalePath()

type HeroItem = {
  key: string
  title: string
  tag: string
  subtitle: string
  cta: string
  cover: string
  src: string
  /** 站内路径或外链，交给 NuxtLink 处理 */
  to: string
}

/** 优先运营配置的 Banner（GET /banner），没有时回退到点赞最高的 5 部已发布作品 */
const featured = ref<HeroItem[]>([])

function applyFeatured(items: HeroItem[]) {
  if (!items.length)
    return
  featured.value = items
  index.value = 0
  playCurrentVideo()
}

async function loadFeatured() {
  try {
    const res = await contentApi.banners()
    if (res?.success && res.data?.length) {
      applyFeatured(res.data.map(b => ({
        key: `banner-${b.id}`,
        title: b.title,
        tag: b.tag,
        subtitle: b.subtitle,
        cta: b.cta || t('立即观看'),
        cover: resolveMediaUrl(b.cover_url),
        src: resolveMediaUrl(b.video_url),
        to: b.link_url && !/^https?:\/\//i.test(b.link_url) ? localePath(b.link_url) : (b.link_url || localePath('/studio')),
      })))
      return
    }
  }
  catch {
    // Banner 失败时继续用作品兜底，不清掉已经在播的内容
  }
  try {
    const feed = await workApi.feed({ page: 1, page_size: 30 })
    if (feed?.success && feed.data) {
      applyFeatured([...feed.data.items]
        .sort((a, b) => b.like_count - a.like_count)
        .slice(0, 5)
        .map(w => ({
          key: `work-${w.id}`,
          title: t('概念短片《{title}》', { title: w.title }),
          tag: w.category,
          subtitle: `${w.author?.nickname || t('创作者')} · ${w.like_count} ${t('喜欢')}`,
          cta: t('立即观看'),
          cover: resolveMediaUrl(w.cover_url),
          src: resolveMediaUrl(w.video_url),
          to: localePath(`/watch/${w.id}`),
        })))
    }
  }
  catch {
    // 保留已有精选
  }
}

const index = ref(0)
const hovering = ref(false)
const videoRef = ref<HTMLVideoElement | null>(null)
let rotateTimer: ReturnType<typeof setInterval> | undefined

const current = computed(() => featured.value[index.value] ?? featured.value[0])
const total = computed(() => featured.value.length)

function playCurrentVideo() {
  nextTick(() => {
    const video = videoRef.value
    if (!video)
      return
    video.muted = true
    video.playsInline = true
    void video.play().catch(() => {})
  })
}

function goTo(next: number) {
  if (!total.value)
    return
  index.value = (next + total.value) % total.value
}

function prev() {
  goTo(index.value - 1)
  restartRotate()
}

function next() {
  goTo(index.value + 1)
  restartRotate()
}

function select(nextIndex: number) {
  goTo(nextIndex)
  restartRotate()
}

function prefersReducedMotion() {
  return import.meta.client
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function startRotate() {
  stopRotate()
  if (total.value < 2 || prefersReducedMotion())
    return
  rotateTimer = setInterval(() => {
    index.value = (index.value + 1) % total.value
  }, 6500)
}

function stopRotate() {
  if (rotateTimer) {
    clearInterval(rotateTimer)
    rotateTimer = undefined
  }
}

function restartRotate() {
  if (hovering.value)
    return
  startRotate()
}

watch(index, playCurrentVideo)

watch(hovering, (hover) => {
  if (hover)
    stopRotate()
  else
    startRotate()
})

watch(() => featured.value.length, () => startRotate())

onMounted(() => {
  void loadFeatured()
})

onUnmounted(() => {
  stopRotate()
})
</script>

<template>
  <section
    class="show-hero"
    aria-roledescription="carousel"
    :aria-label="t('精选成片推荐')"
    @mouseenter="hovering = true"
    @mouseleave="hovering = false"
  >
    <NuxtLink
      v-if="current"
      :to="current.to"
      class="show-hero__hit"
    >
      <div
        class="show-hero__track"
        :style="{ backgroundImage: `url(${current.cover})` }"
      >
        <img
          v-for="(item, i) in featured"
          :key="item.key"
          :src="item.cover"
          :alt="item.title"
          :class="{ 'is-on': i === index }"
        >
        <video
          v-if="current.src"
          :key="current.key"
          ref="videoRef"
          :src="current.src"
          :poster="current.cover"
          muted
          loop
          playsinline
          preload="metadata"
        />
      </div>
      <div class="show-hero__shade" />
      <div class="show-hero__copy">
        <span v-if="current.tag" class="show-hero__tag">{{ current.tag }}</span>
        <h2>{{ current.title }}</h2>
        <p v-if="current.subtitle">{{ current.subtitle }}</p>
        <span class="show-hero__cta">
          {{ current.cta }}
          <UIcon name="i-lucide-arrow-right" class="size-4" />
        </span>
      </div>
    </NuxtLink>

    <NuxtLink :to="localePath('/create')" class="show-hero__create" @click.stop>
      <UIcon name="i-lucide-wand-sparkles" class="size-4" />
      {{ t('一句话成片') }}
    </NuxtLink>

    <button
      v-if="total > 1"
      type="button"
      class="show-hero__arrow is-prev"
      :aria-label="t('上一张')"
      @click.stop="prev"
    >
      <UIcon name="i-lucide-chevron-left" class="size-5" />
    </button>
    <button
      v-if="total > 1"
      type="button"
      class="show-hero__arrow is-next"
      :aria-label="t('下一张')"
      @click.stop="next"
    >
      <UIcon name="i-lucide-chevron-right" class="size-5" />
    </button>

    <div v-if="total > 1" class="show-hero__dots">
      <button
        v-for="(item, i) in featured"
        :key="item.key"
        type="button"
        :class="{ 'is-on': i === index }"
        :aria-label="`${t('查看')} ${item.title}`"
        :aria-current="i === index ? 'true' : undefined"
        @click.stop="select(i)"
      />
    </div>
  </section>
</template>
