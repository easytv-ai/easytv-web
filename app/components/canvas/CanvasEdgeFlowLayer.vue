<script setup lang="ts">
import { CANVAS_EDGE_FLOW_PERIOD, canvasEdgeFlowDash } from '~/utils/canvas-edge-flow'
import { canvasEdgeFlowLivePaths } from '~/utils/canvas-edge-flow-live'

const paths = canvasEdgeFlowLivePaths()
const dash = canvasEdgeFlowDash()
const ready = ref(false)

onMounted(() => {
  ready.value = true
})
</script>

<template>
  <Teleport v-if="ready" to=".vue-flow__transformationpane">
    <svg v-show="paths.length" class="canvas-edge-flow-layer" aria-hidden="true">
      <g
        class="canvas-edge__flow-g is-run"
        :style="{
          '--edge-cell': `${dash.thickness}px`,
          '--edge-cycle': String(dash.cycle),
          '--edge-period': `${CANVAS_EDGE_FLOW_PERIOD}s`,
        }"
      >
        <template v-for="item in paths" :key="item.id">
          <path class="canvas-edge__flow is-outer" :d="item.d" fill="none" pathLength="1" :stroke-dasharray="dash.wrap" />
          <path class="canvas-edge__flow is-inner" :d="item.d" fill="none" pathLength="1" :stroke-dasharray="dash.wrap" />
          <path class="canvas-edge__flow is-cell" :d="item.d" fill="none" pathLength="1" :stroke-dasharray="dash.wrap" />
        </template>
      </g>
    </svg>
  </Teleport>
</template>
