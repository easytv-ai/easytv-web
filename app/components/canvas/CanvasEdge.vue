<script setup lang="ts">
import { EdgeLabelRenderer, getBezierPath, useVueFlow } from '@vue-flow/core'
import type { EdgeProps } from '@vue-flow/core'

const { t } = useI18n()

const props = defineProps<EdgeProps>()
const { getSelectedNodes, removeEdges } = useVueFlow('easytv-canvas')

const hovered = ref(false)
const showCut = ref(false)
const hitRef = ref<SVGPathElement | null>(null)
const cutPos = ref({ x: 0, y: 0 })
let leaveTimer = 0
let cutTimer = 0

const pathInfo = computed(() => getBezierPath({
  sourceX: props.sourceX,
  sourceY: props.sourceY,
  targetX: props.targetX,
  targetY: props.targetY,
  sourcePosition: props.sourcePosition,
  targetPosition: props.targetPosition,
  curvature: 0.4,
}))

const path = computed(() => pathInfo.value[0])

const isLive = computed(() =>
  getSelectedNodes.value.some(node => node.id === props.source || node.id === props.target),
)

function clientToPath(event: MouseEvent) {
  const el = hitRef.value
  const svg = el?.ownerSVGElement
  if (!el || !svg)
    return null
  const ctm = el.getScreenCTM()
  if (!ctm)
    return null
  const pt = svg.createSVGPoint()
  pt.x = event.clientX
  pt.y = event.clientY
  return pt.matrixTransform(ctm.inverse())
}

function closestOnPath(x: number, y: number) {
  const el = hitRef.value
  if (!el)
    return { x, y }
  const len = el.getTotalLength()
  if (!len)
    return { x, y }
  let best = 0
  let bestDist = Infinity
  const steps = Math.max(24, Math.ceil(len / 6))
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * len
    const p = el.getPointAtLength(t)
    const dist = (p.x - x) ** 2 + (p.y - y) ** 2
    if (dist < bestDist) {
      bestDist = dist
      best = t
    }
  }
  const span = len / steps
  const from = Math.max(0, best - span)
  const to = Math.min(len, best + span)
  for (let i = 0; i <= 12; i++) {
    const t = from + ((to - from) * i) / 12
    const p = el.getPointAtLength(t)
    const dist = (p.x - x) ** 2 + (p.y - y) ** 2
    if (dist < bestDist) {
      bestDist = dist
      best = t
    }
  }
  const point = el.getPointAtLength(best)
  return { x: point.x, y: point.y }
}

function onMove(event: MouseEvent) {
  const pt = clientToPath(event)
  if (!pt)
    return
  cutPos.value = closestOnPath(pt.x, pt.y)
}

function onEnter(event: MouseEvent) {
  window.clearTimeout(leaveTimer)
  window.clearTimeout(cutTimer)
  hovered.value = true
  onMove(event)
  if (!showCut.value) {
    cutTimer = window.setTimeout(() => {
      showCut.value = true
    }, 650)
  }
}

function keepCut() {
  window.clearTimeout(leaveTimer)
  window.clearTimeout(cutTimer)
  hovered.value = true
  showCut.value = true
}

function onLeave() {
  window.clearTimeout(cutTimer)
  leaveTimer = window.setTimeout(() => {
    hovered.value = false
    showCut.value = false
  }, 100)
}

function onCut(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  removeEdges(props.id)
}

watch(() => pathInfo.value, (info) => {
  if (!hovered.value)
    cutPos.value = { x: info[1], y: info[2] }
}, { immediate: true })

onUnmounted(() => {
  window.clearTimeout(leaveTimer)
  window.clearTimeout(cutTimer)
})
</script>

<template>
  <g
    class="canvas-edge"
    :class="{ 'is-live': isLive, 'is-over': hovered }"
    @mouseenter="onEnter"
    @mousemove="onMove"
    @mouseleave="onLeave"
  >
    <path ref="hitRef" class="canvas-edge__hit" :d="path" fill="none" />
    <path class="canvas-edge__line" :d="path" fill="none" />
    <CanvasEdgeFlow v-if="isLive" :d="path" />
    <EdgeLabelRenderer>
      <div
        v-if="showCut"
        class="canvas-edge__cut nodrag nopan"
        :style="{ transform: `translate(-50%, -50%) translate(${cutPos.x}px, ${cutPos.y}px)` }"
        @mouseenter="keepCut"
        @mouseleave="onLeave"
      >
        <button type="button" :aria-label="t('断开连线')" @click="onCut" @pointerdown.stop>
          <UIcon name="i-lucide-scissors" class="size-3.5" />
        </button>
      </div>
    </EdgeLabelRenderer>
  </g>
</template>
