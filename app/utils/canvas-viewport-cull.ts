import {
  buildCanvasSpatialIndex,
  queryCanvasSpatialEdges,
  queryCanvasSpatialNodes,
  type CanvasSpatialIndex,
} from './canvas-spatial-index'

/** 少于这么多张卡片时不裁，避免小画布多一次样式写入 */
export const CANVAS_CULL_MIN_NODES = 16
/** 视口外再留这么多屏。只多留不到半屏，屏幕外的卡片不再跟着画 */
export const CANVAS_CULL_MARGIN_SCREENS = 0.45
/** 可视区离已准备区域还剩这么多像素时就提前补画 */
export const CANVAS_CULL_REVEAL_PAD = 280
/** 一帧里最多改这么多张卡片或连线，避免松手时把整屏样式一次写完 */
export const CANVAS_CULL_FRAME_BUDGET = 24

export type CanvasCullRect = { left: number, top: number, right: number, bottom: number }

export type CanvasCullInput = {
  id: string
  parentId?: string | null
  x: number
  y: number
  w: number
  h: number
  pin?: boolean
  /** 组收起后子节点已被 Vue Flow 卸掉，不参与裁剪 */
  skip?: boolean
}

export type CanvasCullNode = {
  id: string
  x: number
  y: number
  w: number
  h: number
  pin?: boolean
}

export type CanvasCullEdge = {
  id: string
  source: string
  target: string
}

export type CanvasCullPlan = {
  hiddenNodes: Set<string>
  hiddenEdges: Set<string>
}

export type CanvasCullViewport = { x: number, y: number, zoom: number }
export type CanvasCullView = { width: number, height: number }

function emptyPlan(): CanvasCullPlan {
  return { hiddenNodes: new Set(), hiddenEdges: new Set() }
}

/** 屏幕视口（可外扩 marginPx）对应的画布坐标矩形 */
export function canvasFlowViewRect(
  viewport: CanvasCullViewport,
  view: CanvasCullView,
  marginPx: number,
): CanvasCullRect {
  const zoom = viewport.zoom || 1
  const left = (-viewport.x - marginPx) / zoom
  const top = (-viewport.y - marginPx) / zoom
  return {
    left,
    top,
    right: left + (view.width + marginPx * 2) / zoom,
    bottom: top + (view.height + marginPx * 2) / zoom,
  }
}

export function canvasCullNeedsReveal(
  prepared: CanvasCullRect,
  viewport: CanvasCullViewport,
  view: CanvasCullView,
  padPx = CANVAS_CULL_REVEAL_PAD,
) {
  const live = canvasFlowViewRect(viewport, view, padPx)
  return live.left < prepared.left
    || live.top < prepared.top
    || live.right > prepared.right
    || live.bottom > prepared.bottom
}

/** 子节点坐标是相对父组的，裁剪前先换成画布绝对坐标 */
export function canvasAbsBoxes(nodes: CanvasCullInput[]): CanvasCullNode[] {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const at = new Map<string, { x: number, y: number }>()
  const walk = (id: string, seen: Set<string>): { x: number, y: number } => {
    const cached = at.get(id)
    if (cached)
      return cached
    const node = byId.get(id)
    if (!node)
      return { x: 0, y: 0 }
    if (seen.has(id))
      return { x: node.x, y: node.y }
    seen.add(id)
    const parent = node.parentId ? walk(node.parentId, seen) : { x: 0, y: 0 }
    const next = { x: node.x + parent.x, y: node.y + parent.y }
    at.set(id, next)
    return next
  }
  const boxes: CanvasCullNode[] = []
  for (const node of nodes) {
    if (node.skip)
      continue
    const pos = walk(node.id, new Set())
    boxes.push({
      id: node.id,
      x: pos.x,
      y: pos.y,
      w: node.w,
      h: node.h,
      pin: node.pin,
    })
  }
  return boxes
}

/**
 * 用已经建好的格子表决定这一屏要藏哪些卡片和连线。
 * 平移过程中不调用；停稳后查一次，再分批写样式。
 */
export function canvasCullFromIndex(
  index: CanvasSpatialIndex,
  viewport: CanvasCullViewport,
  view: CanvasCullView,
  marginPx: number,
): { plan: CanvasCullPlan, rect: CanvasCullRect } {
  const rect = canvasFlowViewRect(viewport, view, marginPx)
  if (index.nodes.size < CANVAS_CULL_MIN_NODES || view.width < 10 || view.height < 10)
    return { plan: emptyPlan(), rect }
  const shown = new Set<string>()
  for (const node of index.nodes.values()) {
    if (node.pin)
      shown.add(node.id)
  }
  for (const node of queryCanvasSpatialNodes(index, rect))
    shown.add(node.id)
  if (shown.size >= index.nodes.size)
    return { plan: emptyPlan(), rect }
  const hiddenNodes = new Set<string>()
  for (const node of index.nodes.values()) {
    if (!shown.has(node.id))
      hiddenNodes.add(node.id)
  }
  const visibleEdges = queryCanvasSpatialEdges(index, rect, shown)
  const hiddenEdges = new Set<string>()
  for (const id of index.edges.keys()) {
    if (!visibleEdges.has(id))
      hiddenEdges.add(id)
  }
  return { plan: { hiddenNodes, hiddenEdges }, rect }
}

