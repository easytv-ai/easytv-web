<script setup lang="ts">
import {
  CANVAS_EDGE_FLOW_CELLS,
  CANVAS_EDGE_FLOW_PERIOD,
  canvasEdgeFlowCellDelay,
  canvasEdgeFlowLayout,
} from '~/utils/canvas-edge-flow'

const props = defineProps<{
  d: string
}>()

const CELL_INDEXES = Array.from({ length: CANVAS_EDGE_FLOW_CELLS }, (_, i) => i)
const CELL_DELAYS = CELL_INDEXES.map(i => `${canvasEdgeFlowCellDelay(i)}s`)

const measureRef = ref<SVGPathElement | null>(null)
const wrapDash = ref('0 1')
const cellDash = ref('0 1')
const cellSize = ref(3)
const cycle = ref('-1')
const flowing = ref(false)

let layoutTimer = 0

function pathLength(el: { getTotalLength: () => number }) {
  try {
    return el.getTotalLength()
  }
  catch {
    return 0
  }
}

function layout() {
  const el = measureRef.value
  if (!el?.isConnected)
    return
  const total = pathLength(el)
  const next = canvasEdgeFlowLayout(total)
  if (total <= 1 || !next.slugLen) {
    wrapDash.value = '0 1'
    cellDash.value = '0 1'
    flowing.value = false
    return
  }
  wrapDash.value = `${next.slugLen} ${Math.max(next.gap, 1)}`
  const period = next.slugLen + Math.max(next.gap, 1)
  cellDash.value = `${next.cell} ${Math.max(period - next.cell, 1)}`
  cellSize.value = next.thickness
  cycle.value = String(-total)
  flowing.value = true
}

function scheduleLayout() {
  if (layoutTimer)
    return
  layoutTimer = window.setTimeout(() => {
    layoutTimer = 0
    layout()
  }, 48)
}

watch(() => props.d, scheduleLayout)

onMounted(() => {
  layout()
})

onUnmounted(() => {
  window.clearTimeout(layoutTimer)
})
</script>

<template>
  <g
    class="canvas-edge__flow-g"
    :class="{ 'is-run': flowing }"
    aria-hidden="true"
    :style="{
      '--edge-cell': `${cellSize}px`,
      '--edge-cycle': cycle,
      '--edge-period': `${CANVAS_EDGE_FLOW_PERIOD}s`,
    }"
  >
    <path ref="measureRef" class="canvas-edge__flow-measure" :d="d" />
    <path
      class="canvas-edge__flow is-outer"
      :d="d"
      fill="none"
      :stroke-dasharray="wrapDash"
    />
    <path
      class="canvas-edge__flow is-inner"
      :d="d"
      fill="none"
      :stroke-dasharray="wrapDash"
    />
    <path
      v-for="i in CELL_INDEXES"
      :key="i"
      class="canvas-edge__flow is-cell"
      :class="`is-cell-${i}`"
      :d="d"
      fill="none"
      :stroke-dasharray="cellDash"
      :style="{ animationDelay: CELL_DELAYS[i] }"
    />
  </g>
</template>
