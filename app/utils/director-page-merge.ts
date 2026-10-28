/**
 * 导演台独立页保存冲突时的合并。
 *
 * 导演台页只拥有画布的一小块：导演台节点的 scene / previewUrl、本页送回画布的截图 / 运镜视频节点与连线、
 * 本页断开的全景图连线。版本冲突时把这几样叠到服务端最新 graph 上再存，
 * 不用整张旧 graph 覆盖掉别处（画布页 / 向导）的新编辑。
 */
import type { CanvasGraph } from '~/types/creative'

export type DirectorPageEdits = {
  nodeId: string
  addedNodeIds: Set<string>
  addedEdgeIds: Set<string>
  removedEdgeIds: Set<string>
}

type AnyNode = { id: string, data?: Record<string, any> } & Record<string, any>
type AnyEdge = { id: string | number, source: string, target: string } & Record<string, any>

/** 返回合并后的 graph；最新版里导演台节点已被删掉时返回 null（没有可以落脚的地方）。 */
export function mergeDirectorEdits(latest: CanvasGraph, mine: CanvasGraph, edits: DirectorPageEdits): CanvasGraph | null {
  const next = JSON.parse(JSON.stringify(latest)) as CanvasGraph
  const nodes = (next.nodes ?? []) as AnyNode[]
  const myNodes = (mine.nodes ?? []) as AnyNode[]
  const target = nodes.find(node => node.id === edits.nodeId)
  const own = myNodes.find(node => node.id === edits.nodeId)
  if (!target || !own)
    return null
  target.data = { ...(target.data ?? {}), scene: own.data?.scene, previewUrl: own.data?.previewUrl }

  const edges = ((next.edges ?? []) as AnyEdge[]).filter(edge => !edits.removedEdgeIds.has(String(edge.id)))
  const renamed = new Map<string, string>()
  for (const node of myNodes) {
    if (!edits.addedNodeIds.has(node.id))
      continue
    let id = node.id
    // 别处同时加了同名节点（image-N 按最大序号递增，两边可能撞号）：换一个没用过的 id
    if (nodes.some(item => item.id === id)) {
      id = uniqueId(node.id, nodes)
      renamed.set(node.id, id)
    }
    nodes.push({ ...JSON.parse(JSON.stringify(node)), id })
  }
  for (const node of nodes) {
    const parent = node.parentNode
    if (parent && renamed.has(parent))
      node.parentNode = renamed.get(parent)
  }
  for (const edge of (mine.edges ?? []) as AnyEdge[]) {
    if (!edits.addedEdgeIds.has(String(edge.id)))
      continue
    const source = renamed.get(edge.source) ?? edge.source
    const targetId = renamed.get(edge.target) ?? edge.target
    if (!nodes.some(item => item.id === source) || !nodes.some(item => item.id === targetId))
      continue
    const touched = renamed.has(edge.source) || renamed.has(edge.target)
    const id = touched ? `e-${source}-${targetId}` : String(edge.id)
    if (edges.some(item => String(item.id) === id))
      continue
    edges.push({ ...edge, id, source, target: targetId })
  }
  next.nodes = nodes as CanvasGraph['nodes']
  next.edges = edges as CanvasGraph['edges']
  return next
}

function uniqueId(base: string, nodes: AnyNode[]) {
  const match = /^(.*?)-(\d+)$/.exec(base)
  const prefix = match ? match[1] : base
  let n = match ? Number(match[2]) : 1
  let id = base
  while (nodes.some(item => item.id === id)) {
    n += 1
    id = `${prefix}-${n}`
  }
  return id
}
