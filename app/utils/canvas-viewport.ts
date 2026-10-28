import type { CanvasViewportLike } from '~/utils/canvas-panel-layout'

export type CanvasSizeLike = { width?: number, height?: number }
export type CanvasRect = { x: number, y: number, w: number, h: number }

/** 视口中心对应的画布坐标（「资产」按钮落点） */
export function canvasCenterFlowPoint(
  viewport: CanvasViewportLike,
  dimensions: CanvasSizeLike,
  offset = { x: 160, y: 110 },
) {
  const z = viewport.zoom || 1
  const w = dimensions.width || 800
  const h = dimensions.height || 600
  return {
    x: (-viewport.x + w / 2) / z - offset.x,
    y: (-viewport.y + h / 2) / z - offset.y,
  }
}

export function canvasClampMenu(
  x: number,
  y: number,
  width = 248,
  height = 460,
  win = { w: typeof window === 'undefined' ? 1200 : window.innerWidth, h: typeof window === 'undefined' ? 800 : window.innerHeight },
) {
  return {
    x: Math.min(Math.max(12, x), win.w - width - 12),
    y: Math.min(Math.max(12, y), win.h - height - 12),
  }
}

export function canvasClampZoomPct(value: number) {
  return Math.min(800, Math.max(15, value))
}

export function canvasViewRect(
  viewport: CanvasViewportLike,
  dimensions: CanvasSizeLike,
  fallback = { w: 800, h: 500 },
): CanvasRect {
  const z = viewport.zoom || 1
  return {
    x: -viewport.x / z,
    y: -viewport.y / z,
    w: (dimensions.width || fallback.w) / z,
    h: (dimensions.height || fallback.h) / z,
  }
}

export function canvasMinimapBox(
  items: CanvasRect[],
  view: CanvasRect,
  pad = 48,
): CanvasRect {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const expand = (x: number, y: number, w: number, h: number) => {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + w)
    maxY = Math.max(maxY, y + h)
  }
  for (const item of items)
    expand(item.x, item.y, item.w, item.h)
  expand(view.x, view.y, view.w, view.h)
  if (!Number.isFinite(minX))
    return { x: 0, y: 0, w: 900, h: 560 }
  return {
    x: minX - pad,
    y: minY - pad,
    w: Math.max(240, maxX - minX + pad * 2),
    h: Math.max(160, maxY - minY + pad * 2),
  }
}

/** 对话落下一组节点时，和上一组之间的空隙。要比整理画布的列距更宽，才看得出是新的一簇。 */
export const INSERT_GROUP_GAP = 160

/** 已有内容时，下一组从包围盒右侧顶对齐接着放；空画布仍用视口中心。 */
export function canvasNextInsertOrigin(
  bounds: CanvasRect | null | undefined,
  fallback: { x: number, y: number },
  gap = INSERT_GROUP_GAP,
) {
  if (!bounds)
    return { x: fallback.x, y: fallback.y }
  return { x: bounds.x + bounds.w + gap, y: bounds.y }
}

/** 整理画布：卡片之间的空隙。要比默认 320×220 的卡片小一截，否则会叠在一起。 */
export const ORGANIZE_GAP_X = 80
export const ORGANIZE_GAP_Y = 64
export const ORGANIZE_FALLBACK_W = 320
export const ORGANIZE_FALLBACK_H = 220

export type CanvasOrganizeNode = {
  id: string
  width?: number
  height?: number
}

function organizeSize(node: CanvasOrganizeNode) {
  return {
    w: Math.max(1, node.width || ORGANIZE_FALLBACK_W),
    h: Math.max(1, node.height || ORGANIZE_FALLBACK_H),
  }
}

function organizeBoxesOverlap(
  a: { x: number, y: number, w: number, h: number },
  b: { x: number, y: number, w: number, h: number },
) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

/**
 * 没连线时摊成宫格：4 张 2 列，再多 3 列。每列取该列最宽、每行取该行最高，避免方图把矮卡压住。
 */
