<script setup lang="ts">
import {
  cellPixelSize,
  GRID_SPLIT_MAX,
  GRID_SPLIT_PRESETS,
  gridCellCount,
  gridCells,
  gridSplitTooMany,
  makeGridLines,
  moveGridLine,
  type GridCell,
  type GridLines,
} from '~/utils/canvas-grid-split'

/**
 * 宫格切分（L4）：盖在图片节点上的一层，拖分割线定每一片的边界。
 * 确认后把切片的归一化 rect 交给工作区，由它逐片提交 crop 作业（本地 ffmpeg，免费）。
 */
const props = withDefaults(defineProps<{
  open: boolean
  /** 节点在屏幕上的矩形，这一层正好盖在上面 */
  box?: { left: number, top: number, width: number, height: number } | null
  /** 源图原始像素，用来显示每片实际多大 */
  naturalW?: number
  naturalH?: number
}>(), {
  box: null,
  naturalW: 0,
  naturalH: 0,
})

const emit = defineEmits<{
  close: []
  confirm: [cells: GridCell[]]
}>()

const { t } = useI18n()

const lines = ref<GridLines>(makeGridLines(3, 3))
const presetId = ref<string>('3x3')
const stageRef = ref<HTMLElement | null>(null)
let drag: { axis: 'cols' | 'rows', index: number } | null = null

const layerStyle = computed(() => {
  const box = props.box
  return box
    ? { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` }
    : null
})

const cells = computed(() => gridCells(lines.value))
const count = computed(() => gridCellCount(lines.value))
const tooMany = computed(() => gridSplitTooMany(lines.value))

/** 第一片的像素尺寸，给用户一个「切出来多大」的直观参照 */
const sizeLabel = computed(() => {
  const first = cells.value[0]
  if (!first || !props.naturalW || !props.naturalH)
    return ''
  const size = cellPixelSize(first, props.naturalW, props.naturalH)
  return `${size.w}×${size.h}`
})

function pickPreset(item: (typeof GRID_SPLIT_PRESETS)[number]) {
  presetId.value = item.id
  lines.value = makeGridLines(item.cols, item.rows)
}

function onLineDown(event: PointerEvent, axis: 'cols' | 'rows', index: number) {
  drag = { axis, index }
  presetId.value = ''
  ;(event.target as HTMLElement).setPointerCapture?.(event.pointerId)
}

function onMove(event: PointerEvent) {
  const rect = stageRef.value?.getBoundingClientRect()
  if (!drag || !rect)
    return
  const to = drag.axis === 'cols'
    ? (event.clientX - rect.left) / (rect.width || 1)
    : (event.clientY - rect.top) / (rect.height || 1)
  lines.value = drag.axis === 'cols'
    ? { ...lines.value, cols: moveGridLine(lines.value.cols, drag.index, to) }
    : { ...lines.value, rows: moveGridLine(lines.value.rows, drag.index, to) }
}

function onUp() {
  drag = null
}

function onConfirm() {
  if (tooMany.value)
    return
  emit('confirm', cells.value)
}

function onKey(event: KeyboardEvent) {
  if (!props.open)
    return
  if (event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
  }
}

// 每次打开都回到九宫格：上一次拖成什么样跟这张图没关系
watch(() => props.open, (open) => {
  if (open) {
    lines.value = makeGridLines(3, 3)
    presetId.value = '3x3'
  }
}, { immediate: true })

onMounted(() => window.addEventListener('keydown', onKey, true))
onUnmounted(() => window.removeEventListener('keydown', onKey, true))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && layerStyle"
      class="canvas-crop-layer canvas-gsplit nodrag nopan"
      :style="layerStyle"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
    >
      <div ref="stageRef" class="canvas-crop__stage">
        <!-- 格子底纹：只画边框，图本身是节点自己渲染的 -->
        <i
          v-for="cell in cells"
          :key="`cell-${cell.index}`"
          class="canvas-gsplit__cell"
          :style="{ left: `${cell.x * 100}%`, top: `${cell.y * 100}%`, width: `${cell.w * 100}%`, height: `${cell.h * 100}%` }"
        ><b>{{ cell.index }}</b></i>
        <i
          v-for="(line, i) in lines.cols"
          :key="`col-${i}`"
          class="canvas-gsplit__line is-col"
          :style="{ left: `${line * 100}%` }"
          @pointerdown.stop="onLineDown($event, 'cols', i)"
        />
        <i
          v-for="(line, i) in lines.rows"
          :key="`row-${i}`"
          class="canvas-gsplit__line is-row"
          :style="{ top: `${line * 100}%` }"
          @pointerdown.stop="onLineDown($event, 'rows', i)"
        />
      </div>
      <div class="canvas-crop__tools nodrag nopan nowheel" @pointerdown.stop>
        <button type="button" class="canvas-crop__close" @click="emit('close')">
          <UIcon name="i-lucide-x" class="size-3.5" />
          <span>{{ t('宫格切分') }}</span>
        </button>
        <span class="canvas-smart__split" />
        <button
          v-for="item in GRID_SPLIT_PRESETS"
          :key="item.id"
          type="button"
          class="canvas-gsplit__preset"
          :class="{ 'is-on': presetId === item.id }"
          @click="pickPreset(item)"
        >
          {{ t(item.label) }}
        </button>
        <span class="canvas-smart__split" />
        <em class="canvas-gsplit__count" :class="{ 'is-warn': tooMany }">
          {{ t('{n} 片', { n: count }) }}<template v-if="sizeLabel && !tooMany"> · {{ sizeLabel }}</template>
          <template v-if="tooMany"> · {{ t('最多 {n} 片', { n: GRID_SPLIT_MAX }) }}</template>
        </em>
        <button type="button" class="canvas-gsplit__go" :disabled="tooMany" @click="onConfirm">
          {{ t('切分') }}
        </button>
      </div>
    </div>
  </Teleport>
</template>
