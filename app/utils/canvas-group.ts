import type { Node } from '@vue-flow/core'
import { alignedPositions, distributedPositions, type NodeAlignMode, type NodeDistributeAxis } from '~/utils/canvas-align'
import { canvasStageSize, type CanvasNodeData } from '~/utils/canvas-node-kinds'

export type CanvasGroupLayout = 'grid' | 'row' | 'col'

export type CanvasGroupData = {
  kind: 'group'
  label: string
  color: string
  layout: CanvasGroupLayout
  collapsed?: boolean
  expandedW?: number
  expandedH?: number
  /** 有这个字段就是分镜组：grid 排版按 cols 列铺，工具条可改列数或转回普通组 */
  storyboard?: { cols: number }
  /** 单独锁定：组不能拖、不能删，随画布保存 */
  locked?: boolean
}

/**
 * 分镜组列数：夹到 1..n；没指定时与拼接默认同口径（4 张 2 列、9 张 3 列，其余 ceil(sqrt(n))）。
 */
export function storyboardCols(n: number, requested?: number) {
  const count = Math.max(1, Math.floor(n) || 1)
  const wanted = Number(requested)
  const cols = Number.isFinite(wanted) && wanted > 0 ? Math.floor(wanted) : Math.ceil(Math.sqrt(count))
  return Math.min(count, Math.max(1, cols))
}

export type CanvasFlowData = CanvasNodeData | CanvasGroupData

export type CanvasFlowNode = Omit<Node<CanvasFlowData>, 'domAttributes'> & {
  /** vue-flow GraphNode 的 domAttributes 类型与 motion-v 扩展冲突，这里放宽 */
  domAttributes?: Record<string, unknown>
  parentNode?: string
  extent?: 'parent'
  expandParent?: boolean
  hidden?: boolean
  width?: number
  height?: number
  style?: Record<string, string | number>
  selected?: boolean
}

export function isContentNode(node: CanvasFlowNode | undefined | null): node is CanvasFlowNode & { data: CanvasNodeData } {
  return Boolean(node?.data && node.data.kind !== 'group')
}

export const GROUP_COLORS = [
  '#ececee',
  '#e8e4dc',
  '#dbe4f0',
  '#dceee4',
  '#f3e4d4',
  '#ece0f0',
  '#2a2a2e',
]

export const GROUP_LAYOUTS: { id: CanvasGroupLayout, label: string, icon: string }[] = [
  { id: 'col', label: '垂直布局', icon: 'i-lucide-list' },
  { id: 'row', label: '水平布局', icon: 'i-lucide-ellipsis' },
]

export function isGroupNode(node: CanvasFlowNode | undefined | null): node is CanvasFlowNode & { data: CanvasGroupData } {
  return node?.data?.kind === 'group'
}

/** 节点自己带了 locked（不含父组继承） */
export function isSelfLocked(node: CanvasFlowNode | undefined | null): boolean {
  return Boolean(node?.data && 'locked' in node.data && node.data.locked)
}

function nodeById(all: CanvasFlowNode[] | Map<string, CanvasFlowNode> | undefined, id: string) {
  if (!all)
    return undefined
  return Array.isArray(all) ? all.find(item => item.id === id) : all.get(id)
}

/** 节点或任一祖先组带了 locked：拖不动、删不掉，对齐 / 连线也跳过 */
export function isNodeLocked(
  node: CanvasFlowNode | undefined | null,
  all?: CanvasFlowNode[] | Map<string, CanvasFlowNode>,
): boolean {
  let current: CanvasFlowNode | undefined | null = node
  const seen = new Set<string>()
  while (current) {
    if (isSelfLocked(current))
      return true
    const parentId = current.parentNode
    if (!parentId || seen.has(current.id))
      break
    seen.add(current.id)
    current = nodeById(all, parentId)
  }
  return false
}

export function defaultGroupColor() {
  if (import.meta.client && document.documentElement.classList.contains('dark'))
    return '#2a2a2e'
  return '#ececee'
}

export function nodeSize(node: CanvasFlowNode) {
  const dim = (node as { dimensions?: { width?: number, height?: number } }).dimensions
  const stage = isContentNode(node) ? canvasStageSize(node.data.kind) : null
  const fallbackW = isGroupNode(node) ? 360 : (stage?.w || 220)
  const fallbackH = isGroupNode(node) ? 220 : (stage?.h || 140)
  const styleW = Number.parseFloat(String(node.style?.width))
  const styleH = Number.parseFloat(String(node.style?.height))
  return {
    w: node.width || (Number.isFinite(styleW) ? styleW : 0) || dim?.width || fallbackW,
    h: node.height || (Number.isFinite(styleH) ? styleH : 0) || dim?.height || fallbackH,
  }
}

