<script setup lang="ts">
/**
 * 运镜路径的可视化（复刻自 open-director 的 canvas/CameraPathOverlay.tsx，MIT）。
 *
 * 把机位记录下来的节点和它们之间的运动段画到导演视角里：节点是小球，
 * 段是折线（贝塞尔段按曲线采样），控制柄是八面体加一条虚引线。
 *
 * 曲线怎么算全在阶段 1 的 camera-path.ts 里，这里只负责画；导演视角下路径点 / 柄可拖。
 */
import { computed, shallowRef, watchEffect, onBeforeUnmount } from 'vue'
import { BufferAttribute, BufferGeometry, Group, LineBasicMaterial, LineSegments, Plane, Raycaster, Vector2, Vector3 } from 'three'
import type { PerspectiveCamera } from 'three'
import { useTres } from '@tresjs/core'
import type { DirectorCameraShot } from '~/utils/director/schema'
import { buildCameraSegments, getSegmentRenderPoints } from '~/utils/director/camera-path'
import { toLineSegmentPositions, type WirePolyline } from '~/utils/director/camera-wireframe'
import { isLinkedCameraLocked } from '~/utils/director/object-focus'
import { useDirectorStore } from '~/utils/director/use-director-store'

const props = defineProps<{
  camera: DirectorCameraShot
  /** 当前机位的路径画亮一点，其他机位的淡一些 */
  active: boolean
}>()

const store = useDirectorStore()
const { camera: viewCamera, renderer, controls } = useTres()

const writeBlocked = computed(() =>
  store.readonly.value || isLinkedCameraLocked(store.project.value.objects, props.camera.id),
)

const PATH_COLOR = '#ffa94d'
const NODE_COLOR = '#ffd8a8'
const NODE_ACTIVE_COLOR = '#ffa94d'
const HANDLE_COLOR = '#c3f2a4'
const NODE_RADIUS = 0.11
const HANDLE_RADIUS = 0.07

const nodes = computed(() => props.camera.nodes ?? [])

/** 段表可能没存，按节点现推一份 —— 和求值时用的是同一个函数 */
const segments = computed(() => buildCameraSegments(nodes.value, props.camera.segments))

/** 路径折线：直线段两点，贝塞尔段按曲线采样 */
const pathPolylines = computed<WirePolyline[]>(() => {
  const result: WirePolyline[] = []
  for (const segment of segments.value) {
    const from = nodes.value.find(node => node.id === segment.fromNodeId)
    const to = nodes.value.find(node => node.id === segment.toNodeId)
    if (!from || !to)
      continue
    result.push(getSegmentRenderPoints(from, to, segment))
  }
  return result
})

/** 控制柄的引线：从节点连到它的手柄，不然手柄浮在空中看不出归属 */
const handlePolylines = computed<WirePolyline[]>(() => {
  const result: WirePolyline[] = []
  for (const segment of segments.value) {
    if (segment.curveMode !== 'bezier')
      continue
    const from = nodes.value.find(node => node.id === segment.fromNodeId)
    const to = nodes.value.find(node => node.id === segment.toNodeId)
    if (from && segment.handleOut)
      result.push([from.position, segment.handleOut])
    if (to && segment.handleIn)
      result.push([to.position, segment.handleIn])
  }
  return result
})

const handleItems = computed(() => segments.value.flatMap((segment) => {
  if (segment.curveMode !== 'bezier')
    return []
  const items: Array<{ id: string, segmentId: string, which: 'in' | 'out', position: [number, number, number] }> = []
  if (segment.handleOut)
    items.push({ id: `${segment.id}-out`, segmentId: segment.id, which: 'out', position: segment.handleOut })
  if (segment.handleIn)
    items.push({ id: `${segment.id}-in`, segmentId: segment.id, which: 'in', position: segment.handleIn })
  return items
}))

const groupRef = shallowRef<Group | null>(null)
const pathLines = shallowRef<LineSegments | null>(null)
const handleLines = shallowRef<LineSegments | null>(null)

function buildLines(polylines: WirePolyline[], color: string, opacity: number) {
  if (!polylines.length)
    return null
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(toLineSegmentPositions(polylines), 3))
  return new LineSegments(geometry, new LineBasicMaterial({ color, transparent: true, opacity }))
}

function dispose(item: LineSegments | null) {
  if (!item)
    return
  item.geometry.dispose()
  ;(item.material as LineBasicMaterial).dispose()
}

watchEffect(() => {
  dispose(pathLines.value)
  dispose(handleLines.value)
  pathLines.value = buildLines(pathPolylines.value, PATH_COLOR, props.active ? 0.95 : 0.4)
  handleLines.value = buildLines(handlePolylines.value, HANDLE_COLOR, props.active ? 0.7 : 0.3)
})

onBeforeUnmount(() => {
  dispose(pathLines.value)
  dispose(handleLines.value)
  stopDrag()
})

