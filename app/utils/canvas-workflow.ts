/**
 * 工作流模板（L3，API.md 31.1）：把画布上选中的一串节点连同内部连线存成模板，
 * 之后整套发回任意画布。graph 就是节点快照，坐标存相对值，落盘前把下游节点的产物清掉——
 * 模板是配方不是成品，源头素材（上传的参考图等）照留，不然发回去就没得可跑了。
 * 同一份格式也是对话式工作流生成（API.md 32）的 apply_graph 载体。
 */

import { canvasStageSize, type CanvasNodeKind } from '~/utils/canvas-node-kinds'

export type WorkflowNode = {
  id: string
  kind: string
  /** 相对左上角的位置，落到画布时再加偏移 */
  x: number
  y: number
  width?: number
  height?: number
  data: Record<string, any>
}

export type WorkflowEdge = {
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}

export type CanvasWorkflowGraph = {
  version: number
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

/** vue-flow 节点：placeWorkflowGraph + workflowNodesToFlow 之后的产物，能直接塞进 addNodes */
export type WorkflowFlowNode = {
  id: string
  type: 'easytv'
  position: { x: number, y: number }
  width: number
  height: number
  style: Record<string, string>
  data: Record<string, any>
}

export type WorkflowFlowEdge = {
  id: string
  source: string
  target: string
  sourceHandle: string
  targetHandle: string
}

export const WORKFLOW_GRAPH_VERSION = 1
/** 一个工作流最多这么多节点，再多存下来也不好用 */
export const WORKFLOW_NODE_MAX = 60

/** 生成产物字段：下游节点保存时清掉，源头节点保留 */
const RESULT_FIELDS = ['content', 'assetId', 'previewUrl', 'taskId', 'taskStatus', 'taskProgress', 'taskError', 'mediaJobId', 'mediaAction', 'mediaLinkedId', 'composeJobId'] as const

export function hasUpstream(id: string, edges: WorkflowEdge[]) {
  return edges.some(edge => edge.target === id)
}

/** 下游节点（组内有上游连线的）清掉产物，其余原样留着 */
export function clearDownstreamResults(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowNode[] {
  return nodes.map((node) => {
    if (!hasUpstream(node.id, edges))
      return node
    const data = { ...node.data }
    for (const key of RESULT_FIELDS)
      delete data[key]
    return { ...node, data }
  })
}

/** 选区 → 可入库的 graph：坐标归零，只保留组内连线 */
export function buildWorkflowGraph(
  items: Array<{ id: string, kind: string, x: number, y: number, width?: number, height?: number, data: Record<string, any> }>,
  edges: WorkflowEdge[],
): CanvasWorkflowGraph {
  const picked = items.slice(0, WORKFLOW_NODE_MAX)
  const ids = new Set(picked.map(item => item.id))
  const inner = edges
    .filter(edge => ids.has(edge.source) && ids.has(edge.target))
    .map(edge => ({
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle || 'out',
      targetHandle: edge.targetHandle || 'in',
    }))
  const minX = picked.length ? Math.min(...picked.map(item => item.x)) : 0
  const minY = picked.length ? Math.min(...picked.map(item => item.y)) : 0
  const nodes = picked.map(item => ({
    id: item.id,
    kind: item.kind,
    x: Math.round(item.x - minX),
    y: Math.round(item.y - minY),
    width: item.width,
    height: item.height,
    data: item.data,
  }))
  return {
    version: WORKFLOW_GRAPH_VERSION,
    nodes: clearDownstreamResults(nodes, inner),
    edges: inner,
  }
}

export function isUsableWorkflowGraph(graph?: CanvasWorkflowGraph | null): graph is CanvasWorkflowGraph {
  return !!graph && Array.isArray(graph.nodes) && graph.nodes.length > 0
}

/** 发回画布：按新 id 重排，位置落到 origin */
export function placeWorkflowGraph(graph: CanvasWorkflowGraph, origin: { x: number, y: number }, newId: (kind: string) => string) {
  const idMap = new Map<string, string>()
  const nodes = graph.nodes.map((node) => {
    const id = newId(node.kind)
    idMap.set(node.id, id)
    return {
      ...node,
      id,
      x: origin.x + (node.x || 0),
      y: origin.y + (node.y || 0),
    }
  })
  const edges = (graph.edges || [])
    .map(edge => ({
      ...edge,
      source: idMap.get(edge.source) || '',
      target: idMap.get(edge.target) || '',
    }))
    .filter(edge => edge.source && edge.target)
  return { nodes, edges, idMap }
}

/**
 * 模板格式 → vue-flow 节点 / 连线（API.md 32 的 apply_graph 落图，契约 3.5）。
 * placeWorkflowGraph 产出的是模板格式（x/y/kind/data），塞不进 nodes，得先过这一层。
 * 宽高缺省取 canvasStageSize(kind)，与 useCanvasAddNode 建节点的口径一致。
 */
export function workflowNodesToFlow(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): { nodes: WorkflowFlowNode[], edges: WorkflowFlowEdge[] } {
  return {
    nodes: (nodes || []).map((node) => {
      const stage = canvasStageSize(node.kind as CanvasNodeKind)
      const width = node.width ?? stage?.w ?? 320
      const height = node.height ?? stage?.h ?? 220
      return {
        id: node.id,
        type: 'easytv' as const,
        position: { x: node.x || 0, y: node.y || 0 },
        width,
        height,
        style: { width: `${width}px`, height: `${height}px` },
        data: {
          ...node.data,
          // kind/mode/content/prompt/label 是 CanvasNodeData 的必填项，缺了卡片渲染不出来
          kind: node.kind,
          mode: node.data?.mode ?? 'idle',
          content: node.data?.content ?? '',
          prompt: node.data?.prompt ?? '',
          label: node.data?.label ?? node.id,
        },
      }
    }),
    edges: (edges || []).map(edge => ({
      id: `e-${edge.source}-${edge.target}-${Date.now()}`,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle || 'out',
      targetHandle: edge.targetHandle || 'in',
    })),
  }
}

/**
 * apply_graph 落图（契约 3.5）：先按新 id 与偏移重排（placeWorkflowGraph），再转成 vue-flow 节点 / 连线。
 * CanvasWorkspace.applyAssistChanges 的 apply_graph 分支与单测共用这一条路径，保证「一次撤销回到原状」的口径一致。
 */
export function applyWorkflowGraph(
  graph: CanvasWorkflowGraph,
  origin: { x: number, y: number },
  newId: (kind: string) => string,
): { nodes: WorkflowFlowNode[], edges: WorkflowFlowEdge[], idMap: Map<string, string> } {
  const placed = placeWorkflowGraph(graph, origin, newId)
  const flow = workflowNodesToFlow(placed.nodes, placed.edges)
  return { ...flow, idMap: placed.idMap }
}

/** 封面取组内第一张有产物的图 */
export function workflowCover(nodes: WorkflowNode[]) {
  const hit = nodes.find(node => node.kind === 'image' && typeof node.data?.content === 'string' && /^https?:/i.test(node.data.content))
  return hit ? String(hit.data.content) : ''
}

/** 默认名：按节点类型给个能认出来的名字，如「图片 → 视频 工作流」 */
export function defaultWorkflowName(nodes: WorkflowNode[], tr: (key: string) => string = key => key) {
  const order = ['text', 'image', 'video', 'audio']
  const kinds = order.filter(kind => nodes.some(node => node.kind === kind))
  if (!kinds.length)
    return tr('我的工作流')
  const label: Record<string, string> = {
    text: tr('文本'),
    image: tr('图片'),
    video: tr('视频'),
    audio: tr('音频'),
  }
  return `${kinds.map(kind => label[kind] || kind).join(' → ')} ${tr('工作流')}`
}