export function canvasOrganizeGrid(
  list: CanvasOrganizeNode[],
  gapX = ORGANIZE_GAP_X,
  gapY = ORGANIZE_GAP_Y,
): Array<{ id: string, x: number, y: number }> {
  const n = list.length
  if (!n)
    return []
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3
  const rows = Math.ceil(n / cols)
  const cells = list.map((node, index) => ({
    id: node.id,
    ...organizeSize(node),
    col: index % cols,
    row: Math.floor(index / cols),
  }))
  const colW = Array.from({ length: cols }, (_, col) => Math.max(0, ...cells.filter(item => item.col === col).map(item => item.w)))
  const rowH = Array.from({ length: rows }, (_, row) => Math.max(0, ...cells.filter(item => item.row === row).map(item => item.h)))
  const xs: number[] = []
  let x = 0
  for (let col = 0; col < cols; col++) {
    xs[col] = x
    x += (colW[col] || 0) + gapX
  }
  const ys: number[] = []
  let y = 0
  for (let row = 0; row < rows; row++) {
    ys[row] = y
    y += (rowH[row] || 0) + gapY
  }
  return cells.map(item => ({ id: item.id, x: xs[item.col] ?? 0, y: ys[item.row] ?? 0 }))
}

/**
 * 按连线从左到右分层；没连线则摊成宫格。
 * 间距按每张卡真实宽高算，不再用固定 280×200（默认卡片已经 320 宽，方图 320 高，固定格子会叠在一起）。
 */
export function canvasOrganizePositions(
  list: CanvasOrganizeNode[],
  edges: Array<{ source: string, target: string }>,
  gapX = ORGANIZE_GAP_X,
  gapY = ORGANIZE_GAP_Y,
): Array<{ id: string, x: number, y: number }> {
  if (!list.length)
    return []
  const ids = new Set(list.map(node => node.id))
  const hasEdge = edges.some(edge => ids.has(edge.source) && ids.has(edge.target))
  if (!hasEdge)
    return canvasOrganizeGrid(list, gapX, gapY)

  const incoming = new Map<string, number>()
  const outgoing = new Map<string, string[]>()
  for (const id of ids) {
    incoming.set(id, 0)
    outgoing.set(id, [])
  }
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target))
      continue
    incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1)
    outgoing.get(edge.source)?.push(edge.target)
  }
  const layer = new Map<string, number>()
  const queue: string[] = []
  for (const node of list) {
    if (!incoming.get(node.id)) {
      layer.set(node.id, 0)
      queue.push(node.id)
    }
  }
  if (!queue.length && list[0]) {
    layer.set(list[0].id, 0)
    queue.push(list[0].id)
  }
  while (queue.length) {
    const id = queue.shift()!
    const current = layer.get(id) || 0
    for (const target of outgoing.get(id) || []) {
      const nextLayer = current + 1
      if (!layer.has(target) || nextLayer > (layer.get(target) || 0)) {
        layer.set(target, nextLayer)
        queue.push(target)
      }
    }
  }
  const sizes = new Map(list.map(node => [node.id, organizeSize(node)]))
  const groups = new Map<number, string[]>()
  for (const node of list) {
    const index = layer.get(node.id) ?? 0
    const group = groups.get(index) || []
    group.push(node.id)
    groups.set(index, group)
  }
  const next: Array<{ id: string, x: number, y: number }> = []
  let x = 0
  for (const index of [...groups.keys()].sort((a, b) => a - b)) {
    const group = groups.get(index) || []
    let y = 0
    let maxW = 0
    for (const id of group) {
      const size = sizes.get(id) || { w: ORGANIZE_FALLBACK_W, h: ORGANIZE_FALLBACK_H }
      next.push({ id, x, y })
      y += size.h + gapY
      maxW = Math.max(maxW, size.w)
    }
    x += maxW + gapX
  }
  return next
}

/** 测试用：整理后的盒子是否互相重叠（贴边不算叠） */
export function canvasOrganizeOverlaps(
  list: CanvasOrganizeNode[],
  placed: Array<{ id: string, x: number, y: number }>,
) {
  const boxes = placed.map((item) => {
    const node = list.find(row => row.id === item.id)
    const size = organizeSize(node || { id: item.id })
    return { id: item.id, x: item.x, y: item.y, w: size.w, h: size.h }
  })
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (organizeBoxesOverlap(boxes[i]!, boxes[j]!))
        return true
    }
  }
  return false
}
