/**
 * 画布存档瘦身。
 *
 * Vue Flow 运行时的边带有 sourceNode / targetNode 整份节点拷贝。
 * 分镜一接多张参考图，JSON.stringify(edges) 就会把角色/场景/分镜反复抄很多遍，整张画布顶过 2MB。
 * 保存只留连线两端的 id，参考关系还在，图文件本身不进 graph。
 */
import { isDirectorProject, sanitizeProjectForSave } from '~/utils/director/persist'
import type { CanvasGraph } from '~/types/creative'

function isInlineMedia(value: string) {
  return value.startsWith('data:') || value.startsWith('blob:')
}

function stripInlineMedia(value: unknown): unknown {
  if (typeof value === 'string')
    return isInlineMedia(value) ? '' : value
  if (Array.isArray(value))
    return value.map(stripInlineMedia)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>))
      out[key] = stripInlineMedia(item)
    return out
  }
  return value
}

function slimStyle(style: unknown) {
  if (!style || typeof style !== 'object')
    return undefined
  const raw = style as Record<string, unknown>
  const next: Record<string, unknown> = {}
  if (raw.width != null)
    next.width = raw.width
  if (raw.height != null)
    next.height = raw.height
  return Object.keys(next).length ? next : undefined
}

function sanitizeNodeData(raw: unknown) {
  const data = raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : {}
  if (data.scene && isDirectorProject(data.scene))
    data.scene = sanitizeProjectForSave(data.scene)
  return stripInlineMedia(data) as Record<string, unknown>
}

function sanitizeNode(raw: unknown) {
  const node = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const next: Record<string, unknown> = {
    id: String(node.id || ''),
    type: node.type || 'easytv',
    position: node.position && typeof node.position === 'object'
      ? node.position
      : { x: 0, y: 0 },
    data: sanitizeNodeData(node.data),
  }
  if (typeof node.width === 'number')
    next.width = node.width
  if (typeof node.height === 'number')
    next.height = node.height
  if (typeof node.parentNode === 'string' && node.parentNode) {
    next.parentNode = node.parentNode
    if (node.extent != null)
      next.extent = node.extent
    if (node.expandParent != null)
      next.expandParent = node.expandParent
  }
  const style = slimStyle(node.style)
  if (style)
    next.style = style
  if (typeof node.zIndex === 'number')
    next.zIndex = node.zIndex
  return next
}

function sanitizeEdge(raw: unknown) {
  const edge = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const next: Record<string, unknown> = {
    id: String(edge.id || `${edge.source}-${edge.target}`),
    source: String(edge.source || ''),
    target: String(edge.target || ''),
    type: edge.type || 'easytv',
  }
  if (edge.sourceHandle != null)
    next.sourceHandle = edge.sourceHandle
  if (edge.targetHandle != null)
    next.targetHandle = edge.targetHandle
  if (edge.animated != null)
    next.animated = edge.animated
  if (edge.label != null)
    next.label = edge.label
  if (edge.data && typeof edge.data === 'object')
    next.data = stripInlineMedia(edge.data)
  return next
}

/** 保存用的 graph：节点只留布局和 data，边只留两端 id，不带 Vue Flow 运行时拷贝 */
export function sanitizeGraphForSave(graph: unknown): CanvasGraph {
  const raw = (graph && typeof graph === 'object' ? graph : {}) as {
    nodes?: unknown[]
    edges?: unknown[]
    viewport?: { x?: number, y?: number, zoom?: number }
  }
  const viewport = raw.viewport || {}
  return {
    nodes: Array.isArray(raw.nodes) ? raw.nodes.map(sanitizeNode) : [],
    edges: Array.isArray(raw.edges) ? raw.edges.map(sanitizeEdge) : [],
    viewport: {
      x: Number(viewport.x) || 0,
      y: Number(viewport.y) || 0,
      zoom: Number(viewport.zoom) || 1,
    },
  }
}
