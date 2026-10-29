<script setup lang="ts">
import { VueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import type { Edge, Node, NodeMouseEvent } from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'
import ShareCanvasNode from '~/components/share/ShareCanvasNode.vue'
import CanvasMediaPreview from '~/components/canvas/CanvasMediaPreview.vue'
import { canvasStageSize, type CanvasNodeData, type CanvasNodeKind } from '~/utils/canvas-node-kinds'
import { isMediaUrl, resolveMediaUrl } from '~/utils/media'

/**
 * 只读画布：不能拖动、连线、选中，点图片 / 音频节点放大预览。
 * 画布分享页（/share/:token）与作品创作过程（/process/:id）共用。
 */
const props = defineProps<{
  graph: { nodes: any[], edges: any[] }
}>()

const { preview: mediaPreview, open: openShareMedia, close: closeShareMedia } = useShareMediaPreview()

function nodeMediaSrc(data: CanvasNodeData, kind: 'image' | 'video' | 'audio') {
  const raw = (kind === 'image' && data.kind === 'director' ? data.previewUrl : data.content) || ''
  const value = String(raw).trim()
  return value && isMediaUrl(value) ? resolveMediaUrl(value) : ''
}

function onShareNodeClick(payload: NodeMouseEvent) {
  const data = payload.node.data as CanvasNodeData | undefined
  if (!data)
    return
  const caption = String(data.talking?.script || data.prompt || '').trim()
  if (data.kind === 'audio') {
    openShareMedia('audio', nodeMediaSrc(data, 'audio'), caption)
    return
  }
  const el = payload.event.target as HTMLElement | null
  if (el?.closest('button, a, textarea, input, audio, video, .cnode-player, .cnode__preview'))
    return
  if (data.kind === 'image' || data.kind === 'panorama' || data.kind === 'director')
    openShareMedia('image', nodeMediaSrc(data, 'image'), caption)
}

const nodeTypes = { easytv: markRaw(ShareCanvasNode), group: markRaw(ShareCanvasNode) }

function sizeOf(value: unknown) {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  return Number.isFinite(n) && n > 0 ? n : 0
}

const nodes = computed<Node[]>(() => {
  const list = (props.graph.nodes ?? []) as Array<Record<string, any>>
  return list.map((n) => {
    const kind = String(n.data?.kind || '') as CanvasNodeKind
    const stage = n.type === 'group' ? null : canvasStageSize(kind)
    const style = n.style && typeof n.style === 'object' ? n.style as Record<string, string | number> : {}
    const w = sizeOf(n.width) || sizeOf(style.width) || stage?.w || 260
    const h = sizeOf(n.height) || sizeOf(style.height) || stage?.h || 180
    return {
      id: String(n.id),
      type: n.type === 'group' ? 'group' : 'easytv',
      position: n.position ?? { x: 0, y: 0 },
      data: n.data ?? {},
      parentNode: n.parentNode,
      extent: n.extent,
      width: w,
      height: h,
      style: { ...style, width: `${w}px`, height: `${h}px` },
      class: 'nopan nodrag',
      draggable: false,
      selectable: false,
      connectable: false,
    }
  }) as Node[]
})

const edges = computed<Edge[]>(() => {
  const list = (props.graph.edges ?? []) as Array<Record<string, any>>
  return list.map(e => ({
    id: String(e.id ?? `${e.source}-${e.target}`),
    source: String(e.source),
    target: String(e.target),
    animated: false,
    selectable: false,
    style: { stroke: '#c4c4c8', strokeWidth: 1 },
  }))
})
</script>

<template>
  <VueFlow
    :nodes="nodes"
    :edges="edges"
    :node-types="nodeTypes"
    :nodes-draggable="false"
    :nodes-connectable="false"
    :elements-selectable="false"
    :zoom-on-double-click="false"
    no-pan-class-name="nopan"
    :min-zoom="0.2"
    :max-zoom="2"
    fit-view-on-init
    :fit-view-options="{ padding: 0.18 }"
    class="share-flow canvas-flow"
    @node-click="onShareNodeClick"
  >
    <Background :gap="24" :size="1" />
  </VueFlow>
  <CanvasMediaPreview
    :open="mediaPreview.open"
    :src="mediaPreview.src"
    :kind="mediaPreview.kind"
    :caption="mediaPreview.caption"
    @close="closeShareMedia"
  />
</template>
