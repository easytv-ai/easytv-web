<script setup lang="ts">
import { nodeSize, type CanvasFlowNode } from '~/utils/canvas-group'
import type { CanvasRect } from '~/utils/canvas-viewport'

const { t } = useI18n()

defineProps<{
  showMinimap?: boolean
  nodes: CanvasFlowNode[]
  viewRect: CanvasRect
  mini: CanvasRect
  hideEdges?: boolean
  canvasLocked?: boolean
  readonly?: boolean
  snapOn?: boolean
  zoomMenu?: boolean
  zoomPct: number
  zoomDraft: string
  zoomCmd: string
}>()

const emit = defineEmits<{
  organize: []
  'toggle-minimap': []
  'toggle-edges': []
  'toggle-lock': []
  'toggle-snap': []
  'toggle-zoom': []
  'apply-zoom-draft': []
  'zoom-in': []
  'zoom-out': []
  fit: []
  'apply-zoom': [value: number]
  'update:zoomDraft': [value: string]
  'dock-pointer': [event: PointerEvent]
  'minimap-pointer': [event: PointerEvent]
}>()

function boxW(node: CanvasFlowNode) {
  return nodeSize(node).w
}

function boxH(node: CanvasFlowNode) {
  return nodeSize(node).h
}
</script>

<template>
  <div class="canvas-dock" :class="{ 'is-menu': zoomMenu }" @pointerdown.stop="emit('dock-pointer', $event)" @dblclick.stop>
    <div
      v-if="showMinimap"
      class="canvas-minimap"
      @pointerdown.stop="emit('minimap-pointer', $event)"
      @dblclick.stop
    >
      <svg
        :viewBox="`${mini.x} ${mini.y} ${mini.w} ${mini.h}`"
        preserveAspectRatio="xMidYMid meet"
      >
        <rect
          v-for="node in nodes"
          :key="node.id"
          class="canvas-minimap__node"
          :x="node.position.x"
          :y="node.position.y"
          :width="boxW(node)"
          :height="boxH(node)"
          rx="8"
        />
        <rect
          class="canvas-minimap__view"
          :x="viewRect.x"
          :y="viewRect.y"
          :width="viewRect.w"
          :height="viewRect.h"
        />
      </svg>
    </div>
    <div class="canvas-dock__bar">
      <div class="canvas-dock__group">
        <button type="button" :aria-label="t('整理画布')" @click="emit('organize')">
          <UIcon name="i-lucide-layout-grid" class="size-3.5" />
          <span class="canvas-tip canvas-tip--up canvas-tip--up-start">{{ t('整理画布') }} <kbd>Alt+Shift+F</kbd></span>
        </button>
        <button
          type="button"
          :aria-label="t('小地图')"
          :class="{ 'is-on': showMinimap }"
          @click="emit('toggle-minimap')"
        >
          <UIcon name="i-lucide-map-pin" class="size-3.5" />
          <span class="canvas-tip canvas-tip--up">{{ t('小地图') }}</span>
        </button>
        <button
          type="button"
          class="canvas-dock__hide-edges"
          :class="{ 'is-on': hideEdges }"
          :aria-label="hideEdges ? t('显示节点连线') : t('隐藏节点连线')"
          @click="emit('toggle-edges')"
        >
          <UIcon name="i-lucide-spline" class="size-3.5" />
          <span v-if="hideEdges" class="canvas-dock__slash" />
          <span class="canvas-tip canvas-tip--up">{{ hideEdges ? t('显示节点连线') : t('隐藏节点连线') }}</span>
        </button>
        <button
          type="button"
          :aria-label="canvasLocked ? t('canvas.lock.canvasUnlock') : t('canvas.lock.canvas')"
          :class="{ 'is-on': canvasLocked }"
          :disabled="readonly"
          @click="emit('toggle-lock')"
        >
          <UIcon :name="canvasLocked ? 'i-lucide-lock' : 'i-lucide-lock-open'" class="size-3.5" />
          <span class="canvas-tip canvas-tip--up">{{ canvasLocked ? t('canvas.lock.canvasUnlock') : t('canvas.lock.canvas') }}</span>
        </button>
        <button
          type="button"
          :aria-label="t('吸附网格')"
          :class="{ 'is-on': snapOn }"
          @click="emit('toggle-snap')"
        >
          <UIcon name="i-lucide-magnet" class="size-3.5" />
          <span class="canvas-tip canvas-tip--up">{{ t('吸附网格') }}</span>
        </button>
        <div class="canvas-dock__zoom-wrap">
          <button
            type="button"
            class="canvas-dock__zoom"
            :class="{ 'is-on': zoomMenu }"
            :aria-label="t('缩放')"
            aria-haspopup="true"
            :aria-expanded="zoomMenu"
            @click="emit('toggle-zoom')"
          >
            {{ zoomPct }}%
          </button>
          <div v-if="zoomMenu" class="canvas-zoom-pop" @pointerdown.stop>
            <label class="canvas-zoom-pop__field">
              <input
                :value="zoomDraft"
                class="nodrag nowheel"
                inputmode="numeric"
                maxlength="3"
                :aria-label="t('缩放百分比')"
                @input="emit('update:zoomDraft', ($event.target as HTMLInputElement).value)"
                @keydown.enter.prevent="emit('apply-zoom-draft')"
                @blur="emit('apply-zoom-draft')"
              >
              <span>%</span>
            </label>
            <button type="button" @click="emit('zoom-in')">
              {{ t('放大') }}
              <kbd>{{ zoomCmd }} +</kbd>
            </button>
            <button type="button" @click="emit('zoom-out')">
              {{ t('缩小') }}
              <kbd>{{ zoomCmd }} -</kbd>
            </button>
            <button type="button" @click="emit('fit')">
              {{ t('适合屏幕') }}
              <kbd>{{ zoomCmd }} + 0</kbd>
            </button>
            <i />
            <button type="button" @click="emit('apply-zoom', 50)">{{ t('缩放至 50%') }}</button>
            <button type="button" @click="emit('apply-zoom', 100)">{{ t('缩放至 100%') }}</button>
            <button type="button" @click="emit('apply-zoom', 800)">{{ t('缩放至 800%') }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
