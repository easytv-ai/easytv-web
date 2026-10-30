/**
 * 节点级重跑：提交时记下上游产物快照。
 *
 * - 提交任务时给节点盖一份「输入快照」：当时用的模型、提示词，以及每个上游的产物签名；
 * - 上游产物或本节点的模型/提示词一变，结果就被标成「结果已过期」；
 * - 重跑只需要重跑这一个节点，不用把整条链从头再来（下游拿到的是新的上游产物）。
 *
 * 快照只存签名不存内容（hash），所以画布 graph 不会被撑大；老结果没有快照就当作"不确定"，
 * 不标过期，免得一上线满屏都是过期提示。
 */

import type { ComputedRef, InjectionKey } from 'vue'

export type StaleReason = 'input' | 'upstream'

export type InputSnapshot = {
  /** 提交时刻（秒），仅用于排查与展示 */
  at: number
  /** 提交时的模型 id */
  model: string
  /** 提交时的节点提示词（原文，不是展开运镜/标记后的版本） */
  prompt: string
  /** 提交时各上游的产物签名 */
  upstream: Array<{ id: string, sig: string }>
}

/** 画布级「谁的结果过期了」映射：workspace 算好 provide 给节点卡片用 */
export const CANVAS_STALE_KEY: InjectionKey<ComputedRef<Record<string, StaleReason>>> = Symbol('canvas-stale')

/** FNV-1a 32 位：够短的稳定指纹，不追求抗碰撞 */
export function hashSignature(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

/**
 * 产物签名：空产物给空串（"还没有结果"），有产物时把 assetId / taskId 与内容指纹串起来。
 * 只改节点样式、位置、标签不会换签名，重新生成一次就会换。
 */
export function outputSignature(data?: Record<string, any> | null): string {
  if (!data)
    return ''
  const content = typeof data.content === 'string' ? data.content : ''
  const assetId = data.assetId ?? ''
  const taskId = data.taskId ?? ''
  if (!content && !assetId)
    return ''
  return `${assetId}|${taskId}|${content.length}|${hashSignature(content)}`
}

export function makeInputSnapshot(input: {
  model?: string
  prompt?: string
  upstream: Array<{ id: string, data?: Record<string, any> | null }>
  at?: number
}): InputSnapshot {
  return {
    at: input.at ?? Math.floor(Date.now() / 1000),
    model: String(input.model || ''),
    prompt: String(input.prompt || ''),
    upstream: input.upstream.map(item => ({ id: item.id, sig: outputSignature(item.data) })),
  }
}

/** 从节点 data 里取出快照；形状不对（老数据 / 手改过的 graph）就当作没有 */
export function inputSnapshotOf(data?: Record<string, any> | null): InputSnapshot | null {
  const raw = data?.inputSnapshot as InputSnapshot | undefined
  if (!raw || typeof raw !== 'object')
    return null
  if (typeof raw.model !== 'string' || typeof raw.prompt !== 'string' || !Array.isArray(raw.upstream))
    return null
  return raw
}

/** 上游集合是否与快照一致：数量和身份都要对上，多连/删连线也算变过 */
function upstreamMatches(snap: InputSnapshot, upstream: Array<{ id: string, data?: Record<string, any> | null }>) {
  if (snap.upstream.length !== upstream.length)
    return false
  return upstream.every((item, index) => {
    const recorded = snap.upstream[index]
    return recorded ? recorded.id === item.id && recorded.sig === outputSignature(item.data) : false
  })
}

/** 单个节点的过期判断；文本节点跳过（content 就是它自己的值，改了不算"结果过期"） */
export function staleReason(input: {
  id: string
  data?: Record<string, any> | null
  upstream: Array<{ id: string, data?: Record<string, any> | null }>
}): StaleReason | null {
  const data = input.data
  if (!data || data.kind === 'text')
    return null
  if (!outputSignature(data))
    return null
  const snap = inputSnapshotOf(data)
  if (!snap)
    return null
  if (snap.model !== String(data.model || '') || snap.prompt !== String(data.prompt || ''))
    return 'input'
  if (!upstreamMatches(snap, input.upstream))
    return 'upstream'
  return null
}

/** 整张画布扫一遍：只返回过期的节点 id → 原因 */
export function computeStaleMap(
  nodes: Array<{ id: string, data?: any }>,
  edges: Array<{ source: string, target: string }>,
): Record<string, StaleReason> {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const upstreamOf = (id: string) => edges
    .filter(edge => edge.target === id)
    .map(edge => byId.get(edge.source))
    .filter((node): node is { id: string, data?: any } => Boolean(node))

  const out: Record<string, StaleReason> = {}
  for (const node of nodes) {
    const reason = staleReason({ id: node.id, data: node.data, upstream: upstreamOf(node.id) })
    if (reason)
      out[node.id] = reason
  }
  return out
}
