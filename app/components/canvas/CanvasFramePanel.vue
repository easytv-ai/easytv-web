<script setup lang="ts">
import { resolveMediaUrl } from '~/utils/media'
import { FRAME_PULL_COUNT_ITEMS, FRAME_PULL_DEFAULT_PARAMS, type CanvasNodeData } from '~/utils/canvas-node-kinds'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  src: string
  params?: CanvasNodeData['frameParams'] | null
  submitting?: boolean
}>(), {
  params: null,
  submitting: false,
})

const emit = defineEmits<{
  'update:params': [value: NonNullable<CanvasNodeData['frameParams']>]
  /** 提交媒体作业 storyboard：params={count, analyze} */
  submit: [payload: { count: number, analyze: boolean }]
}>()

const duration = ref(0)
const width = ref(0)
const height = ref(0)
const poster = ref('')

const mediaSrc = computed(() => resolveMediaUrl(props.src))
const count = computed(() => {
  const value = Number(props.params?.count)
  return (FRAME_PULL_COUNT_ITEMS as readonly number[]).includes(value) ? value : FRAME_PULL_DEFAULT_PARAMS.count
})
const analyze = computed(() => props.params?.analyze ?? FRAME_PULL_DEFAULT_PARAMS.analyze)
const metaLabel = computed(() => {
  const parts: string[] = []
  if (duration.value > 0) {
    const total = Math.max(0, Math.floor(duration.value))
    parts.push(`${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`)
  }
  if (width.value > 0 && height.value > 0)
    parts.push(`${width.value}×${height.value}`)
  return parts.join(' · ')
})

function patch(partial: Partial<NonNullable<CanvasNodeData['frameParams']>>) {
  const base = props.params || {
    sourceId: '',
    sourceLabel: '',
    ...FRAME_PULL_DEFAULT_PARAMS,
  }
  emit('update:params', { ...base, ...partial })
}

async function probe(src: string) {
  duration.value = 0
  width.value = 0
  height.value = 0
  poster.value = ''
  if (!src)
    return
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.crossOrigin = 'anonymous'
  video.src = src
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error('load'))
    })
    duration.value = Number.isFinite(video.duration) ? video.duration : 0
    width.value = video.videoWidth || 0
    height.value = video.videoHeight || 0
    if (duration.value > 0)
      video.currentTime = Math.min(0.2, duration.value * 0.1)
    await new Promise<void>((resolve) => {
      let settled = false
      const done = () => {
        if (settled)
          return
        settled = true
        video.removeEventListener('seeked', done)
        resolve()
      }
      video.addEventListener('seeked', done)
      window.setTimeout(done, 400)
    })
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 320
    canvas.height = video.videoHeight || 180
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      try {
        poster.value = canvas.toDataURL('image/jpeg', 0.72)
      }
      catch {
        poster.value = ''
      }
    }
  }
  catch {
    // 跨域失败时只展示空态
  }
  finally {
    video.src = ''
  }
}

watch(() => mediaSrc.value, (src) => {
  void probe(src)
}, { immediate: true })

function onSubmit() {
  if (props.submitting)
    return
  emit('submit', { count: count.value, analyze: analyze.value })
}
</script>

<template>
  <div class="cnode-frame" @dblclick.stop>
    <header class="cnode-frame__head">
      <span class="cnode-frame__title">
        <UIcon name="i-lucide-gem" class="size-3.5" />
        <strong>{{ t('逐帧拉片') }}</strong>
        <em>{{ t('{n} 帧', { n: count }) }}</em>
      </span>
    </header>

    <section class="cnode-frame__media">
      <div class="cnode-frame__meta">
        <b>{{ t('视频素材') }}</b>
        <small>{{ metaLabel || t('读取中…') }}</small>
      </div>
      <div class="cnode-frame__thumb">
        <img v-if="poster || mediaSrc" :src="poster || mediaSrc" alt="">
        <span v-else>{{ t('暂无预览') }}</span>
      </div>
    </section>

    <section class="cnode-frame__dims">
      <p>{{ t('抽帧数量') }}</p>
      <div class="cnode-frame__picks">
        <button
          v-for="item in FRAME_PULL_COUNT_ITEMS"
          :key="item"
          type="button"
          class="nodrag nopan nowheel"
          :class="{ 'is-on': count === item }"
          @pointerdown.stop
          @click="patch({ count: item })"
        >
          {{ item }}
        </button>
      </div>
    </section>

    <section class="cnode-frame__dims">
      <p>{{ t('生成解读') }}</p>
      <div class="cnode-frame__picks">
        <button
          type="button"
          class="nodrag nopan nowheel"
          :class="{ 'is-on': analyze }"
          :title="t('抽帧后用文本视觉模型逐帧解读画面，结果放进一个文本节点')"
          @pointerdown.stop
          @click="patch({ analyze: !analyze })"
        >
          <UIcon :name="analyze ? 'i-lucide-toggle-right' : 'i-lucide-toggle-left'" class="size-3.5" />
          {{ analyze ? t('开启') : t('关闭') }}
        </button>
      </div>
    </section>

    <button
      type="button"
      class="cnode-frame__go nodrag nopan nowheel"
      :disabled="submitting"
      @pointerdown.stop
      @click="onSubmit"
    >
      {{ submitting ? t('拉片中…') : t('开始拉片') }}
    </button>
  </div>
</template>
