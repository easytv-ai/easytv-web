<script setup lang="ts">
import { useVueFlow } from '@vue-flow/core'
import { absPosition, nodeSize, type CanvasFlowNode } from '~/utils/canvas-group'
import {
  bindCanvasEdgeDrawer,
  canvasEdgeCamera,
  publishCanvasEdgeCamera,
  type CanvasEdgeCamera,
} from '~/utils/canvas-edge-camera'
import {
  CANVAS_EDGE_THICKNESS,
  CANVAS_EDGE_FLOW_PERIOD,
  canvasEdgeFlowDash,
} from '~/utils/canvas-edge-flow'
import {
  buildCanvasEdgeGeoms,
  canvasEdgeInView,
  canvasEdgeScreenWidth,
  pickCanvasEdge,
  type CanvasEdgeGeom,
  type CanvasEdgeHandle,
  type CanvasEdgeNodeBox,
  type CanvasEdgeView,
} from '~/utils/canvas-edge-geometry'

const props = defineProps<{
  nodes: CanvasFlowNode[]
  edges: Array<{ id: string, source: string, target: string, sourceHandle?: string | null, targetHandle?: string | null }>
  hideEdges: boolean
  canCut: boolean
}>()

const { t } = useI18n()
const { viewport, removeEdges } = useVueFlow('easytv-canvas')

type MeasuredNode = CanvasFlowNode & {
  computedPosition?: { x: number, y: number }
  handleBounds?: { source?: CanvasEdgeHandle[], target?: CanvasEdgeHandle[] }
}

const ready = ref(false)
const baseRef = ref<HTMLCanvasElement | null>(null)
const flowRef = ref<HTMLCanvasElement | null>(null)
const wrapRef = ref<HTMLElement | null>(null)
const cut = reactive({ show: false, x: 0, y: 0, id: '' })

let geoms: CanvasEdgeGeom[] = []
let hoverId = ''
let flowRaf = 0
let hitRaf = 0
let hitEvent: PointerEvent | null = null
let leaveTimer = 0
let cutTimer = 0
let resizeObserver: ResizeObserver | null = null
let themeObserver: MutationObserver | null = null
let viewportEl: HTMLElement | null = null
let placedKey = ''
let wrapSize = ''
let wrapTransform = ''

const HIT_PX = 12
const dash = canvasEdgeFlowDash()
const dashParts = dash.wrap.split(' ').map(Number)
const dashSlug = dashParts[0] || 0
const dashGap = dashParts[1] || 0
const reducedMotion = import.meta.client && window.matchMedia('(prefers-reduced-motion: reduce)').matches

function boxSize(node: CanvasFlowNode) {
  const dim = (node as { dimensions?: { width?: number, height?: number } }).dimensions
  const styleW = Number.parseFloat(String(node.style?.width ?? ''))
  const styleH = Number.parseFloat(String(node.style?.height ?? ''))
  const w = node.width || (Number.isFinite(styleW) ? styleW : 0) || dim?.width || 0
  const h = node.height || (Number.isFinite(styleH) ? styleH : 0) || dim?.height || 0
  if (w > 0 && h > 0)
    return { w, h }
  return nodeSize(node)
}

const model = computed(() => {
  const boxes: CanvasEdgeNodeBox[] = []
  const list = props.nodes
  for (const node of list) {
    const measured = node as MeasuredNode
    const size = boxSize(node)
    const pos = measured.computedPosition
    const origin = pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)
      ? pos
      : absPosition(node, list)
    boxes.push({
      id: node.id,
      x: origin.x,
      y: origin.y,
      w: size.w,
      h: size.h,
      hidden: node.hidden,
      selected: node.selected,
      source: measured.handleBounds?.source,
      target: measured.handleBounds?.target,
    })
  }
  return buildCanvasEdgeGeoms(boxes, props.edges)
})

function palette() {
  const dark = document.documentElement.classList.contains('dark')
  return dark
    ? { base: '#6e6e76', live: '#8a8a92', flow: '#a78bfa' }
    : { base: '#c4c4c8', live: '#a1a1aa', flow: '#8b5cf6' }
}

