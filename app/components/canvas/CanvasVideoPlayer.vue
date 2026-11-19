<script setup lang="ts">
import { ossVideoSnapshotUrl } from '~/utils/canvas-video-frame'
import { enqueuePosterLoad, enqueueVideoProbe } from '~/utils/canvas-video-probe'

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
const posterRef = ref<HTMLImageElement | null>(null)
const hydrated = ref(Boolean(props.alwaysOn))
const poster = computed(() => ossVideoSnapshotUrl(props.src, 0.04, 400))
/** 封面要排队，避免一屏视频同时向存储要截帧 */
const posterShown = ref(false)
let stopPoster: (() => void) | null = null
let finishPoster: (() => void) | null = null
let posterTimer = 0
let sizeProbe: HTMLVideoElement | null = null
let sized = false
let disposed = false
let cancelProbe: (() => void) | null = null
let visibilityObserver: IntersectionObserver | null = null
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

function onTimeUpdate() {
  if (!playing.value && !hovering.value && !props.alwaysOn)
    return
  syncTime()
}

function publishMeta() {
  syncTime()
  const video = videoRef.value
  const width = video?.videoWidth || 0
  const height = video?.videoHeight || 0
  if (width && height)
    emit('meta', { width, height })
}

function publishSize(width: number, height: number) {
  if (width > 0 && height > 0) {
    sized = true
    emit('meta', { width, height })
  }
}

function releasePosterSlot() {
  if (posterTimer) {
    window.clearTimeout(posterTimer)
    posterTimer = 0
  }
  finishPoster?.()
  finishPoster = null
}

/** 同时只让几张封面去截帧。单张超过 8 秒也放行下一张，免得一条卡住整队。 */
function armPoster() {
  stopPoster?.()
  stopPoster = null
  releasePosterSlot()
  posterShown.value = false
  if (disposed || hydrated.value || !poster.value)
    return
  stopPoster = enqueuePosterLoad((done) => {
    if (disposed || hydrated.value || !poster.value) {
      done()
      return
    }
    finishPoster = done
    posterShown.value = true
    posterTimer = window.setTimeout(releasePosterSlot, 8000)
  })
}

function onPosterLoad(event: Event) {
  releasePosterSlot()
  const img = event.target as HTMLImageElement
  publishSize(img.naturalWidth, img.naturalHeight)
}

function onPosterError() {
  releasePosterSlot()
  watchForProbe()
}

function emitPosterSize() {
  const img = posterRef.value
  if (img?.complete)
    publishSize(img.naturalWidth, img.naturalHeight)
}

function disposeSizeProbe() {
  if (!sizeProbe)
    return
  sizeProbe.removeAttribute('src')
  sizeProbe.load()
  sizeProbe = null
}

function probeVideoSize() {
  if (disposed || hydrated.value || sizeProbe || sized || cancelProbe)
    return
  cancelProbe = enqueueVideoProbe((done) => {
    if (disposed || hydrated.value || sized) {
      done()
      return
    }
    const probe = document.createElement('video')
    probe.preload = 'metadata'
    probe.muted = true
    probe.playsInline = true
    probe.src = props.src
    sizeProbe = probe
    const finish = () => {
      publishSize(probe.videoWidth, probe.videoHeight)
      disposeSizeProbe()
      done()
    }
    probe.addEventListener('loadedmetadata', finish, { once: true })
    probe.addEventListener('error', finish, { once: true })
  })
}

function stopVisibilityWatch() {
  visibilityObserver?.disconnect()
  visibilityObserver = null
}

/** 只有靠近视口才读视频尺寸。封面能定尺寸时不再另开一个 video。 */
function watchForProbe() {
  if (disposed || sized || hydrated.value)
    return
  const el = wrapRef.value
  if (!el || typeof IntersectionObserver === 'undefined') {
    probeVideoSize()
    return
  }
  stopVisibilityWatch()
  visibilityObserver = new IntersectionObserver((entries) => {
    if (!entries.some(entry => entry.isIntersecting))
      return
    stopVisibilityWatch()
    probeVideoSize()
  }, { rootMargin: '320px' })
  visibilityObserver.observe(el)
}

function hydratePlayer() {
  hydrated.value = true
  disposeSizeProbe()
}

async function togglePlay() {
  if (!hydrated.value) {
    hydratePlayer()
    await nextTick()
  }
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

watch(poster, () => armPoster())

onMounted(() => {
  document.addEventListener('fullscreenchange', onFsChange)
  publishMeta()
  nextTick(emitPosterSize)
  armPoster()
  if (!poster.value)
    watchForProbe()
})
onUnmounted(() => {
  disposed = true
  document.removeEventListener('fullscreenchange', onFsChange)
  stopVisibilityWatch()
  stopPoster?.()
  stopPoster = null
  releasePosterSlot()
  cancelProbe?.()
  cancelProbe = null
  disposeSizeProbe()
  if (document.fullscreenElement === (wrapRef.value as unknown as Element | null))
    void document.exitFullscreen().catch(() => {})
})
</script>

<template>
  <div
    ref="wrapRef"
    class="cnode-player"
    :class="{ 'is-on': showChrome, 'is-playing': playing, nodrag: alwaysOn, nopan: alwaysOn, nowheel: alwaysOn }"
    @pointerenter="hovering = true; hydratePlayer()"
    @pointerleave="hovering = false"
    @pointerdown="alwaysOn ? $event.stopPropagation() : undefined"
    @click="onWrapClick"
    @dblclick.stop
  >
    <img
      v-if="!hydrated && poster && posterShown"
      ref="posterRef"
      class="cnode-player__video"
      :src="poster"
      alt=""
      draggable="false"
      loading="lazy"
      decoding="async"
      @load="onPosterLoad"
      @error="onPosterError"
    >
    <video
      v-if="hydrated"
      ref="videoRef"
      class="cnode-player__video"
      :class="{ 'is-crop': cropStyle }"
      :style="cropStyle"
      :src="src"
      :muted="muted"
      playsinline
      preload="metadata"
      @timeupdate="onTimeUpdate"
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
