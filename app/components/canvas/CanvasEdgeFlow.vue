<script setup lang="ts">
import { CANVAS_EDGE_FLOW_CELLS, canvasEdgeFlowLayout, canvasEdgeFlowSpeed } from '~/utils/canvas-edge-flow'

defineProps<{
  d: string
}>()

const CELL_INDEXES = Array.from({ length: CANVAS_EDGE_FLOW_CELLS }, (_, i) => i)

const measureRef = ref<SVGPathElement | null>(null)
const outerRef = ref<SVGPathElement | null>(null)
const innerRef = ref<SVGPathElement | null>(null)
const groupRef = ref<SVGGElement | null>(null)
const wrapDash = ref('0 1')
const cellDash = ref('0 1')
const cellSize = ref(3)
const cellStep = ref(3)

let raf = 0
let alive = false
let reduceMotion = false
let lastD = ''
let pathLen = 0

function cellEls() {
  return Array.from(groupRef.value?.querySelectorAll('.canvas-edge__flow.is-cell') ?? []) as SVGPathElement[]
}

function applyDash(el: { isConnected: boolean, setAttribute: (name: string, value: string) => void } | null, value: string) {
  if (!el?.isConnected)
    return
  el.setAttribute('stroke-dasharray', value)
}

function applyOffset(el: { isConnected: boolean, setAttribute: (name: string, value: string) => void } | null, value: number) {
  if (!el?.isConnected)
    return
  el.setAttribute('stroke-dashoffset', String(value))
}

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
  pathLen = total
  const next = canvasEdgeFlowLayout(total)
  if (total <= 1 || !next.slugLen) {
    wrapDash.value = '0 1'
    cellDash.value = '0 1'
    pathLen = 0
    return
  }
  const period = next.slugLen + Math.max(next.gap, 1)
  wrapDash.value = `${next.slugLen} ${Math.max(next.gap, 1)}`
  cellDash.value = `${next.cell} ${Math.max(period - next.cell, 1)}`
  cellSize.value = next.thickness
  cellStep.value = next.cell + next.cellGap
  applyDash(outerRef.value, wrapDash.value)
  applyDash(innerRef.value, wrapDash.value)
  for (const cell of cellEls())
    applyDash(cell, cellDash.value)
}

function tick() {
  if (!alive)
    return
  const el = measureRef.value
  if (el?.isConnected && !reduceMotion) {
    const d = el.getAttribute('d') || ''
    if (d !== lastD) {
      lastD = d
      layout()
    }
    const offset = -((performance.now() / 1000) * canvasEdgeFlowSpeed(pathLen))
    applyOffset(outerRef.value, offset)
    applyOffset(innerRef.value, offset)
    cellEls().forEach((cell, i) => applyOffset(cell, offset - i * cellStep.value))
  }
  if (alive)
    raf = requestAnimationFrame(tick)
}

onMounted(() => {
  alive = true
  reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!reduceMotion) {
    layout()
    raf = requestAnimationFrame(tick)
  }
})

onUnmounted(() => {
  alive = false
  cancelAnimationFrame(raf)
})
</script>

<template>
  <g
    ref="groupRef"
    class="canvas-edge__flow-g"
    aria-hidden="true"
    :style="{ '--edge-cell': `${cellSize}px` }"
  >
    <path ref="measureRef" class="canvas-edge__flow-measure" :d="d" />
    <path
      ref="outerRef"
      class="canvas-edge__flow is-outer"
      :d="d"
      fill="none"
      :stroke-dasharray="wrapDash"
    />
    <path
      ref="innerRef"
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
    />
  </g>
</template>
