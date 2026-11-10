import canvasApi from '~/api/canvas'
import type { NodeCandidate } from '~/types/creative'
import { NODE_HISTORY_MAX_IDS, visibleNodeCandidates } from '~/utils/canvas-node-history'

/**
 * 节点历史结果（API.md 39.2）：选中节点时按需拉、任务成功后刷新，按节点缓存。
 * 接口不存在（旧后端 404）或请求失败时一声不吭——入口不显示就是了，不弹错误。
 */
export function useCanvasNodeCandidates(opts: {
  canvasId: () => number
}) {
  const byNode = ref<Record<string, NodeCandidate[]>>({})
  /** 旧后端没有这个接口：404 之后本次会话不再请求 */
  let unsupported = false
  const loading = new Set<string>()

  async function load(nodeIds: string[], force = false) {
    const canvasId = opts.canvasId()
    if (unsupported || !(canvasId > 0))
      return
    const ids = [...new Set(nodeIds.filter(Boolean))]
      .filter(id => !loading.has(id) && (force || !(id in byNode.value)))
      .slice(0, NODE_HISTORY_MAX_IDS)
    if (!ids.length)
      return
    ids.forEach(id => loading.add(id))
    try {
      const res = await canvasApi.nodeCandidates(canvasId, ids) as Awaited<ReturnType<typeof canvasApi.nodeCandidates>> & { statusCode?: number }
      if (canvasId !== opts.canvasId())
        return
      if (!res?.success || !res.data) {
        if (res?.statusCode === 404)
          unsupported = true
        return
      }
      const rows = res.data.candidates && typeof res.data.candidates === 'object' ? res.data.candidates : {}
      const next = { ...byNode.value }
      // 没有结果的节点不在返回对象里：记成空数组，下次选中不再重复请求
      for (const id of ids)
        next[id] = Array.isArray(rows[id]) ? rows[id] : []
      byNode.value = next
    }
    catch {
      // 静默：历史结果是锦上添花，拉不到不影响生成
    }
    finally {
      ids.forEach(id => loading.delete(id))
    }
  }

  /** 够两条才返回，否则空数组（入口不显示） */
  function listOf(nodeId: string | undefined | null): NodeCandidate[] {
    if (!nodeId)
      return []
    return visibleNodeCandidates(byNode.value[nodeId])
  }

  function reset() {
    byNode.value = {}
    unsupported = false
  }

  return { byNode, load, listOf, reset }
}
