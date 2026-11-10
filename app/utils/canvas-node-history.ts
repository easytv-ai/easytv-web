import type { NodeCandidate } from '~/types/creative'

/**
 * 节点历史结果（API.md 39.2）的纯逻辑：哪条是当前、切回某条要改节点上哪些字段。
 * 拉取与缓存在 useCanvasNodeCandidates，入口在 CanvasNodeCandidates.vue。
 */

/** 少于两条就没什么可切的，入口不显示 */
export const NODE_HISTORY_MIN = 2

/** 接口一次最多收 50 个节点 */
export const NODE_HISTORY_MAX_IDS = 50

type NodeResultData = { content?: unknown, assetId?: unknown, taskId?: unknown, taskStatus?: unknown }

/** 丢掉没有地址的坏行；不足两条返回空（入口不显示） */
export function visibleNodeCandidates(list: readonly NodeCandidate[] | null | undefined): NodeCandidate[] {
  const rows = (list ?? []).filter(item => item && String(item.url || '').trim())
  return rows.length >= NODE_HISTORY_MIN ? rows : []
}

/** 节点现在用的是不是这条：先比资产 id，没有再比地址 */
export function isCurrentNodeCandidate(data: NodeResultData | null | undefined, candidate: Pick<NodeCandidate, 'asset_id' | 'url'>): boolean {
  if (!data)
    return false
  const assetId = Number(data.assetId) || 0
  if (assetId > 0 && Number(candidate.asset_id) > 0)
    return assetId === Number(candidate.asset_id)
  const content = String(data.content || '').trim()
  return Boolean(content) && content === String(candidate.url || '').trim()
}

/** 审片退回过的结果（API.md 25.5） */
export function isRejectedNodeCandidate(candidate: Pick<NodeCandidate, 'review'>): boolean {
  return candidate.review?.status === -1
}

/**
 * 把节点切回某条历史结果要打的补丁：与任务成功写回（canvasTaskPatch）同一批字段。
 * taskId 一并指回产出这条结果的任务，之后的片段重拍 / 续写才会作用在画面上这一条。
 * 不产生任务、不扣分。
 */
export function nodeCandidatePatch(candidate: Pick<NodeCandidate, 'task_id' | 'asset_id' | 'url'>) {
  const patch: Record<string, unknown> = {
    content: String(candidate.url || '').trim(),
    taskStatus: 'succeeded',
    taskProgress: 100,
    taskError: '',
  }
  if (Number(candidate.asset_id) > 0)
    patch.assetId = Number(candidate.asset_id)
  if (Number(candidate.task_id) > 0)
    patch.taskId = Number(candidate.task_id)
  return patch
}

/** 节点正在跑新任务时不让切：切了也会被跑完的结果盖掉 */
export function canPickNodeCandidate(data: NodeResultData | null | undefined, opts: { readonly?: boolean, locked?: boolean } = {}): boolean {
  if (opts.readonly || opts.locked || !data)
    return false
  const status = String(data.taskStatus || '')
  return status !== 'pending' && status !== 'running'
}

/** 历史结果上的时间：当天只显示时分，否则带月日 */
export function nodeCandidateTime(ts: number, now = new Date()): string {
  if (!ts)
    return ''
  const d = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return now.toDateString() === d.toDateString() ? hm : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`
}

/** 视频 / 音频时长：秒 → m:ss；没有时长返回空 */
export function nodeCandidateDuration(seconds: number): string {
  const total = Math.round(Number(seconds) || 0)
  if (total <= 0)
    return ''
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
