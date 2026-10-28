import type { GenerationBatch, GenerationBatchItem } from '~/types/creative'

/** 服务端批量生成与向导节点的对齐（纯逻辑）。 */

export type BatchNodePatch = { nodeId: string, patch: Record<string, unknown> }

export function batchActive(batch: GenerationBatch | null | undefined) {
  return batch?.status === 'running' || batch?.status === 'paused'
}

/**
 * 批次条目 → 节点补丁：
 * - 已提交出任务（task_id 与节点当前不同）：节点挂上新任务，状态置 pending，交给任务轮询取结果；
 * - 没提交就失败 / 被跳过（上游失败、模型报错）：节点标失败并带原因。
 * 节点当前 taskId 已经是这个任务的不再改，避免覆盖轮询写进去的进度与结果。
 */
export function batchNodePatches(items: GenerationBatchItem[], nodeTaskId: (nodeId: string) => number): BatchNodePatch[] {
  const out: BatchNodePatch[] = []
  for (const item of items) {
    const current = nodeTaskId(item.node_id)
    if (item.task_id > 0 && item.task_id !== current) {
      out.push({ nodeId: item.node_id, patch: { taskId: item.task_id, taskStatus: 'pending', taskProgress: 0, taskError: '' } })
      continue
    }
    if ((item.status === 'failed' || item.status === 'skipped') && !item.task_id)
      out.push({ nodeId: item.node_id, patch: { taskStatus: 'failed', taskError: item.error } })
  }
  return out
}

/** 节点在进行中批次里还没提交（排队 / 等上游）时的状态，用于卡片文案 */
export function waitingNodeIds(batch: GenerationBatch | null | undefined) {
  const ids = new Set<string>()
  if (!batchActive(batch))
    return ids
  for (const item of batch?.items ?? []) {
    if (item.status === 'waiting')
      ids.add(item.node_id)
  }
  return ids
}
