import type { AssistChange } from '~/utils/canvas-assist'
import { isNodeLocked, type CanvasFlowNode } from '~/utils/canvas-group'

/**
 * 画布助手方案与节点锁定：方案里哪些改动会碰到锁定节点。
 * 锁定的口径与手动操作一致（isNodeLocked 沿父组向上查）：锁定节点的提示词不改、不重新生成、
 * 两端任一锁定就不连线（连线会把上游文本同步进下游提示词）。apply_graph 落的全是新节点，不受影响。
 */
export function assistChangeNodeIds(change: AssistChange): string[] {
  const ids = change.action === 'connect'
    ? [change.source, change.target]
    : change.action === 'add_node'
      ? [change.from]
      : change.action === 'update_prompt' || change.action === 'regenerate'
        ? [change.node_id]
        : []
  return ids.filter((id): id is string => Boolean(id))
}

/** 把方案分成「可以应用」与「因锁定跳过」两份，顺序不变 */
export function splitAssistChangesByLock(changes: AssistChange[], nodes: CanvasFlowNode[]) {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const open: AssistChange[] = []
  const locked: AssistChange[] = []
  for (const change of changes) {
    const hit = assistChangeNodeIds(change).some(id => isNodeLocked(byId.get(id), byId))
    if (hit)
      locked.push(change)
    else
      open.push(change)
  }
  return { open, locked }
}