function viewOf(camera: CanvasEdgeCamera, host: HTMLElement): CanvasEdgeView {
  const zoom = camera.zoom || 1
  const left = -camera.x / zoom
  const top = -camera.y / zoom
  return {
    left,
    top,
    right: left + host.clientWidth / zoom,
    bottom: top + host.clientHeight / zoom,
  }
}

function flowHost() {
  if (!import.meta.client)
    return null
  if (viewportEl?.isConnected)
    return viewportEl
  viewportEl = document.querySelector('.canvas-workspace .canvas-flow .vue-flow__viewport') as HTMLElement | null
  return viewportEl
}

/**
 * 画布盖住当前这一屏，挂在世界层里。
 * 父层再 scale 一次，所以位图像素按屏幕算，线宽按画布坐标算。
 */
function place(camera: CanvasEdgeCamera, resizeBitmaps: boolean) {
  const host = flowHost()
  const wrap = wrapRef.value
  if (!host || !wrap)
    return null
  const viewW = host.clientWidth
  const viewH = host.clientHeight
  if (viewW < 2 || viewH < 2)
    return null
  const zoom = camera.zoom || 1
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const flowLeft = -camera.x / zoom
  const flowTop = -camera.y / zoom
  const size = `${viewW / zoom}px ${viewH / zoom}px`
  const transform = `translate(${flowLeft}px, ${flowTop}px)`
  if (wrapSize !== size) {
    wrapSize = size
    wrap.style.width = `${viewW / zoom}px`
    wrap.style.height = `${viewH / zoom}px`
  }
  if (wrapTransform !== transform) {
    wrapTransform = transform
    wrap.style.transform = transform
  }
  const key = `${viewW}x${viewH}@${dpr}`
  if (resizeBitmaps && placedKey !== key) {
    placedKey = key
    const bw = Math.max(1, Math.round(viewW * dpr))
    const bh = Math.max(1, Math.round(viewH * dpr))
    for (const canvas of [baseRef.value, flowRef.value]) {
      if (!canvas)
        continue
      canvas.width = bw
      canvas.height = bh
    }
  }
  return { zoom, dpr, flowLeft, flowTop, view: viewOf(camera, host) }
}

function prepare(ctx: CanvasRenderingContext2D, frame: NonNullable<ReturnType<typeof place>>) {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  const scale = frame.zoom * frame.dpr
  ctx.setTransform(scale, 0, 0, scale, -frame.flowLeft * scale, -frame.flowTop * scale)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.globalAlpha = 1
  ctx.setLineDash([])
}

function drawnGeoms(view: CanvasEdgeView) {
  const list: CanvasEdgeGeom[] = []
  for (const geom of geoms) {
    if (props.hideEdges && !geom.live)
      continue
    if (!canvasEdgeInView(geom, view))
      continue
    list.push(geom)
  }
  return list
}

function strokeBundle(ctx: CanvasRenderingContext2D, list: CanvasEdgeGeom[], color: string, width: number) {
  if (!list.length)
    return
  ctx.beginPath()
  for (const geom of list) {
    ctx.moveTo(geom.x0, geom.y0)
    ctx.bezierCurveTo(geom.c1x, geom.c1y, geom.c2x, geom.c2y, geom.x1, geom.y1)
  }
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.stroke()
}

function paintBase(camera = canvasEdgeCamera.value) {
  const frame = place(camera, true)
  const canvas = baseRef.value
  if (!frame || !canvas)
    return
  const ctx = canvas.getContext('2d')
  if (!ctx)
    return
  prepare(ctx, frame)
  const colors = palette()
  const width = canvasEdgeScreenWidth(frame.zoom)
  const plain: CanvasEdgeGeom[] = []
  const live: CanvasEdgeGeom[] = []
  let hover: CanvasEdgeGeom | null = null
  for (const geom of drawnGeoms(frame.view)) {
    if (geom.id === hoverId)
      hover = geom
    else if (geom.live)
      live.push(geom)
    else
      plain.push(geom)
  }
  strokeBundle(ctx, plain, colors.base, width)
  strokeBundle(ctx, live, colors.live, width)
  if (hover)
    strokeBundle(ctx, [hover], colors.live, width)
}

