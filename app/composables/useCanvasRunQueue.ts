import { computed, onMounted, onScopeDispose, ref, watch } from 'vue'
import taskApi from '~/api/task'
import { CANVAS_TASK_POLL_MS } from '~/composables/useCanvasJobPolling'
import { startHiddenAwarePoll } from '~/utils/hidden-poll'
import { RUN_QUEUE_ACTIVE_PAGE_SIZE, RUN_QUEUE_PAGE_SIZE, mergeRunQueueTasks, runQueueActiveCount } from '~/utils/canvas-run-queue'
import type { canvasTaskPatch } from '~/utils/canvas-task-apply'
import type { GenerationTask } from '~/types/creative'

/**
 * 画布「运行队列」：这幅画布正在跑和刚跑完的任务（`GET /user/task?canvas_id=`），
 * 取消 / 重试接既有端点（`POST /user/task/:id/cancel|retry`，见 API.md 1.4）。
 *
 * 刷新写法跟画布既有轮询同一套：`startHiddenAwarePoll` + useCanvasJobPolling 的同一个间隔
 * （CANVAS_TASK_POLL_MS），且只在「面板开着」或「还有进行中的任务」时才起；
 * 没有进行中的任务就停表，不再有第二套定时器。同一拍里的重复触发（打开面板 / 手动刷新 /
 * 取消重试之后）由 load 里的节流合并成一次请求。
 *
 * 不做的事：不加新端点、不改服务端。任务挂的节点被删了只能看不能点（定位由工作区判）。
 */
export const RUN_QUEUE_REFRESH_MIN_MS = 2500

/** 能写回任务节点的字段：与 canvasTaskPatch 同一个口径，工作区的 applyTaskToNode 直接吃 */
export type RunQueueTaskPatch = Parameters<typeof canvasTaskPatch>[0]

export type RunQueueConfirm = (options: { message: string, confirmText?: string, danger?: boolean }) => Promise<boolean>