export function absPosition(node: CanvasFlowNode, list: CanvasFlowNode[]) {
  const pos = { x: node.position.x, y: node.position.y }
  let pid = node.parentNode
  const seen = new Set<string>()
  while (pid && !seen.has(pid)) {
    seen.add(pid)
    const parent = list.find(item => item.id === pid)
    if (!parent)
      break
    pos.x += parent.position.x
    pos.y += parent.position.y
    pid = parent.parentNode
  }
  return pos
}

export function nodesBounds(list: CanvasFlowNode[], all: CanvasFlowNode[]) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of list) {
    const pos = absPosition(node, all)
    const box = nodeSize(node)
    minX = Math.min(minX, pos.x)
    minY = Math.min(minY, pos.y)
    maxX = Math.max(maxX, pos.x + box.w)
    maxY = Math.max(maxY, pos.y + box.h)
  }
  if (!Number.isFinite(minX))
    return null
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/** 把包围盒塞进视口：按留白算缩放，封顶避免单个节点被放得过大 */
export function fitBoxZoom(box: { w: number, h: number }, view: { w: number, h: number }, padding = 0.2, maxZoom = 1.5) {
  if (box.w <= 0 || box.h <= 0 || view.w <= 0 || view.h <= 0)
    return 1
  const ratio = Math.max(0.2, 1 - padding * 2)
  return Math.min((view.w * ratio) / box.w, (view.h * ratio) / box.h, maxZoom)
}

export function setGroupSize(node: CanvasFlowNode, w: number, h: number) {
  node.width = w
  node.height = h
  node.style = {
    ...(node.style || {}),
    width: `${w}px`,
    height: `${h}px`,
  }
  const dim = (node as { dimensions?: { width?: number, height?: number } }).dimensions
  if (dim) {
    dim.width = w
    dim.height = h
  }
}

export const COLLAPSED_THUMB = 84
export const COLLAPSED_GAP = 8
export const COLLAPSED_PAD = 12

export function collapseLayoutForKids(kids: { position: { x: number, y: number } }[], fallback: CanvasGroupLayout = 'grid'): CanvasGroupLayout {
  if (fallback === 'col' || fallback === 'row')
    return fallback
  if (kids.length < 2)
    return 'row'
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const kid of kids) {
    minX = Math.min(minX, kid.position.x)
    maxX = Math.max(maxX, kid.position.x)
    minY = Math.min(minY, kid.position.y)
    maxY = Math.max(maxY, kid.position.y)
  }
  return (maxY - minY) > (maxX - minX) ? 'col' : 'row'
}

export function collapsedGroupSize(count: number, layout: CanvasGroupLayout = 'grid') {
  const n = Math.max(1, count)
  if (layout === 'col') {
    return {
      w: COLLAPSED_PAD * 2 + COLLAPSED_THUMB,
      h: COLLAPSED_PAD * 2 + n * COLLAPSED_THUMB + Math.max(0, n - 1) * COLLAPSED_GAP,
    }
  }
  if (layout === 'row') {
    return {
      w: COLLAPSED_PAD * 2 + n * COLLAPSED_THUMB + Math.max(0, n - 1) * COLLAPSED_GAP,
      h: COLLAPSED_PAD * 2 + COLLAPSED_THUMB,
    }
  }
  const cols = Math.min(4, n)
  const rows = Math.ceil(n / cols)
  return {
    w: COLLAPSED_PAD * 2 + cols * COLLAPSED_THUMB + Math.max(0, cols - 1) * COLLAPSED_GAP,
    h: COLLAPSED_PAD * 2 + rows * COLLAPSED_THUMB + Math.max(0, rows - 1) * COLLAPSED_GAP,
  }
}

export function layoutGroupChildren(group: CanvasFlowNode, kids: CanvasFlowNode[], mode: CanvasGroupLayout, colsOverride?: number) {
  const gap = 16
  const pad = 28
  if (!kids.length) {
    setGroupSize(group, 360, 220)
    return
  }
  const boxes = kids.map(node => ({ node, ...nodeSize(node) }))
  if (mode === 'row') {
    let x = pad
    let maxH = 0
    for (const item of boxes) {
      item.node.position = { x, y: pad }
      x += item.w + gap
      maxH = Math.max(maxH, item.h)
    }
    setGroupSize(group, x - gap + pad, maxH + pad * 2)
    return
  }
  if (mode === 'col') {
    let y = pad
    let maxW = 0
    for (const item of boxes) {
      item.node.position = { x: pad, y }
      y += item.h + gap
      maxW = Math.max(maxW, item.w)
    }
    setGroupSize(group, maxW + pad * 2, y - gap + pad)
    return
  }
  const wanted = colsOverride ?? (isGroupNode(group) ? group.data.storyboard?.cols : undefined)
  const cols = wanted ? storyboardCols(boxes.length, wanted) : Math.max(2, Math.ceil(Math.sqrt(boxes.length)))
  let maxBottom = pad
  let maxRight = pad
  boxes.forEach((item, index) => {
    const col = index % cols
    const row = Math.floor(index / cols)
    const cellW = Math.max(...boxes.map(box => box.w))
    const cellH = Math.max(...boxes.map(box => box.h))
    const x = pad + col * (cellW + gap)
    const y = pad + row * (cellH + gap)
    item.node.position = { x, y }
    maxRight = Math.max(maxRight, x + item.w)
    maxBottom = Math.max(maxBottom, y + item.h)
  })
  setGroupSize(group, maxRight + pad, maxBottom + pad)
}