function paintFlow(now: number) {
  const camera = canvasEdgeCamera.value
  const canvas = flowRef.value
  const frame = place(camera, false)
  if (!frame || !canvas)
    return
  const ctx = canvas.getContext('2d')
  if (!ctx)
    return
  prepare(ctx, frame)
  if (camera.moving || reducedMotion) {
    stopFlow()
    return
  }
  const phase = ((now / 1000) % CANVAS_EDGE_FLOW_PERIOD) / CANVAS_EDGE_FLOW_PERIOD
  const color = palette().flow
  const layers = [
    { width: CANVAS_EDGE_THICKNESS * 5, alpha: 0.04 },
    { width: CANVAS_EDGE_THICKNESS * 2.8, alpha: 0.07 },
    { width: CANVAS_EDGE_THICKNESS, alpha: 0.92 },
  ]
  for (const geom of drawnGeoms(frame.view)) {
    if (!geom.flow || geom.length <= 0)
      continue
    ctx.beginPath()
    ctx.moveTo(geom.x0, geom.y0)
    ctx.bezierCurveTo(geom.c1x, geom.c1y, geom.c2x, geom.c2y, geom.x1, geom.y1)
    ctx.setLineDash([dashSlug * geom.length, dashGap * geom.length])
    ctx.lineDashOffset = -phase * geom.length
    ctx.strokeStyle = color
    for (const layer of layers) {
      ctx.globalAlpha = layer.alpha
      ctx.lineWidth = layer.width
      ctx.stroke()
    }
  }
  ctx.globalAlpha = 1
  ctx.setLineDash([])
}

function stopFlow() {
  if (!flowRaf)
    return
  cancelAnimationFrame(flowRaf)
  flowRaf = 0
}

function clearFlow() {
  const canvas = flowRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx)
    return
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
}

function ensureFlow() {
  if (flowRaf || reducedMotion || canvasEdgeCamera.value.moving)
    return
  if (!geoms.some(geom => geom.flow)) {
    clearFlow()
    return
  }
  const loop = (now: number) => {
    if (canvasEdgeCamera.value.moving || !geoms.some(geom => geom.flow)) {
      flowRaf = 0
      clearFlow()
      return
    }
    paintFlow(now)
    flowRaf = requestAnimationFrame(loop)
  }
  flowRaf = requestAnimationFrame(loop)
}

function paintAll(camera: CanvasEdgeCamera) {
  paintBase(camera)
  if (camera.moving) {
    stopFlow()
    clearFlow()
    hideCut()
    return
  }
  ensureFlow()
}

function hideCut() {
  window.clearTimeout(cutTimer)
  window.clearTimeout(leaveTimer)
  cut.show = false
  cut.id = ''
  if (hoverId) {
    hoverId = ''
    paintBase()
  }
}

function applyHit(event: PointerEvent) {
  if (!props.canCut || canvasEdgeCamera.value.moving) {
    hideCut()
    return
  }
  const target = event.target
  if (!(target instanceof Element) || target.closest('.vue-flow__node, .canvas-edge__cut, button, a, input, textarea, select')) {
    scheduleLeave()
    return
  }
  const host = flowHost()
  if (!host)
    return
  const camera = canvasEdgeCamera.value
  const zoom = camera.zoom || 1
  const rect = host.getBoundingClientRect()
  const x = (event.clientX - rect.left - camera.x) / zoom
  const y = (event.clientY - rect.top - camera.y) / zoom
  const pool = props.hideEdges ? geoms.filter(geom => geom.live) : geoms
  const hit = pickCanvasEdge(pool, x, y, HIT_PX / zoom)
  if (!hit) {
    scheduleLeave()
    return
  }
  window.clearTimeout(leaveTimer)
  const workspace = host.closest('.canvas-workspace') as HTMLElement | null
  const origin = workspace?.getBoundingClientRect()
  cut.x = event.clientX - (origin?.left || 0) + (hit.x - x) * zoom
  cut.y = event.clientY - (origin?.top || 0) + (hit.y - y) * zoom
  if (hoverId !== hit.geom.id) {
    hoverId = hit.geom.id
    cut.show = false
    window.clearTimeout(cutTimer)
    cutTimer = window.setTimeout(() => {
      if (hoverId === hit.geom.id)
        cut.show = true
    }, 650)
    paintBase()
  }
  cut.id = hit.geom.id
}

