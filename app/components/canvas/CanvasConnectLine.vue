<script setup lang="ts">
import { getBezierPath, Position } from '@vue-flow/core'

const props = withDefaults(defineProps<{
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition?: Position
  targetPosition?: Position
}>(), {
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
})

const path = computed(() => getBezierPath({
  sourceX: props.sourceX,
  sourceY: props.sourceY,
  targetX: props.targetX,
  targetY: props.targetY,
  sourcePosition: props.sourcePosition,
  targetPosition: props.targetPosition,
  curvature: 0.4,
})[0])
</script>

<template>
  <g class="canvas-connect-line">
    <path class="canvas-edge__line" :d="path" fill="none" />
    <CanvasEdgeFlow :d="path" />
  </g>
</template>