export function duplicateNodeLabel(label: string) {
  const match = label.match(/^(.*) - 副本(?: (\d+))?$/)
  if (!match)
    return `${label} - 副本`
  const next = match[2] ? Number(match[2]) + 1 : 2
  return `${match[1]} - 副本 ${next}`
}

export function setAbsPosition(node: CanvasFlowNode, abs: { x: number, y: number }, all: CanvasFlowNode[]) {
  if (!node.parentNode) {
    node.position = abs
    return
  }
  const parent = all.find(item => item.id === node.parentNode)
  if (!parent) {
    node.position = abs
    return
  }
  const origin = absPosition(parent, all)
  node.position = { x: abs.x - origin.x, y: abs.y - origin.y }
}

export function layoutFreeNodes(list: CanvasFlowNode[], all: CanvasFlowNode[], mode: CanvasGroupLayout) {
  if (!list.length)
    return
  const origin = nodesBounds(list, all)
  const startX = origin?.x ?? 0
  const startY = origin?.y ?? 0
  const gap = 24
  const boxes = [...list]
    .sort((a, b) => {
      const pa = absPosition(a, all)
      const pb = absPosition(b, all)
      return pa.y === pb.y ? pa.x - pb.x : pa.y - pb.y
    })
    .map(node => ({ node, ...nodeSize(node) }))
  if (mode === 'row') {
    let x = startX
    for (const item of boxes) {
      setAbsPosition(item.node, { x, y: startY }, all)
      x += item.w + gap
    }
    return
  }
  if (mode === 'col') {
    let y = startY
    for (const item of boxes) {
      setAbsPosition(item.node, { x: startX, y }, all)
      y += item.h + gap
    }
    return
  }
  const cols = Math.max(2, Math.ceil(Math.sqrt(boxes.length)))
  const cellW = Math.max(...boxes.map(item => item.w))
  const cellH = Math.max(...boxes.map(item => item.h))
  boxes.forEach((item, index) => {
    const col = index % cols
    const row = Math.floor(index / cols)
    setAbsPosition(item.node, {
      x: startX + col * (cellW + gap),
      y: startY + row * (cellH + gap),
    }, all)
  })
}

function flowAlignBoxes(list: CanvasFlowNode[], all: CanvasFlowNode[]) {
  return list.map((node) => {
    const pos = absPosition(node, all)
    const size = nodeSize(node)
    return { id: node.id, node, x: pos.x, y: pos.y, w: size.w, h: size.h }
  })
}

function applyAbsPositions(list: CanvasFlowNode[], all: CanvasFlowNode[], next: Array<{ id: string, x: number, y: number }>) {
  const byId = new Map(list.map(node => [node.id, node]))
  for (const item of next) {
    const node = byId.get(item.id)
    if (node)
      setAbsPosition(node, { x: item.x, y: item.y }, all)
  }
}

/** 多选对齐：按画布绝对坐标对齐边或中线，组内子节点写回相对坐标 */
export function alignFlowNodes(list: CanvasFlowNode[], all: CanvasFlowNode[], mode: NodeAlignMode) {
  if (list.length < 2)
    return
  applyAbsPositions(list, all, alignedPositions(flowAlignBoxes(list, all), mode))
}

/** 多选分布：首尾不动，中间空隙均分 */
export function distributeFlowNodes(list: CanvasFlowNode[], all: CanvasFlowNode[], axis: NodeDistributeAxis) {
  if (list.length < 3)
    return
  applyAbsPositions(list, all, distributedPositions(flowAlignBoxes(list, all), axis))
}

/** 方向键微移：跳过锁定节点，组内子节点写回相对坐标 */
export function nudgeFlowNodes(list: CanvasFlowNode[], all: CanvasFlowNode[], dx: number, dy: number) {
  if (!dx && !dy)
    return
  const moving = new Set(list.filter(item => !isNodeLocked(item, all)).map(item => item.id))
  if (!moving.size)
    return
  for (const node of list) {
    if (!moving.has(node.id))
      continue
    if (node.parentNode && moving.has(node.parentNode))
      continue
    const pos = absPosition(node, all)
    setAbsPosition(node, { x: pos.x + dx, y: pos.y + dy }, all)
  }
}