function scheduleLeave() {
  window.clearTimeout(cutTimer)
  if (!hoverId && !cut.show)
    return
  window.clearTimeout(leaveTimer)
  leaveTimer = window.setTimeout(() => {
    leaveTimer = 0
    const had = hoverId
    hoverId = ''
    cut.show = false
    cut.id = ''
    if (had)
      paintBase()
  }, 100)
}

function onPointerMove(event: PointerEvent) {
  hitEvent = event
  if (hitRaf)
    return
  hitRaf = requestAnimationFrame(() => {
    hitRaf = 0
    const next = hitEvent
    hitEvent = null
    if (next)
      applyHit(next)
  })
}

function keepCut() {
  window.clearTimeout(leaveTimer)
  window.clearTimeout(cutTimer)
  leaveTimer = 0
  cut.show = true
}

function onCut(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  if (!props.canCut || !cut.id)
    return
  removeEdges([cut.id])
  hideCut()
}

function onCamera(camera: CanvasEdgeCamera) {
  paintAll(camera)
}

watch(model, (next) => {
  geoms = next.geoms
  if (hoverId && !geoms.some(geom => geom.id === hoverId))
    hideCut()
  paintAll(canvasEdgeCamera.value)
}, { flush: 'post' })

watch(() => props.hideEdges, () => {
  paintAll(canvasEdgeCamera.value)
})

onMounted(() => {
  ready.value = true
  if (!canvasEdgeCamera.value.moving)
    publishCanvasEdgeCamera(viewport.value, false)
  bindCanvasEdgeDrawer(onCamera)
  nextTick(() => {
    geoms = model.value.geoms
    const host = flowHost()
    if (host && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => paintAll(canvasEdgeCamera.value))
      resizeObserver.observe(host)
    }
    themeObserver = new MutationObserver(() => paintBase())
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    host?.addEventListener('pointermove', onPointerMove)
    paintAll(canvasEdgeCamera.value)
  })
})

onUnmounted(() => {
  bindCanvasEdgeDrawer(null)
  stopFlow()
  resizeObserver?.disconnect()
  themeObserver?.disconnect()
  flowHost()?.removeEventListener('pointermove', onPointerMove)
  window.clearTimeout(leaveTimer)
  window.clearTimeout(cutTimer)
  if (hitRaf)
    cancelAnimationFrame(hitRaf)
})
</script>

<template>
  <Teleport v-if="ready" to=".canvas-workspace .vue-flow__transformationpane">
    <div ref="wrapRef" class="canvas-edge-bitmaps">
      <canvas ref="baseRef" class="canvas-edge-bitmap" />
      <canvas ref="flowRef" class="canvas-edge-bitmap canvas-edge-bitmap--flow" />
    </div>
  </Teleport>
  <div
    v-show="cut.show"
    class="canvas-edge__cut is-layer"
    :style="{ transform: `translate(${cut.x}px, ${cut.y}px) translate(-50%, -50%)` }"
    @mouseenter="keepCut"
    @mouseleave="scheduleLeave"
  >
    <button type="button" :aria-label="t('断开连线')" @click="onCut" @pointerdown.stop>
      <UIcon name="i-lucide-scissors" class="size-3.5" />
    </button>
  </div>
</template>
