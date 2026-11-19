/** 跟 @vue-flow/core 的 getBezierPath 同一套控制点，曲率 0.4。画布描线不再走 SVG。 */

export const CANVAS_EDGE_CURVATURE = 0.4
/** 选中超过这么多张就不再画流动光，跟原来的连线组件一致 */
export const CANVAS_EDGE_FLOW_MAX_SELECTED = 6

export type CanvasEdgeHandle = {
  id?: string | null
  x?: number
  y?: number
  width?: number
  height?: number
  position?: string
}

export type CanvasEdgeNodeBox = {
  id: string
  x: number
  y: number
  w: number
  h: number
  hidden?: boolean
  selected?: boolean
  source?: CanvasEdgeHandle[]
  target?: CanvasEdgeHandle[]
}

export type CanvasEdgeRef = {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

export type CanvasEdgeCubic = {
  x0: number
  y0: number
  c1x: number
  c1y: number
  c2x: number
  c2y: number
  x1: number
  y1: number
}

export type CanvasEdgeGeom = CanvasEdgeCubic & {
  id: string
  source: string
  target: string
  live: boolean
  flow: boolean
  length: number
}

export type CanvasEdgeView = {
  left: number
  top: number
  right: number
  bottom: number
}

/** 屏幕上至少 1px，缩得很小也不会淡成看不见。放大后仍按 1.25 个画布像素跟着变粗。 */
export function canvasEdgeScreenWidth(zoom: number, flowWidth = 1.25, minScreen = 1) {
  const z = zoom || 1
  return Math.max(flowWidth, minScreen / z)
}

export function canvasEdgeControlOffset(distance: number, curvature = CANVAS_EDGE_CURVATURE) {
  if (distance >= 0)
    return 0.5 * distance
  return curvature * 25 * Math.sqrt(-distance)
}

function control(pos: string, x1: number, y1: number, x2: number, y2: number, curvature: number): [number, number] {
  switch (pos) {
    case 'left':
      return [x1 - canvasEdgeControlOffset(x1 - x2, curvature), y1]
    case 'right':
      return [x1 + canvasEdgeControlOffset(x2 - x1, curvature), y1]
    case 'top':
      return [x1, y1 - canvasEdgeControlOffset(y1 - y2, curvature)]
    case 'bottom':
      return [x1, y1 + canvasEdgeControlOffset(y2 - y1, curvature)]
    default:
      return [x1, y1]
  }
}

export function canvasEdgeCubic(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  sourcePosition = 'right',
  targetPosition = 'left',
  curvature = CANVAS_EDGE_CURVATURE,
): CanvasEdgeCubic {
  const [c1x, c1y] = control(sourcePosition, sourceX, sourceY, targetX, targetY, curvature)
  const [c2x, c2y] = control(targetPosition, targetX, targetY, sourceX, sourceY, curvature)
  return { x0: sourceX, y0: sourceY, c1x, c1y, c2x, c2y, x1: targetX, y1: targetY }
}

export function canvasEdgeCubicPoint(cubic: CanvasEdgeCubic, t: number) {
  const u = 1 - t
  const uu = u * u
  const tt = t * t
  return {
    x: uu * u * cubic.x0 + 3 * uu * t * cubic.c1x + 3 * u * tt * cubic.c2x + tt * t * cubic.x1,
    y: uu * u * cubic.y0 + 3 * uu * t * cubic.c1y + 3 * u * tt * cubic.c2y + tt * t * cubic.y1,
  }
}

/** 控制点盒子包住整条三次曲线，出屏判断不会把穿屏的线漏掉 */
export function canvasEdgeCubicBounds(cubic: CanvasEdgeCubic) {
  return {
    left: Math.min(cubic.x0, cubic.c1x, cubic.c2x, cubic.x1),
    top: Math.min(cubic.y0, cubic.c1y, cubic.c2y, cubic.y1),
    right: Math.max(cubic.x0, cubic.c1x, cubic.c2x, cubic.x1),
    bottom: Math.max(cubic.y0, cubic.c1y, cubic.c2y, cubic.y1),
  }
}

export function canvasEdgeInView(cubic: CanvasEdgeCubic, view: CanvasEdgeView, pad = 0) {
  const box = canvasEdgeCubicBounds(cubic)
  return box.right >= view.left - pad
    && box.left <= view.right + pad
    && box.bottom >= view.top - pad
    && box.top <= view.bottom + pad
}

export function canvasEdgeCubicLength(cubic: CanvasEdgeCubic, steps = 12) {
  let length = 0
  let prev = canvasEdgeCubicPoint(cubic, 0)
  for (let i = 1; i <= steps; i++) {
    const next = canvasEdgeCubicPoint(cubic, i / steps)
    length += Math.hypot(next.x - prev.x, next.y - prev.y)
    prev = next
  }
  return length
}

export function canvasEdgeClosestPoint(cubic: CanvasEdgeCubic, x: number, y: number, steps = 24) {
  const n = Math.max(8, steps)
  let bestT = 0
  let bestD = Infinity
  let best = { x: cubic.x0, y: cubic.y0 }
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const p = canvasEdgeCubicPoint(cubic, t)
    const d = (p.x - x) ** 2 + (p.y - y) ** 2
    if (d < bestD) {
      bestD = d
      bestT = t
      best = p
    }
  }
  const span = 1 / n
  const from = Math.max(0, bestT - span)
  const to = Math.min(1, bestT + span)
  for (let i = 0; i <= 8; i++) {
    const t = from + ((to - from) * i) / 8
    const p = canvasEdgeCubicPoint(cubic, t)
    const d = (p.x - x) ** 2 + (p.y - y) ** 2
    if (d < bestD) {
      bestD = d
      bestT = t
      best = p
    }
  }
  return { x: best.x, y: best.y, t: bestT, dist2: bestD }
}

