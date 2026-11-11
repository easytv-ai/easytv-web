import type { InjectionKey, ShallowRef } from 'vue'
import {
  collapseLayoutForKids,
  groupThumbOf,
  isGroupNode,
  isNodeLocked,
  type CanvasFlowNode,
  type CanvasGroupLayout,
  type GroupThumb,
} from '~/utils/canvas-group'
import type { CanvasMarkBox, CanvasMarkElement, CanvasMarkPick } from '~/utils/canvas-mark'

export type CanvasNodeMarkBox = {
  id: string
  name: string
  box: CanvasMarkBox
}

export type CanvasGroupView = {
  layout: CanvasGroupLayout
  thumbs: GroupThumb[]
}

export type CanvasNodeView = {
  locked: Record<string, true>
  kindNo: Record<string, number>
  selected: Record<string, true>
  marks: Record<string, CanvasNodeMarkBox[]>
  groups: Record<string, CanvasGroupView>
}

export const EMPTY_CANVAS_NODE_VIEW: CanvasNodeView = {
  locked: {},
  kindNo: {},
  selected: {},
  marks: {},
  groups: {},
}

export const CANVAS_NODE_VIEW_KEY: InjectionKey<ShallowRef<CanvasNodeView>> = Symbol('canvas-node-view')
export const CANVAS_ZOOM_KEY: InjectionKey<() => number> = Symbol('canvas-zoom')

const NUMBERED_KINDS = new Set(['text', 'image', 'video', 'audio'])

function kindOf(node: CanvasFlowNode) {
  return node.data && 'kind' in node.data ? String(node.data.kind || '') : ''
}

/**
 * 不含坐标：拖节点时 stamp 不变，工作区就不会换掉整份索引、卡片也就不会跟着重绘。
 */
export function canvasNodeViewStamp(nodes: CanvasFlowNode[], markPick?: CanvasMarkPick | null) {
  const pick = markPick?.open
    ? `${markPick.analyzingId}\u0002${(markPick.baselineIds || []).join(',')}`
    : ''
  const rows = nodes.map((node) => {
    const data = node.data as {
      kind?: string
      locked?: boolean
      collapsed?: boolean
      layout?: string
      content?: string
      previewUrl?: string
      color?: string
      markElements?: CanvasMarkElement[]
      thumbs?: GroupThumb[]
    } | undefined
    const kind = data?.kind || ''
    const visual = kind === 'image' || kind === 'video' || kind === 'director'
      ? `${data?.content || ''}\u0001${data?.previewUrl || ''}`
      : ''
    const groupedText = node.parentNode && kind === 'text' ? (data?.content || '') : ''
    const marks = (data?.markElements || []).map(item => `${item.id}:${item.sourceNodeId}`).join(',')
    return [
      node.id,
      node.parentNode || '',
      node.selected ? '1' : '0',
      kind,
      data?.locked ? '1' : '0',
      data?.collapsed ? '1' : '0',
      data?.layout || '',
      visual,
      groupedText,
      marks,
    ].join('\u0001')
  })
  return `${rows.join('\n')}\n${pick}`
}

function numberedKindIndex(nodes: CanvasFlowNode[]) {
  const buckets = new Map<string, CanvasFlowNode[]>()
  for (const node of nodes) {
    const kind = kindOf(node)
    if (!NUMBERED_KINDS.has(kind))
      continue
    const list = buckets.get(kind)
    if (list)
      list.push(node)
    else
      buckets.set(kind, [node])
  }
  const kindNo: Record<string, number> = {}
  for (const list of buckets.values()) {
    list.sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
    list.forEach((node, index) => {
      kindNo[node.id] = index + 1
    })
  }
  return kindNo
}

function markBoxesBySource(nodes: CanvasFlowNode[], markPick?: CanvasMarkPick | null) {
  const marks: Record<string, CanvasNodeMarkBox[]> = {}
  if (!markPick?.open)
    return marks
  const baseline = new Set(markPick.baselineIds ?? [])
  for (const node of nodes) {
    const items = ((node.data as { markElements?: CanvasMarkElement[] } | undefined)?.markElements) || []
    for (const item of items) {
      if (!item.sourceNodeId || baseline.has(item.id))
        continue
      const list = marks[item.sourceNodeId] || (marks[item.sourceNodeId] = [])
      list.push({ id: item.id, name: item.name, box: item.box })
    }
  }
  return marks
}

function groupViews(nodes: CanvasFlowNode[]) {
  const groups: Record<string, CanvasGroupView> = {}
  const kidsByParent = new Map<string, CanvasFlowNode[]>()
  for (const node of nodes) {
    const parent = node.parentNode
    if (!parent)
      continue
    const list = kidsByParent.get(parent)
    if (list)
      list.push(node)
    else
      kidsByParent.set(parent, [node])
  }
  for (const node of nodes) {
    if (!isGroupNode(node))
      continue
    const kids = kidsByParent.get(node.id) || []
    const layout = collapseLayoutForKids(kids, node.data.layout)
    const live = kids
      .slice()
      .sort((a, b) => {
        if (layout === 'col')
          return a.position.y === b.position.y ? a.position.x - b.position.x : a.position.y - b.position.y
        return a.position.x === b.position.x ? a.position.y - b.position.y : a.position.x - b.position.x
      })
      .map(item => groupThumbOf(item))
    const saved = node.data.thumbs || []
    groups[node.id] = {
      layout,
      thumbs: live.some(item => item.media || item.text) ? live : (saved.length ? saved : live),
    }
  }
  return groups
}

export function buildCanvasNodeView(nodes: CanvasFlowNode[], markPick?: CanvasMarkPick | null): CanvasNodeView {
  const locked: Record<string, true> = {}
  const selected: Record<string, true> = {}
  const byId = new Map(nodes.map(node => [node.id, node]))
  for (const node of nodes) {
    if (node.selected)
      selected[node.id] = true
    if (isNodeLocked(node, byId))
      locked[node.id] = true
  }
  return {
    locked,
    kindNo: numberedKindIndex(nodes),
    selected,
    marks: markBoxesBySource(nodes, markPick),
    groups: groupViews(nodes),
  }
}