export function useCanvasRunQueue(opts: {
  /** 当前画布 id（未保存的新画布是 0：不查接口，面板给「保存后才有任务」的提示） */
  canvasId: () => number
  /** 面板开着没有：开着即使没有进行中的任务也保持刷新；关着只在有进行中的任务时轮询（角标要用） */
  open: () => boolean
  t: (key: string, params?: Record<string, unknown>) => string
  notify: (title: string, color?: 'neutral' | 'error') => void
  /** 取消 / 重试会动积分：刷新钱包与顶栏任务角标 */
  refreshWallet?: () => void
  refreshActivity?: () => void
  /** 重试出来的是新任务：接回画布既有的任务轮询，并写回节点 */
  pollTask?: (nodeId: string, taskId: number) => void
  applyTaskToNode?: (nodeId: string, task: RunQueueTaskPatch) => void
  confirm: RunQueueConfirm
}) {
  const tasks = ref<GenerationTask[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref('')
  /** 正在取消 / 重试的任务 id */
  const busyId = ref<number | null>(null)
  /** 最近一次查成功的时刻（面板上的手动刷新按钮用） */
  const refreshedAt = ref(0)
  const activeCount = computed(() => runQueueActiveCount(tasks.value))

  let stopPoll = () => {}
  let polling = false
  let inflight: Promise<void> | null = null
  let lastLoadAt = 0
  /** 被节流或并发挤掉的那次刷新：当前这次查完补查一次（批量提交会连着触发很多次） */
  let queued = false

  /**
   * 两路一起查：active=1 单拿进行中（提交高峰时不会被最近 50 条挤掉），
   * 另一路拿最近的任务页（「刚结束」从里面按时间窗挑）。合并交给 utils。
   */
  async function fetchTasks(canvasId: number) {
    const [activeRes, recentRes] = await Promise.all([
      taskApi.list({ canvas_id: canvasId, active: 1, page: 1, page_size: RUN_QUEUE_ACTIVE_PAGE_SIZE }),
      taskApi.list({ canvas_id: canvasId, page: 1, page_size: RUN_QUEUE_PAGE_SIZE }),
    ])
    const activeOk = Boolean(activeRes?.success && activeRes.data)
    const recentOk = Boolean(recentRes?.success && recentRes.data)
    // 进行中那一路没查到就别把「空」当真：会漏行、误停轮询、少算角标
    if (!activeOk) {
      error.value = activeRes?.message || recentRes?.message || opts.t('任务加载失败')
      return
    }
    tasks.value = mergeRunQueueTasks([
      recentOk ? recentRes?.data?.items ?? [] : [],
      activeRes?.data?.items ?? [],
    ])
    // 最近那一路失败只提示一行（面板里的列表还在），别把队列整屏盖掉
    error.value = recentOk ? '' : (recentRes?.message || opts.t('任务加载失败'))
    loaded.value = true
    refreshedAt.value = Date.now()
  }

  /** 查一次。同一拍里的重复触发合并（返回同一个 promise），被挤掉的那次补跑 */
  function load(force = false): Promise<void> {
    const canvasId = Number(opts.canvasId()) || 0
    if (!canvasId) {
      tasks.value = []
      loaded.value = true
      error.value = ''
      return Promise.resolve()
    }
    if (inflight) {
      if (force)
        queued = true
      return inflight
    }
    if (!force && Date.now() - lastLoadAt < RUN_QUEUE_REFRESH_MIN_MS)
      return Promise.resolve()
    lastLoadAt = Date.now()
    loading.value = true
    inflight = (async () => {
      try {
        await fetchTasks(canvasId)
      }
      catch (err) {
        error.value = err instanceof Error ? err.message : opts.t('任务加载失败')
      }
      finally {
        loading.value = false
        inflight = null
        if (queued) {
          queued = false
          void load(true)
        }
      }
    })()
    return inflight
  }

  /** 有没有必要轮询：未保存的画布不查；面板开着或还有进行中的任务才查（其余时刻停表） */
  function needPolling() {
    return Boolean(Number(opts.canvasId()) || 0) && (opts.open() || activeCount.value > 0)
  }

  function syncPolling() {
    if (needPolling()) {
      if (polling)
        return
      polling = true
      stopPoll = startHiddenAwarePoll(() => { void load() }, CANVAS_TASK_POLL_MS)
      return
    }
    if (!polling)
      return
    polling = false
    stopPoll()
    stopPoll = () => {}
  }

  /** 手动刷新（面板上的刷新按钮）：绕过节流 */
  function refresh() {
    return load(true)
  }

  /**
   * 画布内刚提交了任务（节点生成 / 重跑 / 一稿多版 / 视频工具 / 对话栏）：
   * 立刻查一次，否则面板关着、当前又一条进行中的都没有时不会轮询，
   * 新任务要等手动打开面板才冒出来（角标也不出现）。
   * 提交密集时由 load 的合并兜住：同一拍只查一次，被挤掉的那次补跑一次。
   */
  function noteSubmitted() {
    return load(true)
  }

  async function cancelTask(task: GenerationTask): Promise<boolean> {
    if (busyId.value)
      return false
    const ok = await opts.confirm({
      message: opts.t('取消这个任务？预扣的积分会退回。'),
      confirmText: opts.t('取消任务'),
      danger: true,
    })
    if (!ok)
      return false
    busyId.value = task.id
    try {
      const res = await taskApi.cancel(task.id)
      if (!res?.success) {
        opts.notify(res?.message || opts.t('取消失败'), 'error')
        return false
      }
      opts.notify(opts.t('任务已取消，积分已退回'))
      // 节点上的状态由既有任务轮询写回，但那条要等下一拍：这里先按取消写一次，画布立刻跟上
      applyPatch(task, { ...task, status: 'cancelled' })
      await load(true)
      opts.refreshWallet?.()
      opts.refreshActivity?.()
      return true
    }
    finally {
      busyId.value = null
    }
  }

  async function retryTask(task: GenerationTask): Promise<boolean> {
    if (busyId.value)
      return false
    busyId.value = task.id
    try {
      const res = await taskApi.retry(task.id)
      if (!res?.success || !res.data) {
        opts.notify(res?.message || opts.t('重试失败'), 'error')
        return false
      }
      const fresh = res.data
      opts.notify(
        fresh.status === 'failed' ? (fresh.error_msg || opts.t('重试失败')) : opts.t('已重新提交'),
        fresh.status === 'failed' ? 'error' : 'neutral',
      )
      // 重试是「按原参数新建一条」：新任务还在原节点上（controller/task.go 的 RetryMyTask 会照抄 node_id），
      // 挂回节点并交给既有轮询，节点上就能继续看这条的进度
      if (fresh.node_id) {
        applyPatch(fresh, fresh)
        opts.pollTask?.(fresh.node_id, fresh.id)
      }
      await load(true)
      opts.refreshWallet?.()
      opts.refreshActivity?.()
      return true
    }
    finally {
      busyId.value = null
    }
  }

  /** 把任务状态写回它挂的节点（没挂节点就跳过） */
  function applyPatch(source: Pick<GenerationTask, 'node_id'>, patch: RunQueueTaskPatch) {
    const nodeId = String(source.node_id || '')
    if (!nodeId)
      return
    opts.applyTaskToNode?.(nodeId, patch)
  }

  watch([() => opts.canvasId(), () => opts.open(), activeCount], syncPolling)
  // 进画布先查一次：工具条上的角标要有数（之后面板关着就只在有任务在跑时刷新）
  onMounted(() => { void load(true) })
  // 新画布保存后 / 换一张画布：id 一变就重查（未保存时不查接口，面板给提示）
  watch(() => opts.canvasId(), () => { void load(true) })
  onScopeDispose(() => {
    polling = false
    stopPoll()
    stopPoll = () => {}
  })

  return {
    tasks,
    loading,
    loaded,
    error,
    busyId,
    refreshedAt,
    activeCount,
    load,
    refresh,
    noteSubmitted,
    cancelTask,
    retryTask,
    syncPolling,
  }
}
