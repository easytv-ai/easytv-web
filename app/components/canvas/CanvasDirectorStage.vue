<script setup lang="ts">
/**
 * 3D 导演台整页外壳。
 *
 * 布局跟参考台一样：左右通栏，中间视口，时间轴只躺在视口底下。
 * 返回和送截图挂在两侧顶上，不再单独占一条白顶栏。
 */
import { ref, shallowRef } from 'vue'
import CanvasDirectorSession from '~/components/canvas/CanvasDirectorSession.vue'
import type { DirectorProject } from '~/utils/director/schema'

defineProps<{
  nodeId: string
  scene?: DirectorProject | null
  panorama?: { url: string, name: string, edgeId: string, sourceNodeId: string } | null
  look?: { url: string, name: string } | null
  readonly?: boolean
}>()

const emit = defineEmits<{
  close: []
  'scene-change': [payload: { nodeId: string, scene: DirectorProject }]
  captures: [items: { dataUrl: string, fileName: string }[]]
  'export-video': [payload: { blob: Blob, fileName: string, duration?: number }]
  'export-preview': [payload: {
    frames: { dataUrl: string, fileName: string, shotIndex: number, time: number, label: string }[]
    prompts: string[]
    output: 'color' | 'depth' | 'matte'
    generate?: boolean
  }]
  'panorama-removed': [payload: { edgeId: string, sourceNodeId: string }]
}>()

const { t } = useI18n()

const pageRoot = ref<HTMLElement | null>(null)
useVisualViewportFit(pageRoot)

const leftOpen = ref(false)
const rightOpen = ref(false)

function toggleLeft() {
  leftOpen.value = !leftOpen.value
  if (leftOpen.value)
    rightOpen.value = false
}

function toggleRight() {
  rightOpen.value = !rightOpen.value
  if (rightOpen.value)
    leftOpen.value = false
}

const captureCount = ref(0)
const oversize = ref(false)
const sessionRef = shallowRef<InstanceType<typeof CanvasDirectorSession> | null>(null)

function onKey(event: KeyboardEvent) {
  if (event.key !== 'Escape')
    return
  const el = event.target as HTMLElement | null
  if (el?.closest('input, textarea, select, [contenteditable="true"]'))
    return
  // 下拉 / 比例选择 / AI 助手 / 截图查看器开着时，Esc 先关它们，不直接离开导演台
  if (document.querySelector('.director-page [aria-expanded="true"], .director-agent__panel, .director-viewer'))
    return
  event.stopPropagation()
  emit('close')
}

onMounted(() => window.addEventListener('keydown', onKey, true))
onUnmounted(() => window.removeEventListener('keydown', onKey, true))

function captureCardPreview() {
  return sessionRef.value?.captureCardPreview() ?? Promise.resolve('')
}

defineExpose({ captureCardPreview })
</script>

<template>
  <div ref="pageRoot" class="director-page">
    <div class="director-mobile-bar">
      <button type="button" class="director-shell__icon" :aria-label="t('返回画布')" @click="emit('close')">
        <UIcon name="i-lucide-arrow-left" class="size-4" />
      </button>
      <button type="button" class="director-mobile-bar__tab" :class="{ 'is-on': leftOpen }" @click="toggleLeft">
        {{ t('场景') }}
      </button>
      <button type="button" class="director-mobile-bar__tab" :class="{ 'is-on': rightOpen }" @click="toggleRight">
        {{ t('属性') }}
      </button>
      <button
        v-if="!readonly"
        type="button"
        class="director-shell__text-btn"
        :disabled="!captureCount"
        @click="sessionRef?.sendCaptures()"
      >
        <UIcon name="i-lucide-send" class="size-3.5" />
        <span>{{ t('截图送回画布') }}</span>
      </button>
    </div>
    <CanvasDirectorSession
      ref="sessionRef"
      :key="nodeId"
      :node-id="nodeId"
      :scene="scene"
      :panorama="panorama"
      :look="look"
      :readonly="readonly"
      :left-open="leftOpen"
      :right-open="rightOpen"
      @close-drawers="leftOpen = false; rightOpen = false"
      @scene-change="emit('scene-change', $event)"
      @captures="emit('captures', $event)"
      @export-video="emit('export-video', $event)"
      @export-preview="emit('export-preview', $event)"
      @panorama-removed="emit('panorama-removed', $event)"
      @capture-count="captureCount = $event"
      @oversize="oversize = $event"
    >
      <template #brand>
        <button type="button" class="director-shell__icon" :aria-label="t('返回画布')" @click="emit('close')">
          <UIcon name="i-lucide-arrow-left" class="size-4" />
          <span class="canvas-tip canvas-tip--down">{{ t('返回画布') }}</span>
        </button>
        <h1>{{ t('3D 导演台') }}</h1>
      </template>
      <template #aside>
        <span v-if="readonly" class="director-shell__warn">{{ t('只读：队友的画布，修改不会保存') }}</span>
        <span v-if="oversize" class="director-shell__warn">{{ t('场景内容过多，可能保存失败') }}</span>
        <button
          v-if="!readonly"
          type="button"
          class="director-shell__text-btn"
          :disabled="!captureCount"
          @click="sessionRef?.sendCaptures()"
        >
          <UIcon name="i-lucide-send" class="size-3.5" />
          <span>{{ t('截图送回画布') }}</span>
        </button>
        <button type="button" class="director-shell__icon" :aria-label="t('返回画布')" @click="emit('close')">
          <UIcon name="i-lucide-x" class="size-4" />
          <span class="canvas-tip canvas-tip--end">{{ t('返回画布') }}</span>
        </button>
      </template>
    </CanvasDirectorSession>
  </div>
</template>
