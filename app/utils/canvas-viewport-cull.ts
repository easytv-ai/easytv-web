/** 少于这么多张卡片时不裁，避免小画布多一次样式写入 */
export const CANVAS_CULL_MIN_NODES = 40
/** 视口外再留这么多屏，快滑一段不会先看到空白 */
export const CANVAS_CULL_MARGIN_SCREENS = 1.35
/** 可视区离已准备区域还剩这么多像素时就提前补画 */
export const CANVAS_CULL_REVEAL_PAD = 280

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

function intersects(node: { x: number, y: number, w: number, h: number }, rect: CanvasCullRect) {
  return node.x < rect.right
    && node.x + node.w > rect.left
    && node.y < rect.bottom
    && node.y + node.h > rect.top
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
 * 视口外的节点 / 连线只跳过绘制，组件仍挂着。
 * 不走 Vue Flow 的 onlyRenderVisibleElements，避免进出视口反复挂载。
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
  const rect = canvasFlowViewRect(viewport, view, marginPx)
  const shown = new Set<string>()
  for (const node of nodes) {
    if (node.pin || intersects(node, rect))
      shown.add(node.id)
  }
  if (shown.size >= nodes.length)
    return emptyPlan()
  const byId = new Map(nodes.map(node => [node.id, node]))
  const hiddenNodes = new Set<string>()
  for (const node of nodes) {
    if (!shown.has(node.id))
      hiddenNodes.add(node.id)
  }
  const hiddenEdges = new Set<string>()
  for (const edge of edges) {
    const source = byId.get(edge.source)
    const target = byId.get(edge.target)
    if (!source || !target)
      continue
    if (shown.has(source.id) || shown.has(target.id))
      continue
    const box = {
      x: Math.min(source.x, target.x),
      y: Math.min(source.y, target.y),
      w: Math.abs(source.x - target.x) + Math.max(source.w, target.w),
      h: Math.abs(source.y - target.y) + Math.max(source.h, target.h),
    }
    if (!intersects(box, rect))
      hiddenEdges.add(edge.id)
  }
  return { hiddenNodes, hiddenEdges }
}

/**
 * 直接写 DOM，不改 Vue 节点数据。
 * content-visibility 不在 Vue Flow 的 style 绑定里，后续补丁不会把它清掉。
 * auto 记住上次真实尺寸，避免裁掉之后 ResizeObserver 把节点量成 0。
 */
export function applyCanvasCullDom(
  root: ParentNode,
  plan: CanvasCullPlan,
  sizes: Map<string, { w: number, h: number }>,
) {
  const nodeEls = root.querySelectorAll<HTMLElement>('.vue-flow__node')
  if (!nodeEls.length && plan.hiddenNodes.size)
    return false
  for (const el of nodeEls) {
    const id = el.getAttribute('data-id') || ''
    if (!plan.hiddenNodes.has(id)) {
      if (el.style.contentVisibility) {
        el.style.contentVisibility = ''
        el.style.containIntrinsicSize = ''
      }
      continue
    }
    if (el.style.contentVisibility === 'hidden')
      continue
    const known = sizes.get(id)
    const w = Math.max(1, Math.round(known?.w || 220))
    const h = Math.max(1, Math.round(known?.h || 140))
    el.style.containIntrinsicSize = `auto ${w}px auto ${h}px`
    el.style.contentVisibility = 'hidden'
  }
  const edgeEls = root.querySelectorAll<SVGElement>('.vue-flow__edge')
  for (const el of edgeEls) {
    const id = el.getAttribute('data-id') || ''
    const next = plan.hiddenEdges.has(id) ? 'none' : ''
    if (el.style.display !== next)
      el.style.display = next
  }
  return true
}

/** 只把进入准备区的卡片画回来，平移过程中不把刚离开的卡片藏掉 */
export function revealCanvasCullDom(root: ParentNode, shownNodes: Set<string>, shownEdges: Set<string>) {
  const nodeEls = root.querySelectorAll<HTMLElement>('.vue-flow__node')
  for (const el of nodeEls) {
    const id = el.getAttribute('data-id') || ''
    if (!shownNodes.has(id) || !el.style.contentVisibility)
      continue
    el.style.contentVisibility = ''
    el.style.containIntrinsicSize = ''
  }
  const edgeEls = root.querySelectorAll<SVGElement>('.vue-flow__edge')
  for (const el of edgeEls) {
    const id = el.getAttribute('data-id') || ''
    if (!shownEdges.has(id) || el.style.display !== 'none')
      continue
    el.style.display = ''
  }
}
