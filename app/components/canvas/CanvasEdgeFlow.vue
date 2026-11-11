<script setup lang="ts">
import { CANVAS_EDGE_FLOW_PERIOD, canvasEdgeFlowDash } from '~/utils/canvas-edge-flow'

defineProps<{
  d: string
}>()

const dash = canvasEdgeFlowDash()
</script>

<template>
  <g
    class="canvas-edge__flow-g is-run"
    aria-hidden="true"
    :style="{
      '--edge-cell': `${dash.thickness}px`,
      '--edge-cycle': String(dash.cycle),
      '--edge-period': `${CANVAS_EDGE_FLOW_PERIOD}s`,
    }"
  >
    <path
      class="canvas-edge__flow is-outer"
      :d="d"
      fill="none"
      pathLength="1"
      :stroke-dasharray="dash.wrap"
    />
    <path
      class="canvas-edge__flow is-inner"
      :d="d"
      fill="none"
      pathLength="1"
      :stroke-dasharray="dash.wrap"
    />
    <path
      class="canvas-edge__flow is-cell"
      :d="d"
      fill="none"
      pathLength="1"
      :stroke-dasharray="dash.wrap"
    />
  </g>
</template>
