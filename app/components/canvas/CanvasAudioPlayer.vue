<script setup lang="ts">
const props = defineProps<{
  src: string
}>()

const { t } = useI18n()
const audioRef = ref<HTMLAudioElement | null>(null)
const waveRef = ref<HTMLElement | null>(null)
const playing = ref(false)
const muted = ref(false)
const seeking = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const bars = ref<number[]>([])

const progress = computed(() => {
  if (!duration.value)
    return 0
  return Math.min(1, Math.max(0, currentTime.value / duration.value))
})

function formatTime(value: number) {
  const total = Math.max(0, Math.floor(value || 0))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function syncTime() {
  const audio = audioRef.value
  if (!audio || seeking.value)
    return
  currentTime.value = audio.currentTime
  duration.value = Number.isFinite(audio.duration) ? audio.duration : 0
}

function seekByClientX(clientX: number) {
  const audio = audioRef.value
  const wave = waveRef.value
  if (!audio || !wave)
    return
  const dur = Number.isFinite(audio.duration) ? audio.duration : duration.value
  if (!dur)
    return
  const rect = wave.getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)))
  const next = ratio * dur
  audio.currentTime = next
  currentTime.value = next
  duration.value = dur
}

function onSeekPointerDown(event: PointerEvent) {
  if (event.button !== 0)
    return
  event.preventDefault()
  event.stopPropagation()
  seeking.value = true
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture?.(event.pointerId)
  seekByClientX(event.clientX)
}

function onSeekPointerMove(event: PointerEvent) {
  if (!seeking.value)
    return
  event.preventDefault()
  event.stopPropagation()
  seekByClientX(event.clientX)
}

function onSeekPointerUp(event: PointerEvent) {
  if (!seeking.value)
    return
  event.preventDefault()
  event.stopPropagation()
  seeking.value = false
  const target = event.currentTarget as HTMLElement
  if (target.hasPointerCapture?.(event.pointerId))
    target.releasePointerCapture(event.pointerId)
}

function seedBars(count = 64) {
  const next: number[] = []
  let seed = 0
  for (let i = 0; i < props.src.length; i++)
    seed = (seed * 31 + props.src.charCodeAt(i)) >>> 0
  for (let i = 0; i < count; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    const envelope = 0.4 + 0.6 * Math.sin((i / count) * Math.PI)
    const wave = 0.2 + 0.55 * Math.abs(Math.sin(i * 0.38 + (seed % 97) / 18))
    const noise = ((seed % 1000) / 1000) * 0.25
    next.push(Math.min(1, Math.max(0.12, (wave + noise) * envelope)))
  }
  bars.value = next
}

async function togglePlay() {
  const audio = audioRef.value
  if (!audio)
    return
  if (audio.paused) {
    audio.muted = muted.value
    try {
      await audio.play()
    }
    catch {
      // 自动播放失败时忽略
    }
    playing.value = !audio.paused
    return
  }
  audio.pause()
  playing.value = false
}

function toggleMute() {
  const audio = audioRef.value
  muted.value = !muted.value
  if (audio)
    audio.muted = muted.value
}

function onWaveClick(event: MouseEvent) {
  if (seeking.value)
    return
  const el = event.target as HTMLElement
  if (el.closest('.cnode-audio__playhead, .cnode-audio__mute'))
    return
  event.stopPropagation()
  void togglePlay()
}

watch(() => props.src, () => {
  seedBars()
  playing.value = false
  muted.value = false
  currentTime.value = 0
  duration.value = 0
}, { immediate: true })

onUnmounted(() => {
  const audio = audioRef.value
  if (audio) {
    audio.pause()
    audio.src = ''
  }
})
</script>

<template>
  <div class="cnode-audio" :class="{ 'is-playing': playing }" @dblclick.stop>
    <audio
      ref="audioRef"
      :src="src"
      :muted="muted"
      preload="metadata"
      @timeupdate="syncTime"
      @loadedmetadata="syncTime"
      @play="playing = true"
      @pause="playing = false"
      @ended="playing = false"
    />
    <div ref="waveRef" class="cnode-audio__wave" @click="onWaveClick">
      <i
        v-for="(h, i) in bars"
        :key="i"
        :class="{ 'is-on': (i + 0.5) / bars.length <= progress }"
        :style="{ '--h': `${Math.round(h * 100)}%` }"
      />
      <button
        type="button"
        class="cnode-audio__playhead nodrag nopan nowheel"
        :class="{ 'is-seeking': seeking }"
        :style="{ left: `${progress * 100}%` }"
        :aria-label="t('音频进度')"
        :aria-valuemin="0"
        :aria-valuemax="Math.max(0, Math.round(duration))"
        :aria-valuenow="Math.round(currentTime)"
        role="slider"
        @pointerdown="onSeekPointerDown"
        @pointermove="onSeekPointerMove"
        @pointerup="onSeekPointerUp"
        @pointercancel="onSeekPointerUp"
        @lostpointercapture="seeking = false"
      />
      <button
        type="button"
        class="cnode-audio__mute nodrag nopan nowheel"
        :aria-label="muted ? t('取消静音') : t('静音')"
        @pointerdown.stop
        @click.stop="toggleMute"
      >
        <UIcon :name="muted ? 'i-lucide-volume-off' : 'i-lucide-volume-2'" class="size-3.5" />
      </button>
    </div>
    <div class="cnode-audio__meta">
      <span class="cnode-audio__time">{{ formatTime(currentTime) }} / {{ formatTime(duration) }}</span>
      <button
        type="button"
        class="cnode-audio__play nodrag nopan nowheel"
        :aria-label="playing ? t('暂停') : t('播放')"
        @pointerdown.stop
        @click.stop="togglePlay"
      >
        <UIcon :name="playing ? 'i-lucide-pause' : 'i-lucide-play'" class="size-3.5" />
      </button>
    </div>
  </div>
</template>
