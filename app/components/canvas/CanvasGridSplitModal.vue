<script setup lang="ts">
import {
  cellPixelSize,
  GRID_SPLIT_MAX,
  GRID_SPLIT_PRESETS,
  gridCells,
  gridSplitTooMany,
  makeGridLines,
  moveGridLine,
  type GridCell,
  type GridLines,
} from '~/utils/canvas-grid-split'

/**
 * 宫格切分：盖在图片节点上的一层，拖分割线定每一片的边界。
 * 默认每格都切。点一格就去掉，格子变暗，再点加回来。
 * 确认后只把选中的归一化 rect 交给工作区，原图留在画布上。
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
/** 点掉、这次不切的格子编号。换预设或重新打开时清空，拖分割线不影响 */
const skipped = ref<Set<number>>(new Set())
const stageRef = ref<HTMLElement | null>(null)
let drag: { axis: 'cols' | 'rows', index: number } | null = null

const layerStyle = computed(() => {
  const box = props.box
  return box
    ? { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` }
    : null
})

const cells = computed(() => gridCells(lines.value))
const tooMany = computed(() => gridSplitTooMany(lines.value))
const picked = computed(() => cells.value.filter(cell => !skipped.value.has(cell.index)))

function cellOn(index: number) {
  return !skipped.value.has(index)
}

function toggleCell(index: number) {
  const next = new Set(skipped.value)
  if (next.has(index))
    next.delete(index)
  else
    next.add(index)
  skipped.value = next
}

function resetPick() {
  skipped.value = new Set()
}

/** 第一片选中格子的像素尺寸，给用户一个「切出来多大」的直观参照 */
const sizeLabel = computed(() => {
  const first = picked.value[0]
  if (!first || !props.naturalW || !props.naturalH)
    return ''
  const size = cellPixelSize(first, props.naturalW, props.naturalH)
  return `${size.w}×${size.h}`
})

function pickPreset(item: (typeof GRID_SPLIT_PRESETS)[number]) {
  presetId.value = item.id
  lines.value = makeGridLines(item.cols, item.rows)
  resetPick()
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
  if (tooMany.value || !picked.value.length)
    return
  emit('confirm', picked.value)
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
    resetPick()
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
        <!-- 格子可点：选中的切出去，点掉的变暗，这次不切。分割线盖在上面，拖线不受影响 -->
        <button
          v-for="cell in cells"
          :key="`cell-${cell.index}`"
          type="button"
          class="canvas-gsplit__cell"
          :class="{ 'is-off': !cellOn(cell.index) }"
          :style="{ left: `${cell.x * 100}%`, top: `${cell.y * 100}%`, width: `${cell.w * 100}%`, height: `${cell.h * 100}%` }"
          :aria-pressed="cellOn(cell.index)"
          :title="cellOn(cell.index) ? t('不切这一格') : t('切出这一格')"
          @pointerdown.stop
          @click.stop="toggleCell(cell.index)"
        ><b>{{ cell.index }}</b></button>
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
        <em class="canvas-gsplit__count" :class="{ 'is-warn': tooMany || !picked.length }">
          {{ t('已选 {n} 片', { n: picked.length }) }}<template v-if="sizeLabel && !tooMany && picked.length"> · {{ sizeLabel }}</template>
          <template v-if="tooMany"> · {{ t('最多 {n} 片', { n: GRID_SPLIT_MAX }) }}</template>
        </em>
        <button type="button" class="canvas-gsplit__go" :disabled="tooMany || !picked.length" @click="onConfirm">
          {{ t('切分') }}
        </button>
      </div>
    </div>
  </Teleport>
</template>
