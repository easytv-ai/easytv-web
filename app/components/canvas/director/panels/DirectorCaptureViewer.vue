<script setup lang="ts">
/**
 * 机位截图的大图查看器（复刻自 open-director 的 CameraPanel.tsx，MIT）。
 *
 * 滚轮缩放、放大后可拖动、Esc 关闭、点背景关闭，外加一个下载。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { DirectorCameraCapture } from '~/utils/director/schema'
import { startPointerDrag } from '~/utils/director/pointer-drag'

const props = defineProps<{ capture: DirectorCameraCapture }>()

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()

const ZOOM = { min: 0.25, max: 5, step: 0.25 } as const

const scale = ref(1)
const offset = ref({ x: 0, y: 0 })
const dragging = ref(false)

const transform = computed(() =>
  `translate(${offset.value.x}px, ${offset.value.y}px) scale(${scale.value})`,
)

function setScale(next: number) {
  // 先按两位小数收一下：0.25 连加会攒出浮点尾巴
  scale.value = Math.min(ZOOM.max, Math.max(ZOOM.min, Number(next.toFixed(2))))
}

// 缩回原始大小时把位移一起归零，不然图会卡在画面外
watch(scale, (value) => {
  if (value <= 1) {
    offset.value = { x: 0, y: 0 }
    dragging.value = false
  }
})

// 换一张图时重置视图状态，不然新图会继承上一张的缩放和位移
watch(() => props.capture.id, () => {
  scale.value = 1
  offset.value = { x: 0, y: 0 }
})

function onWheel(event: WheelEvent) {
  event.preventDefault()
  setScale(scale.value + (event.deltaY < 0 ? ZOOM.step : -ZOOM.step))
}

function onPointerDown(event: PointerEvent) {
  // 没放大就没有可拖的余量
  if (scale.value <= 1)
    return

  event.preventDefault()

  const startX = event.clientX
  const startY = event.clientY
  const origin = { ...offset.value }
  dragging.value = true

  startPointerDrag({
    target: event.currentTarget as HTMLImageElement,
    pointerId: event.pointerId,
    fallback: window,
    handlers: {
      onMove: (moveEvent) => {
        offset.value = {
          x: origin.x + moveEvent.clientX - startX,
          y: origin.y + moveEvent.clientY - startY,
        }
      },
      onEnd: () => {
        dragging.value = false
      },
    },
  })
}

function download() {
  const link = document.createElement('a')
  link.href = props.capture.dataUrl
  link.download = `${props.capture.name}.png`
  link.click()
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape')
    emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeyDown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown))
</script>

<template>
  <div class="director-viewer" role="dialog" :aria-label="t('截图查看器')" @click="emit('close')">
    <!-- 工具栏在遮罩里面，点它不应该关掉查看器 -->
    <div class="director-viewer__tools" role="toolbar" :aria-label="t('截图查看器')" @click.stop>
      <button type="button" :aria-label="t('放大')" @click="setScale(scale + ZOOM.step)">
        <UIcon name="i-lucide-zoom-in" class="size-4" />
      </button>
      <button type="button" :aria-label="t('缩小')" @click="setScale(scale - ZOOM.step)">
        <UIcon name="i-lucide-zoom-out" class="size-4" />
      </button>
      <button type="button" :aria-label="t('下载')" @click="download()">
        <UIcon name="i-lucide-download" class="size-4" />
      </button>
      <button type="button" :aria-label="t('关闭')" @click="emit('close')">
        <UIcon name="i-lucide-x" class="size-4" />
      </button>
    </div>

    <div class="director-viewer__stage">
      <img
        class="director-viewer__image"
        :class="{ 'is-zoomed': scale > 1, 'is-dragging': dragging }"
        :src="capture.dataUrl"
        :alt="capture.name"
        :style="{ transform }"
        draggable="false"
        @click.stop
        @wheel.prevent="onWheel"
        @pointerdown="onPointerDown"
      >
    </div>
  </div>
</template>