export function canvasEdgeHandlePoint(
  originX: number,
  originY: number,
  nodeW: number,
  nodeH: number,
  handles: CanvasEdgeHandle[] | undefined,
  handleId: string | null | undefined,
  side: 'left' | 'right',
) {
  const wanted = handleId || null
  const handle = !handles?.length
    ? null
    : ((wanted ? handles.find(item => (item.id ?? null) === wanted) : handles[0]) || null)
  if (!handle) {
    return side === 'right'
      ? { x: originX + nodeW, y: originY + nodeH / 2, position: 'right' }
      : { x: originX, y: originY + nodeH / 2, position: 'left' }
  }
  const position = handle.position || side
  const x = originX + (handle.x || 0)
  const y = originY + (handle.y || 0)
  const width = handle.width || 0
  const height = handle.height || 0
  if (position === 'right')
    return { x: x + width, y: y + height / 2, position }
  if (position === 'top')
    return { x: x + width / 2, y, position }
  if (position === 'bottom')
    return { x: x + width / 2, y: y + height, position }
  return { x, y: y + height / 2, position: 'left' }
}

export function buildCanvasEdgeGeoms(nodes: CanvasEdgeNodeBox[], edges: CanvasEdgeRef[]) {
  const byId = new Map(nodes.map(node => [node.id, node]))
  let selectedCount = 0
  for (const node of nodes) {
    if (node.selected)
      selectedCount += 1
  }
  const flowOn = selectedCount > 0 && selectedCount <= CANVAS_EDGE_FLOW_MAX_SELECTED
  const geoms: CanvasEdgeGeom[] = []
  for (const edge of edges) {
    const source = byId.get(edge.source)
    const target = byId.get(edge.target)
    if (!source || !target || source.hidden || target.hidden)
      continue
    const from = canvasEdgeHandlePoint(source.x, source.y, source.w, source.h, source.source, edge.sourceHandle, 'right')
    const to = canvasEdgeHandlePoint(target.x, target.y, target.w, target.h, target.target, edge.targetHandle, 'left')
    const live = Boolean(source.selected || target.selected)
    const cubic = canvasEdgeCubic(from.x, from.y, to.x, to.y, from.position, to.position)
    const flow = live && flowOn
    geoms.push({
      ...cubic,
      id: edge.id,
      source: edge.source,
      target: edge.target,
      live,
      flow,
      length: flow ? canvasEdgeCubicLength(cubic) : 0,
    })
  }
  return { geoms, selectedCount }
}

export function pickCanvasEdge(geoms: CanvasEdgeGeom[], x: number, y: number, maxDist: number) {
  const max2 = maxDist * maxDist
  let best: { geom: CanvasEdgeGeom, x: number, y: number, dist2: number } | null = null
  for (const geom of geoms) {
    const box = canvasEdgeCubicBounds(geom)
    if (x < box.left - maxDist || x > box.right + maxDist || y < box.top - maxDist || y > box.bottom + maxDist)
      continue
    const hit = canvasEdgeClosestPoint(geom, x, y)
    if (hit.dist2 <= max2 && (!best || hit.dist2 < best.dist2))
      best = { geom, x: hit.x, y: hit.y, dist2: hit.dist2 }
  }
  return best
}
