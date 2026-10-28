import type { GenerationTask, TaskStatus, TaskType } from '~/types/creative'

/**
 * 画布「运行队列」面板的纯逻辑：分组 / 排序 / 进度 / 点数 / 可点的动作 / 能不能定位到节点。
 *
 * 只吃 `GET /user/task` 的任务对象，不碰画布也不碰接口：面板拿它渲染，工作区拿它判断能否定位。
 * 状态 / 类型文案沿用任务中心的措辞（同样是中文原文当 key，见 app/pages/tasks/index.vue）。
 */

/**
 * 一次拉这么多条画布任务（最近的一页，覆盖「刚结束」）。
 * 进行中另走一路 active=1 单查（见 RUN_QUEUE_ACTIVE_PAGE_SIZE）：提交高峰时
 * 进行中的任务 id 可能被后来的任务挤出这一页，只靠这 50 条会漏行、漏算角标。
 */
export const RUN_QUEUE_PAGE_SIZE = 50
/** 进行中那一页：active=1 只看排队 / 生成中，正常不会有几条 */
export const RUN_QUEUE_ACTIVE_PAGE_SIZE = 50
/** 「刚结束」的时间窗：比这更早的算历史，面板底部给任务中心入口 */
export const RUN_QUEUE_DONE_WINDOW_MS = 30 * 60 * 1000
/** 「刚结束」最多列几条（进行中的有几条列几条） */
export const RUN_QUEUE_DONE_LIMIT = 8

export type RunQueuePoints = {
  /** frozen=预扣中 cost=已结算 refunded=已退回 none=这单没花点数 */
  kind: 'frozen' | 'cost' | 'refunded' | 'none'
  points: number
}

/** 能不能定位到节点：不行时给出原因（中文原文 key，直接 t()） */
export type RunQueueLocate = { ok: true } | { ok: false, reason: string }

/** 能接的既有端点：cancel=进行中可取消，retry=失败 / 已取消可重试，null=没有可点的动作 */
export type RunQueueAction = 'cancel' | 'retry' | null

/** 进行中 = 排队 + 生成中（API.md：active=1 只看这两种） */
export function isRunQueueActive(status: TaskStatus) {
  return status === 'pending' || status === 'running'
}

/**
 * 合并多路查询的结果：按任务 id 去重，同一条以后面的那路为准
 * （调用方把 active=1 的那路放最后，进行中的状态以它为准）。
 */
export function mergeRunQueueTasks(lists: GenerationTask[][]): GenerationTask[] {
  const byId = new Map<number, GenerationTask>()
  for (const list of lists) {
    for (const task of list)
      byId.set(task.id, task)
  }
  return [...byId.values()]
}

/** 状态文案：与任务中心的 STATUS_LABEL 同一套词 */
export function runQueueStatusKey(status: TaskStatus): string {
  if (status === 'pending')
    return '排队中'
  if (status === 'running')
    return '生成中'
  if (status === 'succeeded')
    return '已完成'
  if (status === 'failed')
    return '失败'
  return '已取消'
}

/** 类型文案：与任务中心的 TYPE_ITEMS 同一套词 */
export function runQueueTypeKey(type: TaskType): string {
  if (type === 'image')
    return '图片'
  if (type === 'video')
    return '视频'
  if (type === 'audio')
    return '音频'
  return '文本'
}

/** 任务结束时刻（秒）；没结束过就用提交时间兜底 */
function runQueueStamp(task: GenerationTask) {
  return task.finished_at || task.created_at || 0
}

/**
 * 队列顺序：进行中的在前（先提交的靠上，排队最久的在队首），
 * 结束的在后（刚结束的靠上），同刻按 id 兜底，保证顺序稳定。
 */
export function sortRunQueueTasks(tasks: GenerationTask[]): GenerationTask[] {
  return [...tasks].sort((a, b) => {
    const rankA = isRunQueueActive(a.status) ? 0 : 1
    const rankB = isRunQueueActive(b.status) ? 0 : 1
    if (rankA !== rankB)
      return rankA - rankB
    if (rankA === 0)
      return (a.created_at || 0) - (b.created_at || 0) || a.id - b.id
    return runQueueStamp(b) - runQueueStamp(a) || b.id - a.id
  })
}

/**
 * 面板要显示的两段：进行中（全部）+ 刚结束（时间窗内，最多 limit 条）。
 * now 传毫秒（默认当前时间），任务的 finished_at 是秒。
 */