type DragKind =
  | { kind: 'node', nodeId: string }
  | { kind: 'handle', segmentId: string, which: 'in' | 'out' }

const dragPlane = new Plane()
const raycaster = new Raycaster()
const ndc = new Vector2()
const hit = new Vector3()
let dragging: DragKind | null = null
let orbitWasEnabled: boolean | null = null

function orbitControl() {
  const raw = controls as { value?: { enabled?: boolean }, enabled?: boolean } | undefined
  return raw?.value ?? raw
}

function setOrbitEnabled(on: boolean) {
  const orbit = orbitControl()
  if (orbit && typeof orbit.enabled === 'boolean')
    orbit.enabled = on
}

function pointerToPoint(event: PointerEvent) {
  const cam = (viewCamera as { value?: PerspectiveCamera }).value ?? viewCamera as unknown as PerspectiveCamera
  const gl = (renderer as { value?: { domElement: HTMLCanvasElement } }).value ?? renderer as unknown as { domElement: HTMLCanvasElement }
  const el = gl?.domElement
  if (!cam || !el)
    return null
  const rect = el.getBoundingClientRect()
  ndc.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  )
  raycaster.setFromCamera(ndc, cam)
  return raycaster.ray.intersectPlane(dragPlane, hit) ? hit.clone() : null
}

function nativePointer(event: { nativeEvent?: PointerEvent, event?: PointerEvent } | PointerEvent) {
  if (event instanceof PointerEvent)
    return event
  return event.nativeEvent ?? event.event
}

function beginDrag(event: { point?: Vector3, stopPropagation?: () => void, nativeEvent?: PointerEvent, event?: PointerEvent } | PointerEvent, kind: DragKind) {
  if (writeBlocked.value || store.state.value.viewMode !== 'director')
    return
  const point = 'point' in event ? event.point : undefined
  const native = nativePointer(event)
  if (!point || !native)
    return
  event.stopPropagation?.()
  native.preventDefault()
  const cam = (viewCamera as { value?: PerspectiveCamera }).value ?? viewCamera as unknown as PerspectiveCamera
  if (!cam)
    return
  const dir = new Vector3()
  cam.getWorldDirection(dir)
  dragPlane.setFromNormalAndCoplanarPoint(dir, point)
  dragging = kind
  const orbit = orbitControl()
  orbitWasEnabled = typeof orbit?.enabled === 'boolean' ? orbit.enabled : null
  setOrbitEnabled(false)
  store.beginBatch()
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragUp)
  window.addEventListener('pointercancel', onDragUp)
}

function toLocal(point: Vector3): [number, number, number] {
  const local = groupRef.value ? groupRef.value.worldToLocal(point.clone()) : point
  return [local.x, local.y, local.z]
}

function applyDrag(point: Vector3) {
  if (!dragging)
    return
  const next = toLocal(point)
  if (dragging.kind === 'node') {
    store.updateCameraNode(props.camera.id, dragging.nodeId, { position: next })
    return
  }
  store.updateCameraSegment(props.camera.id, dragging.segmentId, dragging.which === 'out'
    ? { handleOut: next }
    : { handleIn: next })
}

function onDragMove(event: PointerEvent) {
  const point = pointerToPoint(event)
  if (point)
    applyDrag(point)
}

function stopDrag() {
  if (!dragging)
    return
  dragging = null
  store.endBatch()
  if (orbitWasEnabled !== null)
    setOrbitEnabled(orbitWasEnabled)
  orbitWasEnabled = null
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragUp)
  window.removeEventListener('pointercancel', onDragUp)
}

function onDragUp() {
  stopDrag()
}

function onNodeDown(event: any, nodeId: string) {
  beginDrag(event, { kind: 'node', nodeId })
}

function onHandleDown(event: any, segmentId: string, which: 'in' | 'out') {
  beginDrag(event, { kind: 'handle', segmentId, which })
}
</script>

<template>
  <TresGroup v-if="nodes.length" ref="groupRef">
    <primitive v-if="pathLines" :object="pathLines" />
    <primitive v-if="handleLines" :object="handleLines" />

    <TresMesh
      v-for="node in nodes"
      :key="node.id"
      :position="node.position"
      @pointerdown.stop="onNodeDown($event, node.id)"
    >
      <TresSphereGeometry :args="[NODE_RADIUS, 20, 20]" />
      <TresMeshBasicMaterial :color="active ? NODE_ACTIVE_COLOR : NODE_COLOR" />
    </TresMesh>

    <TresMesh
      v-for="handle in handleItems"
      :key="handle.id"
      :position="handle.position"
      @pointerdown.stop="onHandleDown($event, handle.segmentId, handle.which)"
    >
      <TresOctahedronGeometry :args="[HANDLE_RADIUS, 0]" />
      <TresMeshBasicMaterial :color="HANDLE_COLOR" />
    </TresMesh>
  </TresGroup>
</template>
