/**
 * 对话栏单条出片：等待结束后「卡片能不能解锁、气泡显示什么」的判定。
 *
 * 铁律：会扣积分的按钮，解锁条件只能是「后端确认任务终态」。
 * 等待超时不是终态——任务多半还在排队，这时解锁卡片，用户重试就是重复扣分。
 */

/** 节点上与任务有关的那几项（CanvasNodeData 的 taskId / taskStatus / content / taskError） */
export type NodeTaskView = {
  taskId?: number
  status?: string
  url?: string
  error?: string
}

export type ChatMediaReport = {
  ok: boolean
  nodeId?: string
  url?: string
  error?: string
  /** 等待到时但任务仍在排队 / 生成：不是失败，卡片保持锁定，等后端终态 */
  pending?: boolean
  taskId?: number
}

export function isTaskActiveStatus(status: unknown) {
  return status === 'pending' || status === 'running'
}

/** 等待返回后按节点上的任务状态出报告（文案由调用方给，这里不碰 i18n） */
export function chatMediaReport(nodeId: string, view: NodeTaskView, texts: { stopped: string, failed: string }): ChatMediaReport {
  const status = String(view.status || '')
  const url = String(view.url || '')
  const taskId = Number(view.taskId) || 0
  if (status === 'succeeded' && url)
    return { ok: true, nodeId, url }
  if (isTaskActiveStatus(status))
    return { ok: false, pending: true, nodeId, taskId: taskId || undefined }
  if (status === 'cancelled')
    return { ok: false, nodeId, error: texts.stopped }
  return { ok: false, nodeId, error: String(view.error || '') || texts.failed }
}

export type ChatMediaVerdict = {
  /** placed：已出片；waiting：仍在排队 / 生成；failed：终态失败或已取消 */
  state: 'placed' | 'waiting' | 'failed'
  /** 只有终态失败 / 取消才解锁确认卡 */
  unlock: boolean
}

export function chatMediaVerdict(report: Pick<ChatMediaReport, 'ok' | 'pending'>): ChatMediaVerdict {
  if (report.ok)
    return { state: 'placed', unlock: false }
  if (report.pending)
    return { state: 'waiting', unlock: false }
  return { state: 'failed', unlock: true }
}

/** 仍在等后端终态的确认卡：「停止」兜底等旁路一律不许解锁它 */
export function chatMediaCardAwaiting(card: { waitingTaskId?: number } | null | undefined) {
  return Number(card?.waitingTaskId) > 0
}

/**
 * 跟踪中的节点任务走到哪了：
 * - waiting：还在跑（或画布还没载入这个节点），继续等；
 * - settled：后端给了终态；
 * - lost：节点被删 / 换成了别的任务，画布上看不到这条了，调用方要直接问后端。
 */
export function nodeTaskSettle(view: NodeTaskView | null | undefined, taskId: number, seen: boolean): 'waiting' | 'settled' | 'lost' {
  if (!view)
    return seen ? 'lost' : 'waiting'
  if ((Number(view.taskId) || 0) !== taskId)
    return 'lost'
  return isTaskActiveStatus(view.status) ? 'waiting' : 'settled'
}

/** 确认卡上与「一次出片」有关的字段（ChatMediaConfirmCard 的子集，别的卡没有这些字段） */
export type ChatMediaRunCard = {
  kind?: string
  locked?: boolean
  skipped?: boolean
  running?: boolean
  runTaskId?: number
  runNodeId?: string
  waitingTaskId?: number
  waitingNodeId?: string
}

/** 点了确认：锁卡并标成「出片中」 */
export function beginChatMediaRun(card: ChatMediaRunCard) {
  card.locked = true
  card.running = true
  delete card.runTaskId
  delete card.runNodeId
}

/** 任务建出来了：把任务 id / 节点 id 记在卡上（随会话一起存），之后这一轮被丢弃也能找后端对账 */
export function noteChatMediaTask(card: ChatMediaRunCard, taskId: number, nodeId?: string) {
  if (!(taskId > 0))
    return
  card.runTaskId = taskId
  card.runNodeId = String(nodeId || '')
}

