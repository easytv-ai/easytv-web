import { onUnmounted, type Ref } from 'vue'
import { startHiddenAwarePoll } from '~/utils/hidden-poll'
import taskApi from '~/api/task'
import mediaApi from '~/api/media'
import type { MediaJob } from '~/types/creative'
import { isMediaJobActive } from '~/utils/canvas-media-job'
import { canvasTaskPatch } from '~/utils/canvas-task-apply'
import { isContentNode, type CanvasFlowNode } from '~/utils/canvas-group'
import type { CanvasNodeData } from '~/utils/canvas-node-kinds'

export const CANVAS_TASK_POLL_MS = 3000
export const CANVAS_MEDIA_POLL_MS = 3000

type FindNode = (id: string) => { id: string, data?: CanvasNodeData } | undefined

/**
 * 生成任务 + 媒体作业轮询。页面不可见时跳过这一拍，回来再查，避免后台一直打接口。
 */
export function useCanvasJobPolling(opts: {
  findNode: FindNode
  nodes: Ref<CanvasFlowNode[]>
  updateNodeData: (id: string, patch: Record<string, unknown>) => void
  pushHistory: () => void
  notify: (title: string, color?: 'neutral' | 'error') => void
  t: (key: string, params?: Record<string, unknown>) => string
  applyMediaJobToNode: (nodeId: string, job: MediaJob) => void
  /** 任务成功落地后。配乐用它在生成完成时把音轨混进视频，刷新后续上的轮询也能走到 */
  onTaskSucceeded?: (nodeId: string, task: Parameters<typeof canvasTaskPatch>[0]) => void
}) {
  const pollers = new Map<string, () => void>()
  const mediaPollers = new Map<string, () => void>()
  const mediaPollBusy = new Set<string>()

  function applyTaskToNode(nodeId: string, task: Parameters<typeof canvasTaskPatch>[0]) {
    opts.updateNodeData(nodeId, canvasTaskPatch(task, opts.t('生成失败')))
  }

  function stopPolling(nodeId: string) {
    pollers.get(nodeId)?.()
    pollers.delete(nodeId)
  }

  function stopMediaPolling(nodeId: string) {
    mediaPollers.get(nodeId)?.()
    mediaPollers.delete(nodeId)
    mediaPollBusy.delete(nodeId)
  }

  function stopAllPolling() {
    for (const stop of pollers.values())
      stop()
    pollers.clear()
    for (const stop of mediaPollers.values())
      stop()
    mediaPollers.clear()
    mediaPollBusy.clear()
  }

  function pollTask(nodeId: string, taskId: number) {
    stopPolling(nodeId)
    const stop = startHiddenAwarePoll(async () => {
      if (!opts.findNode(nodeId)) {
        stopPolling(nodeId)
        return
      }
      const res = await taskApi.get(taskId)
      if (!res?.success || !res.data)
        return
      applyTaskToNode(nodeId, res.data)
      if (res.data.status === 'pending' || res.data.status === 'running')
        return
      stopPolling(nodeId)
      opts.pushHistory()
      if (res.data.status === 'succeeded') {
        opts.notify(opts.t('{label} 生成完成', { label: opts.findNode(nodeId)?.data?.label ?? opts.t('节点') }))
        opts.onTaskSucceeded?.(nodeId, res.data)
      }
      else if (res.data.status === 'failed')
        opts.notify(res.data.error_msg || opts.t('生成失败'), 'error')
    }, CANVAS_TASK_POLL_MS)
    pollers.set(nodeId, stop)
  }

  function pollMediaJob(nodeId: string, jobId: number) {
    stopMediaPolling(nodeId)
    const stop = startHiddenAwarePoll(async () => {
      if (!opts.findNode(nodeId)) {
        stopMediaPolling(nodeId)
        return
      }
      if (mediaPollBusy.has(nodeId))
        return
      mediaPollBusy.add(nodeId)
      let job: MediaJob | undefined
      try {
        const res = await mediaApi.get(jobId)
        job = res?.success ? res.data : undefined
      }
      finally {
        mediaPollBusy.delete(nodeId)
      }
      if (!job || !mediaPollers.has(nodeId))
        return
      const node = opts.findNode(nodeId)
      if (node && isContentNode(node as CanvasFlowNode) && node.data?.taskStatus === 'succeeded' && !isMediaJobActive(job.status)) {
        stopMediaPolling(nodeId)
        return
      }
      opts.applyMediaJobToNode(nodeId, job)
      if (isMediaJobActive(job.status))
        return
      stopMediaPolling(nodeId)
      opts.pushHistory()
      if (job.status === 2)
        opts.notify(opts.t('{label} 处理完成', { label: opts.findNode(nodeId)?.data?.label ?? opts.t('节点') }))
      else if (job.status === -1)
        opts.notify(job.error || opts.t('处理失败'), 'error')
    }, CANVAS_MEDIA_POLL_MS)
    mediaPollers.set(nodeId, stop)
  }

  function resumePolling() {
    for (const node of opts.nodes.value) {
      if (!isContentNode(node))
        continue
      const { taskId, taskStatus, mediaJobId } = node.data
      if (taskStatus !== 'pending' && taskStatus !== 'running')
        continue
      // 媒体作业带 task_id 的（模型动作）状态由作业接口映射，只轮询作业，别再另开一路任务轮询
      if (mediaJobId)
        pollMediaJob(node.id, mediaJobId)
      else if (taskId)
        pollTask(node.id, taskId)
    }
  }

  async function waitTask(nodeId: string, taskId: number, timeoutMs = 180_000) {
    stopPolling(nodeId)
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, CANVAS_TASK_POLL_MS))
      if (!opts.findNode(nodeId))
        return null
      const res = await taskApi.get(taskId)
      if (!res?.success || !res.data)
        continue
      applyTaskToNode(nodeId, res.data)
      if (res.data.status === 'pending' || res.data.status === 'running')
        continue
      opts.pushHistory()
      return res.data
    }
    if (opts.findNode(nodeId))
      pollTask(nodeId, taskId)
    return null
  }

  async function waitMediaJob(jobId: number, timeoutMs = 120_000): Promise<MediaJob | null> {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, CANVAS_MEDIA_POLL_MS))
      const res = await mediaApi.get(jobId)
      if (!res?.success || !res.data)
        continue
      if (!isMediaJobActive(res.data.status))
        return res.data
    }
    return null
  }

  onUnmounted(stopAllPolling)

  return {
    applyTaskToNode,
    pollTask,
    stopPolling,
    pollMediaJob,
    stopMediaPolling,
    resumePolling,
    stopAllPolling,
    waitTask,
    waitMediaJob,
  }
}