export function runQueueSections(
  tasks: GenerationTask[],
  now = Date.now(),
  opts: { windowMs?: number, limit?: number } = {},
): { active: GenerationTask[], done: GenerationTask[] } {
  const windowMs = opts.windowMs ?? RUN_QUEUE_DONE_WINDOW_MS
  const limit = opts.limit ?? RUN_QUEUE_DONE_LIMIT
  const sorted = sortRunQueueTasks(tasks)
  const since = (now - windowMs) / 1000
  return {
    active: sorted.filter(task => isRunQueueActive(task.status)),
    done: sorted
      .filter(task => !isRunQueueActive(task.status) && runQueueStamp(task) >= since)
      .slice(0, Math.max(0, limit)),
  }
}

/** 生成中的进度（0-100）；排队中和已结束的没有进度 */
export function runQueueProgress(task: GenerationTask): number {
  if (task.status !== 'running')
    return 0
  const value = Math.round(Number(task.progress) || 0)
  return Math.min(100, Math.max(0, value))
}

/**
 * 这条任务要显示的点数：进行中显示预扣、成功显示实耗、失败 / 取消说明已退回，
 * 没有点数可说的（免费任务）返回 none，面板就不显示这一行。
 */
export function runQueuePoints(task: GenerationTask): RunQueuePoints {
  if (isRunQueueActive(task.status)) {
    const frozen = Number(task.points_frozen) || 0
    return frozen > 0 ? { kind: 'frozen', points: frozen } : { kind: 'none', points: 0 }
  }
  if (task.status === 'succeeded') {
    const cost = Number(task.cost_points) || 0
    return cost > 0 ? { kind: 'cost', points: cost } : { kind: 'none', points: 0 }
  }
  return { kind: 'refunded', points: 0 }
}

/** 失败原因：失败才显示，其它状态一律给空串（成功任务不该挂旧错误） */
export function runQueueError(task: GenerationTask): string {
  return task.status === 'failed' ? String(task.error_msg || '').trim() : ''
}

/**
 * 这条任务能接哪个既有端点（不能的返回 null，不伪造按钮）：
 * 进行中 → `POST /user/task/:id/cancel`；失败 / 已取消 → `POST /user/task/:id/retry`。
 * 成功的不给「重新生成」：那是画布节点上的动作（retake / extend / upscale 也各有入口）。
 */
export function runQueueAction(status: TaskStatus): RunQueueAction {
  if (isRunQueueActive(status))
    return 'cancel'
  if (status === 'failed' || status === 'cancelled')
    return 'retry'
  return null
}

/**
 * 能不能点这条定位到节点：没挂节点（对话栏的文本任务）或节点已被删都不行，
 * 并给出原因（中文原文 key）。hasNode 由画布传入。
 */
export function runQueueLocate(
  task: Pick<GenerationTask, 'node_id'>,
  hasNode: (id: string) => boolean,
): RunQueueLocate {
  const nodeId = String(task.node_id || '')
  if (!nodeId)
    return { ok: false, reason: '这条任务没有对应节点' }
  if (!hasNode(nodeId))
    return { ok: false, reason: '节点已删除' }
  return { ok: true }
}

/**
 * 提交时间：今天只给 14:32，更早带月日（面板窄，不写年份）。
 * ts 是秒；now 传毫秒，便于测试。没有时间戳给空串。
 */
export function runQueueClock(ts: number, now = Date.now()): string {
  if (!ts)
    return ''
  const at = new Date(ts * 1000)
  const base = new Date(now)
  const pad = (n: number) => String(n).padStart(2, '0')
  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`
  const sameDay = at.getFullYear() === base.getFullYear()
    && at.getMonth() === base.getMonth()
    && at.getDate() === base.getDate()
  return sameDay ? clock : `${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${clock}`
}

/** 进行中的任务数（面板分组标题与工具条角标共用） */
export function runQueueActiveCount(tasks: GenerationTask[]): number {
  return tasks.filter(task => isRunQueueActive(task.status)).length
}

/** 有进行中的任务才轮询（与顶栏任务角标 useTaskActivityPolling 同一套规则） */
export function runQueueShouldPoll(tasks: GenerationTask[]): boolean {
  return runQueueActiveCount(tasks) > 0
}

/** 角标数字：超过上限显示 99+ */
export function runQueueBadge(count: number, max = 99): string {
  return count > max ? `${max}+` : String(count)
}
