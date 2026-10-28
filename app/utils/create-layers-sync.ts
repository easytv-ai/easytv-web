import type { CanvasGraph } from '~/types/creative'

/**
 * 成片向导（CreateLayers）写回画布的纯逻辑：版本冲突合并 + 并发占满时的退避。
 */

/**
 * 向导往节点 data 里写的全部字段：applyTask（taskId / taskStatus / taskProgress / taskError / content / assetId）
 * 和 runNode / regenerate 的失败标记（taskStatus / taskError）。除此之外的字段（prompt、label、引用、sp…）
 * 向导只读不写，冲突合并时一律以服务端为准。
 */
export const TASK_RESULT_FIELDS = ['taskId', 'taskStatus', 'taskProgress', 'taskError', 'content', 'assetId'] as const

type NodeData = Record<string, unknown>
type GraphNode = { id: string, data?: NodeData, [key: string]: unknown }
type GraphEdge = { id?: string, source?: string, target?: string, [key: string]: unknown }

/** 每个节点上次和服务端对齐时的任务结果字段，用来判断「这台设备后来改过哪些」 */
export type TaskResultBase = Map<string, NodeData>

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function isNode(value: unknown): value is GraphNode {
  return Boolean(value && typeof value === 'object' && typeof (value as GraphNode).id === 'string')
}

export function pickTaskResult(data: NodeData | undefined): NodeData {
  const out: NodeData = {}
  if (!data)
    return out
  for (const key of TASK_RESULT_FIELDS) {
    if (key in data)
      out[key] = data[key]
  }
  return out
}

export function snapshotTaskResults(graph: CanvasGraph | null | undefined): TaskResultBase {
  const base: TaskResultBase = new Map()
  for (const node of graph?.nodes ?? []) {
    if (isNode(node))
      base.set(node.id, pickTaskResult(node.data))
  }
  return base
}

function sameValue(a: unknown, b: unknown) {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}

/**
 * 本地相对基线改过的任务结果字段。没有基线（不知道上次对齐时的样子）时，本地有的结果字段全部算改过。
 */
export function changedTaskResult(local: NodeData | undefined, base: NodeData | undefined): NodeData {
  const mine = pickTaskResult(local)
  if (!base)
    return mine
  const patch: NodeData = {}
  for (const key of TASK_RESULT_FIELDS) {
    if (!sameValue(mine[key], base[key]))
      patch[key] = mine[key]
  }
  return patch
}

/**
 * 版本冲突时把本地任务结果合进服务端最新 graph。
 *
 * - 服务端的节点：只覆盖本地「相对基线改过」的任务结果字段，别处刚改的 prompt / label / 引用原样保留；
 *   基线之后本地没动过的结果字段也以服务端为准（别处可能重跑过）。
 * - 本地有、服务端没有的节点：本地在基线之后产出过结果（或没有基线可比）就保留，连同两端都还在的连线；
 *   否则视为别处删掉了，不复活。
 */
export function mergeTaskResults(remote: CanvasGraph, local: CanvasGraph, base?: TaskResultBase): CanvasGraph {
  const merged = clone({ ...remote, nodes: remote.nodes ?? [], edges: remote.edges ?? [] })
  const localNodes = (local.nodes ?? []).filter(isNode)
  const localById = new Map(localNodes.map(node => [node.id, node]))
  const ids = new Set<string>()

  for (const node of merged.nodes) {
    if (!isNode(node))
      continue
    ids.add(node.id)
    const mine = localById.get(node.id)
    if (!mine)
      continue
    const patch = changedTaskResult(mine.data, base?.get(node.id))
    if (Object.keys(patch).length)
      node.data = { ...node.data, ...patch }
  }

  const revived: string[] = []
  for (const mine of localNodes) {
    if (ids.has(mine.id))
      continue
    const baseResult = base?.get(mine.id)
    if (baseResult && !Object.keys(changedTaskResult(mine.data, baseResult)).length)
      continue
    merged.nodes.push(clone(mine))
    ids.add(mine.id)
    revived.push(mine.id)
  }

  if (revived.length) {
    const revivedSet = new Set(revived)
    const edgeIds = new Set((merged.edges as GraphEdge[]).map(edge => edge?.id).filter(Boolean))
    for (const edge of (local.edges ?? []) as GraphEdge[]) {
      if (!edge || !edge.source || !edge.target)
        continue
      if (!revivedSet.has(edge.source) && !revivedSet.has(edge.target))
        continue
      if (!ids.has(edge.source) || !ids.has(edge.target) || (edge.id && edgeIds.has(edge.id)))
        continue
      merged.edges.push(clone(edge))
    }
  }
  return merged
}

export const BUSY_BACKOFF_BASE_MS = 3000
export const BUSY_BACKOFF_MAX_MS = 20000
/** 并发占满时最多等这么久，超时把节点标失败 */
export const BUSY_MAX_WAIT_MS = 10 * 60 * 1000

/** 第 attempt 次（从 0 起）撞到并发上限后的等待时长：3s 起指数退避，上限 20s */
export function busyBackoffMs(attempt: number, base = BUSY_BACKOFF_BASE_MS, max = BUSY_BACKOFF_MAX_MS) {
  const n = Math.max(0, Math.floor(Number(attempt) || 0))
  return Math.min(max, base * 2 ** Math.min(n, 30))
}

/** 可被 AbortSignal 打断的等待；被中止时返回 false */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false)
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve(true)
    }, Math.max(0, ms))
    function onAbort() {
      clearTimeout(timer)
      resolve(false)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
