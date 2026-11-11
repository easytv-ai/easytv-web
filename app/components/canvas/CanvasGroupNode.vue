<script setup lang="ts">
import type { NodeProps } from '@vue-flow/core'
import { useVueFlow } from '@vue-flow/core'
import { type CanvasGroupData, type GroupThumb } from '~/utils/canvas-group'
import { CANVAS_CHANGE_KEY } from '~/utils/canvas-change'
import { CANVAS_NODE_VIEW_KEY, CANVAS_ZOOM_KEY, EMPTY_CANVAS_NODE_VIEW } from '~/utils/canvas-node-view'

const props = defineProps<NodeProps<CanvasGroupData>>()
const { updateNode } = useVueFlow('easytv-canvas')
const nodeView = inject(CANVAS_NODE_VIEW_KEY, shallowRef(EMPTY_CANVAS_NODE_VIEW))
const readZoom = inject(CANVAS_ZOOM_KEY, () => 1)
const canvasChange = inject(CANVAS_CHANGE_KEY, null)
const groupLocked = computed(() => Boolean(nodeView.value.locked[props.id]))
const groupView = computed(() => nodeView.value.groups[props.id])
const thumbLayout = computed(() => groupView.value?.layout || props.data.layout)
const thumbs = computed(() => groupView.value?.thumbs || props.data.thumbs || [])

type Corner = 'tl' | 'tr' | 'bl' | 'br'

const posterMiss = ref<Record<string, boolean>>({})

function thumbImage(item: GroupThumb) {
  if (item.poster && !posterMiss.value[item.id])
    return item.poster
  if (item.media && !item.video)
    return item.media
  return ''
}

function onResize(event: PointerEvent, corner: Corner) {
  if (groupLocked.value)
    return
  event.preventDefault()
  event.stopPropagation()
  const startX = event.clientX
  const startY = event.clientY
  const startW = props.dimensions?.width || 360
  const startH = props.dimensions?.height || 220
  const startPos = { x: props.position.x, y: props.position.y }
  const el = event.currentTarget as HTMLElement
  el.setPointerCapture(event.pointerId)

  function onMove(move: PointerEvent) {
    const z = readZoom()
    const dx = (move.clientX - startX) / z
    const dy = (move.clientY - startY) / z
    let w = startW
    let h = startH
    let x = startPos.x
    let y = startPos.y
    if (corner.includes('r'))
      w = Math.max(220, startW + dx)
    if (corner.includes('l')) {
      w = Math.max(220, startW - dx)
      x = startPos.x + startW - w
    }
    if (corner.includes('b'))
      h = Math.max(160, startH + dy)
    if (corner.includes('t')) {
      h = Math.max(160, startH - dy)
      y = startPos.y + startH - h
    }
    updateNode(props.id, {
      position: { x, y },
      width: w,
      height: h,
      style: { width: `${w}px`, height: `${h}px` },
    })
  }

  function onUp() {
    el.removeEventListener('pointermove', onMove)
    el.removeEventListener('pointerup', onUp)
    el.removeEventListener('pointercancel', onUp)
    // 组尺寸改完：压一条撤销历史并触发自动保存
    canvasChange?.commit()
  }
  el.addEventListener('pointermove', onMove)
  el.addEventListener('pointerup', onUp)
  el.addEventListener('pointercancel', onUp)
}
</script>

<template>
  <div
    class="cgroup"
    :class="{ 'is-on': selected, 'is-collapsed': data.collapsed }"
    :style="{ background: data.color }"
  >
    <span v-if="selected || data.collapsed || groupLocked" class="cgroup__name">
      <UIcon v-if="groupLocked" name="i-lucide-lock" class="size-3" />
      {{ data.label }}
    </span>
    <span v-if="data.storyboard" class="cgroup__badge">{{ $t('分镜组') }}</span>
    <div v-if="data.collapsed" class="cgroup__thumbs" :class="`is-${thumbLayout}`">
      <span
        v-for="item in thumbs"
        :key="item.id"
        class="cgroup__thumb"
        :style="item.color ? { background: item.color } : undefined"
      >
        <img
          v-if="thumbImage(item)"
          :src="thumbImage(item)"
          alt=""
          loading="lazy"
          decoding="async"
          draggable="false"
          @error="posterMiss[item.id] = true"
        >
        <i v-else-if="item.text">{{ item.text }}</i>
      </span>
    </div>
    <button
      v-for="corner in (['tl', 'tr', 'bl', 'br'] as Corner[])"
      v-show="selected && !data.collapsed && !groupLocked"
      :key="corner"
      type="button"
      class="cgroup__grip nodrag nopan"
      :class="`is-${corner}`"
      :aria-label="`${$t('缩放')} ${corner}`"
      @pointerdown.stop="onResize($event, corner)"
    />
  </div>
</template>