/** 这一轮有了结论（回报到了 / 取消成功）：摘掉「出片中」标记。解不解锁由调用方按后端终态决定 */
export function endChatMediaRun(card: ChatMediaRunCard) {
  delete card.running
  delete card.runTaskId
  delete card.runNodeId
}

/** 确实处于「出片中」的确认卡。已出片成功的卡同样是 locked，但不带 running，不能算 */
export function chatMediaCardRunning(card: ChatMediaRunCard | null | undefined) {
  return Boolean(card && card.kind === 'media-confirm' && card.locked && !card.skipped && card.running && !chatMediaCardAwaiting(card))
}

/** 「停止」拿不到当前回复时的兜底对象：最近一张出片中的卡，没有就是 null（不去动更早成功的卡） */
export function findRunningChatMedia<T extends { card?: ChatMediaRunCard | null }>(rows: T[]): T | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (chatMediaCardRunning(rows[i]!.card))
      return rows[i]!
  }
  return null
}

/**
 * 出片途中这一轮被丢弃（切会话 / 刷新）的卡：没人再给它回报，会一直锁着。
 * 把它转成「等后端终态」的卡（waitingTaskId），交给已有的 resumeWaitingMedia 去问后端：
 * 终态就按结果标成功或解锁，还在跑就接着盯。这里不解锁——解锁只认后端终态。
 * liveTaskId 是当前仍在跑的那一轮的任务，它的回报还会来，不算被丢弃。
 */
export function adoptOrphanChatMediaRuns(rows: Array<{ card?: ChatMediaRunCard | null }>, liveTaskId = 0) {
  let adopted = 0
  for (const row of rows) {
    const card = row.card
    if (!card || !chatMediaCardRunning(card))
      continue
    const taskId = Number(card.runTaskId) || 0
    if (!taskId || taskId === liveTaskId)
      continue
    card.waitingTaskId = taskId
    card.waitingNodeId = String(card.runNodeId || '')
    endChatMediaRun(card)
    adopted += 1
  }
  return adopted
}

type ChatMediaMessage = {
  text: string
  error?: boolean
  thumb?: string
  card?: { locked?: boolean, waitingTaskId?: number, waitingNodeId?: string } | null
}

/**
 * 把一份出片报告落到对话气泡和确认卡上（首次等待返回、之后后端终态到达，走的是同一个函数）：
 * - placed：换成「已放到画布」，卡片保持锁定（已经花过这一次了）；
 * - waiting：换成「还在排队 / 生成中」的提示，卡片保持锁定并记下在等哪条任务；
 * - failed：写错误，解锁卡片——只有这一支会解锁。
 * hints 是之前可能写进气泡的进行中文案，换新状态前先摘掉，不让它们叠在一起。
 */
export function settleChatMediaMessage(
  msg: ChatMediaMessage,
  report: ChatMediaReport,
  texts: { placed: string, waiting: string, failed: string, hints?: string[] },
): ChatMediaVerdict {
  const verdict = chatMediaVerdict(report)
  let base = String(msg.text || '')
  for (const hint of [texts.waiting, ...(texts.hints || [])]) {
    if (hint)
      base = base.split(hint).join('')
  }
  base = base.trim()
  const withBase = (tail: string) => (base ? `${base}\n\n${tail}` : tail)
  const card = msg.card
  if (verdict.state === 'waiting') {
    msg.error = false
    msg.text = withBase(texts.waiting)
    if (card) {
      card.locked = true
      card.waitingTaskId = report.taskId
      card.waitingNodeId = report.nodeId
    }
    return verdict
  }
  if (card) {
    delete card.waitingTaskId
    delete card.waitingNodeId
  }
  if (verdict.state === 'placed') {
    msg.error = false
    msg.thumb = report.url
    msg.text = withBase(texts.placed)
    return verdict
  }
  msg.error = true
  msg.text = report.error || texts.failed
  if (card)
    card.locked = false
  return verdict
}
