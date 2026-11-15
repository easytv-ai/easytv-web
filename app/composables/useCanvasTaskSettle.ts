import { onScopeDispose, watch } from 'vue'
import { nodeTaskSettle, type NodeTaskView } from '~/utils/canvas-chat-media-report'

export type TaskSettleResult =
  | { state: 'settled', view: NodeTaskView }
  | { state: 'lost' }

/**
 * 盯住节点上的某条任务直到后端给出终态。
 * 自己不轮询、不起定时器：节点上的任务状态由画布已有的任务轮询（useCanvasJobPolling）写回，
 * 这里只是监听那份响应式数据，所以等多久都不额外打接口。
 */
export function useCanvasTaskSettle(read: (nodeId: string) => NodeTaskView | null) {
  const stops = new Set<() => void>()

  function track(nodeId: string, taskId: number, done: (result: TaskSettleResult) => void) {
    let seen = false
    let finished = false
    let stopWatch: (() => void) | null = null
    const stop = () => {
      finished = true
      stopWatch?.()
      stops.delete(stop)
    }
    stops.add(stop)
    stopWatch = watch(
      () => {
        const view = read(nodeId)
        return view ? `${Number(view.taskId) || 0}|${view.status || ''}|${view.url || ''}` : null
      },
      () => {
        if (finished)
          return
        const view = read(nodeId)
        const state = nodeTaskSettle(view, taskId, seen)
        if (view)
          seen = true
        if (state === 'waiting')
          return
        stop()
        done(state === 'settled' && view ? { state: 'settled', view: { ...view } } : { state: 'lost' })
      },
      { immediate: true },
    )
    // immediate 那一拍就已经有结论时，stop 跑在 stopWatch 赋值之前，这里补停
    if (finished)
      stopWatch()
    return stop
  }

  onScopeDispose(() => {
    for (const stop of [...stops])
      stop()
  })

  return { track }
}
