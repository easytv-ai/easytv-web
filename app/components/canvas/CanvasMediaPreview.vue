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

// 每个媒体节点都挂一个预览组件，只在打开期间监听，避免节点多时 window 上挂 N 个监听
watch(() => props.open, (on) => {
  if (!import.meta.client)
    return
  if (on)
    window.addEventListener('keydown', onKeydown, true)
  else
    window.removeEventListener('keydown', onKeydown, true)
}, { immediate: true })
onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))
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
