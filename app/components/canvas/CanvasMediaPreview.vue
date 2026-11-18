<script lang="ts">
let behindLocks = 0
</script>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  open: boolean
  src: string
  kind?: 'video' | 'image' | 'audio'
  caption?: string
}>(), {
  kind: 'video',
  caption: '',
})

const emit = defineEmits<{
  close: []
}>()

const { t } = useI18n()
const videoRef = ref<HTMLVideoElement | null>(null)
const audioRef = ref<HTMLAudioElement | null>(null)

watch(() => props.open, async (on) => {
  if (!on) {
    videoRef.value?.pause()
    audioRef.value?.pause()
    return
  }
  await nextTick()
  if (props.kind === 'video')
    void videoRef.value?.play().catch(() => {})
  if (props.kind === 'audio')
    void audioRef.value?.play().catch(() => {})
})

/** 大图打开时键盘归弹层：Esc 关闭，其余按键不再传给画布（否则 Delete / ⌘Z 会删掉或撤销背后的节点） */
function onKeydown(event: KeyboardEvent) {
  event.stopPropagation()
  if (event.key === 'Escape')
    emit('close')
}

/** 说明文字自己还能滚时放行，其余滚轮不传给背后的资产列表 */
function onWheel(event: WheelEvent) {
  const node = event.target instanceof Element ? event.target : null
  const caption = node?.closest('.canvas-media-mask__caption')
  if (caption instanceof HTMLElement) {
    const max = caption.scrollHeight - caption.clientHeight
    const next = caption.scrollTop + event.deltaY
    if (max > 1 && next > 0 && next < max)
      return
  }
  event.preventDefault()
}

function setBehindScroll(lock: boolean) {
  behindLocks += lock ? 1 : -1
  if (behindLocks < 0)
    behindLocks = 0
  document.querySelector('.studio-content')?.classList.toggle('is-scroll-locked', behindLocks > 0)
}

let guardsOn = false

function bindPreviewGuards(on: boolean) {
  if (!import.meta.client || on === guardsOn)
    return
  guardsOn = on
  if (on) {
    window.addEventListener('keydown', onKeydown, true)
    window.addEventListener('wheel', onWheel, { capture: true, passive: false })
    setBehindScroll(true)
    return
  }
  window.removeEventListener('keydown', onKeydown, true)
  window.removeEventListener('wheel', onWheel, { capture: true })
  setBehindScroll(false)
}

// 每个媒体节点都挂一个预览组件，只在打开期间监听，避免节点多时 window 上挂 N 个监听
watch(() => props.open, bindPreviewGuards, { immediate: true })
onUnmounted(() => bindPreviewGuards(false))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && src"
      class="studio-modal-mask canvas-media-mask"
      role="dialog"
      aria-modal="true"
      :aria-label="kind === 'video' ? t('放大播放') : kind === 'audio' ? t('播放音频') : t('放大查看')"
      @click.self="emit('close')"
      @pointerdown.stop
    >
      <button
        type="button"
        class="canvas-media-mask__close"
        :aria-label="t('关闭')"
        @click="emit('close')"
      >
        <UIcon name="i-lucide-x" class="size-5" />
      </button>
      <div class="canvas-media-mask__stage" :class="{ 'has-caption': Boolean(caption) }" @click.stop>
        <video
          v-if="kind === 'video'"
          ref="videoRef"
          :src="src"
          controls
          autoplay
          playsinline
        />
        <audio
          v-else-if="kind === 'audio'"
          ref="audioRef"
          :src="src"
          controls
          autoplay
        />
        <img v-else :src="src" alt="">
        <p v-if="caption" class="canvas-media-mask__caption">{{ caption }}</p>
      </div>
    </div>
  </Teleport>
</template>