/**
 * 视口外的节点 / 连线只跳过绘制，组件仍挂着。
 * 不走 Vue Flow 的 onlyRenderVisibleElements，避免进出视口反复挂载。
 * 卡片多时先落成格子表再查，结果和逐张测量一致。
 */
export function canvasCullPlan(
  nodes: CanvasCullNode[],
  edges: CanvasCullEdge[],
  viewport: CanvasCullViewport,
  view: CanvasCullView,
  marginPx: number,
): CanvasCullPlan {
  if (nodes.length < CANVAS_CULL_MIN_NODES || view.width < 10 || view.height < 10)
    return emptyPlan()
  return canvasCullFromIndex(buildCanvasSpatialIndex(nodes, edges), viewport, view, marginPx).plan
}

/**
 * 直接写 DOM，不改 Vue 节点数据。
 * content-visibility 不在 Vue Flow 的 style 绑定里，后续补丁不会把它清掉。
 * auto 记住上次真实尺寸，避免裁掉之后 ResizeObserver 把节点量成 0。
 */
export type CanvasCullElements = {
  nodes: Iterable<HTMLElement>
  edges: Iterable<SVGElement>
}

export function applyCanvasCullDom(
  root: ParentNode,
  plan: CanvasCullPlan,
  sizes: Map<string, { w: number, h: number }>,
  budget = Number.POSITIVE_INFINITY,
  elements?: CanvasCullElements,
): 'miss' | 'partial' | 'done' {
  const nodeEls = elements?.nodes ?? root.querySelectorAll<HTMLElement>('.vue-flow__node')
  if (!nodeEls.length && plan.hiddenNodes.size)
    return 'miss'
  let left = budget
  let pending = false
  const take = () => {
    if (left <= 0) {
      pending = true
      return false
    }
    left -= 1
    return true
  }
  for (const el of nodeEls) {
    const id = el.getAttribute('data-id') || ''
    if (!plan.hiddenNodes.has(id)) {
      if (!el.style.contentVisibility)
        continue
      if (!take())
        continue
      el.style.contentVisibility = ''
      el.style.containIntrinsicSize = ''
      continue
    }
    if (el.style.contentVisibility === 'hidden')
      continue
    if (!take())
      continue
    const known = sizes.get(id)
    const w = Math.max(1, Math.round(known?.w || 220))
    const h = Math.max(1, Math.round(known?.h || 140))
    el.style.containIntrinsicSize = `auto ${w}px auto ${h}px`
    el.style.contentVisibility = 'hidden'
  }
  const edgeEls = elements?.edges ?? root.querySelectorAll<SVGElement>('.vue-flow__edge')
  for (const el of edgeEls) {
    const id = el.getAttribute('data-id') || ''
    const next = plan.hiddenEdges.has(id) ? 'none' : ''
    if (el.style.display === next)
      continue
    if (!take())
      continue
    el.style.display = next
  }
  return pending ? 'partial' : 'done'
}

/** 只把进入准备区的卡片画回来，平移过程中不把刚离开的卡片藏掉 */
export function revealCanvasCullDom(
  root: ParentNode,
  shownNodes: Set<string>,
  shownEdges: Set<string>,
  budget = Number.POSITIVE_INFINITY,
  elements?: CanvasCullElements,
): 'partial' | 'done' {
  let left = budget
  let pending = false
  const take = () => {
    if (left <= 0) {
      pending = true
      return false
    }
    left -= 1
    return true
  }
  const nodeEls = elements?.nodes ?? root.querySelectorAll<HTMLElement>('.vue-flow__node')
  for (const el of nodeEls) {
    const id = el.getAttribute('data-id') || ''
    if (!shownNodes.has(id) || !el.style.contentVisibility)
      continue
    if (!take())
      continue
    el.style.contentVisibility = ''
    el.style.containIntrinsicSize = ''
  }
  const edgeEls = elements?.edges ?? root.querySelectorAll<SVGElement>('.vue-flow__edge')
  for (const el of edgeEls) {
    const id = el.getAttribute('data-id') || ''
    if (!shownEdges.has(id) || el.style.display !== 'none')
      continue
    if (!take())
      continue
    el.style.display = ''
  }
  return pending ? 'partial' : 'done'
}
