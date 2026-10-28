<script setup lang="ts">
const props = defineProps<{
  src: string
  mutedForced?: boolean
  crop?: { x: number, y: number, w: number, h: number } | null
  alwaysOn?: boolean
}>()

const emit = defineEmits<{
  meta: [size: { width: number, height: number }]
}>()

const cropStyle = computed(() => {
  const c = props.crop
  if (!c || c.w <= 0 || c.h <= 0)
    return undefined
  return {
    position: 'absolute' as const,
    width: `${100 / c.w}%`,
    height: `${100 / c.h}%`,
    left: `${-c.x / c.w * 100}%`,
    top: `${-c.y / c.h * 100}%`,
    maxWidth: 'none',
    objectFit: 'fill' as const,
  }
})

const { t } = useI18n()
const wrapRef = ref<HTMLElement | null>(null)
const videoRef = ref<HTMLVideoElement | null>(null)
const playing = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const muted = ref(Boolean(props.mutedForced))
const hovering = ref(false)
const previewOpen = ref(false)
const isFullscreen = ref(false)

const showChrome = computed(() => props.alwaysOn || hovering.value || isFullscreen.value)

watch(() => props.mutedForced, (on) => {
  if (on)
    muted.value = true
  const video = videoRef.value
  if (video)
    video.muted = muted.value
})

function formatTime(value: number) {
  const total = Math.max(0, Math.floor(value || 0))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function syncTime() {
  const video = videoRef.value
  if (!video)
    return
  currentTime.value = video.currentTime
  duration.value = Number.isFinite(video.duration) ? video.duration : 0
  if (!playing.value && video.currentTime === 0 && duration.value)
    video.currentTime = 0.04
}

function publishMeta() {
  syncTime()
  const video = videoRef.value
  const width = video?.videoWidth || 0
  const height = video?.videoHeight || 0
  if (width && height)
    emit('meta', { width, height })
}

async function togglePlay() {
  const video = videoRef.value
  if (!video)
    return
  if (video.paused) {
    video.muted = muted.value
    try {
      await video.play()
    }
    catch {
      video.muted = true
      muted.value = true
      await video.play().catch(() => {})
    }
    playing.value = !video.paused
    return
  }
  video.pause()
  playing.value = false
}

function toggleMute() {
  if (props.mutedForced)
    return
  const video = videoRef.value
  if (!video)
    return
  video.muted = !video.muted
  muted.value = video.muted
}

async function toggleFullscreen() {
  const el = wrapRef.value
  if (!el)
    return
  if (document.fullscreenElement === (el as unknown as Element)) {
    await document.exitFullscreen().catch(() => {})
    return
  }
  try {
    await (el as unknown as Element).requestFullscreen()
  }
  catch {
    previewOpen.value = true
  }
}

function onFsChange() {
  isFullscreen.value = document.fullscreenElement === (wrapRef.value as unknown as Element | null)
}

function onWrapClick() {
  if (props.alwaysOn)
    void togglePlay()
}

onMounted(() => {
  document.addEventListener('fullscreenchange', onFsChange)
  publishMeta()
})
onUnmounted(() => {
  document.removeEventListener('fullscreenchange', onFsChange)
  if (document.fullscreenElement === (wrapRef.value as unknown as Element | null))
    void document.exitFullscreen().catch(() => {})
})
</script>

<template>
  <div
    ref="wrapRef"
    class="cnode-player"
    :class="{ 'is-on': showChrome, 'is-playing': playing, nodrag: alwaysOn, nopan: alwaysOn, nowheel: alwaysOn }"
    @pointerenter="hovering = true"
    @pointerleave="hovering = false"
    @pointerdown="alwaysOn ? $event.stopPropagation() : undefined"
    @click="onWrapClick"
    @dblclick.stop
  >
    <video
      ref="videoRef"
      class="cnode-player__video"
      :class="{ 'is-crop': cropStyle }"
      :style="cropStyle"
      :src="src"
      :muted="muted"
      playsinline
      preload="metadata"
      @timeupdate="syncTime"
      @loadedmetadata="publishMeta"
      @loadeddata="publishMeta"
      @play="playing = true"
      @pause="playing = false"
      @ended="playing = false"
    />

    <button
      type="button"
      class="cnode-player__full nodrag nopan nowheel"
      :aria-label="isFullscreen ? t('退出全屏') : t('全屏')"
      @pointerdown.stop
      @pointerup.stop
      @click.stop="toggleFullscreen"
    >
      <UIcon :name="isFullscreen ? 'i-lucide-minimize-2' : 'i-lucide-maximize-2'" class="size-4" />
    </button>

    <div class="cnode-player__bar nodrag nopan nowheel" @pointerdown.stop @pointerup.stop @click.stop>
      <button type="button" :aria-label="playing ? t('暂停') : t('播放')" @click="togglePlay">
        <UIcon :name="playing ? 'i-lucide-pause' : 'i-lucide-play'" class="size-4" />
      </button>
      <span>{{ formatTime(currentTime) }} / {{ formatTime(duration) }}</span>
      <i />
      <button
        v-if="!mutedForced"
        type="button"
        :aria-label="muted ? t('取消静音') : t('静音')"
        @click="toggleMute"
      >
        <UIcon :name="muted ? 'i-lucide-volume-off' : 'i-lucide-volume-2'" class="size-4" />
      </button>
    </div>

    <CanvasMediaPreview
      :open="previewOpen"
      :src="src"
      kind="video"
      @close="previewOpen = false"
    />
  </div>
</template>
