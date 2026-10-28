<script setup lang="ts">
import type { NodeProps } from '@vue-flow/core'
import { useVueFlow } from '@vue-flow/core'
import { collapseLayoutForKids, isContentNode, isNodeLocked, type CanvasFlowNode, type CanvasGroupData } from '~/utils/canvas-group'
import { isMediaUrl, resolveMediaUrl } from '~/utils/media'
import { CANVAS_CHANGE_KEY } from '~/utils/canvas-change'

const props = defineProps<NodeProps<CanvasGroupData>>()
const { getNodes, updateNode, viewport } = useVueFlow('easytv-canvas')
const canvasChange = inject(CANVAS_CHANGE_KEY, null)
const groupLocked = computed(() => {
  const self = getNodes.value.find(node => node.id === props.id) as CanvasFlowNode | undefined
  return isNodeLocked(self || { id: props.id, data: props.data, parentNode: props.parentNodeId } as CanvasFlowNode, getNodes.value as CanvasFlowNode[])
})

const thumbLayout = computed(() => {
  const kids = getNodes.value.filter(node => node.parentNode === props.id)
  return collapseLayoutForKids(kids, props.data.layout)
})

type Corner = 'tl' | 'tr' | 'bl' | 'br'

const thumbs = computed(() => {
  return getNodes.value
    .filter(node => node.parentNode === props.id)
    .sort((a, b) => {
      if (thumbLayout.value === 'col')
        return a.position.y === b.position.y ? a.position.x - b.position.x : a.position.y - b.position.y
      return a.position.x === b.position.x ? a.position.y - b.position.y : a.position.x - b.position.x
    })
    .map((node) => {
      const data = isContentNode(node as CanvasFlowNode) ? node.data : null
      const raw = (data?.kind === 'director' ? data.previewUrl : data?.content)?.trim() || ''
      const isVisual = data?.kind === 'image' || data?.kind === 'video' || data?.kind === 'director'
      const media = data && isVisual && isMediaUrl(raw)
        ? resolveMediaUrl(raw)
        : (data?.refUrl && isMediaUrl(data.refUrl) ? resolveMediaUrl(data.refUrl) : '')
      const text = data?.kind === 'text'
        ? (data.content || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').trim()
        : ''
      return {
        id: node.id,
        color: data?.kind === 'text' ? (data.color || '') : '',
        media,
        video: data?.kind === 'video',
        text,
      }
    })
})

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
    const z = viewport.value.zoom || 1
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
        <img v-if="item.media && !item.video" :src="item.media" alt="" draggable="false">
        <video
          v-else-if="item.media && item.video"
          :src="item.media"
          muted
          playsinline
          preload="metadata"
        />
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
