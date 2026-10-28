import type { GenerationTask } from '~/types/creative'

/** 生成任务状态写回节点：成功时把文本 / 媒体地址和资产 id 一并带上 */
export function canvasTaskPatch(task: Pick<GenerationTask, 'id' | 'status' | 'progress' | 'type' | 'result_text' | 'result_url' | 'result_asset_id' | 'error_msg'>, failedLabel: string) {
  const patch: Record<string, unknown> = {
    taskId: task.id,
    taskStatus: task.status,
    taskProgress: task.progress,
    taskError: task.status === 'failed' ? (task.error_msg || failedLabel) : '',
  }
  if (task.status === 'succeeded') {
    if (task.type === 'text' && task.result_text)
      patch.content = task.result_text
    else if (task.result_url)
      patch.content = task.result_url
    if (task.result_asset_id)
      patch.assetId = task.result_asset_id
  }
  return patch
}
