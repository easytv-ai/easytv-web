/**
 * 画布自动保存的状态机（纯逻辑，页面只负责调接口）。
 *
 * 用「修改计数」而不是一个 saveState 字符串判脏：
 * - 每次改动 dirtyRevision + 1；
 * - 开始保存时记下这次带走的是第几版（inFlightRevision）；
 * - 保存成功只把 savedRevision 推到 inFlightRevision —— 保存途中又改了的话
 *   dirtyRevision 仍然更大，页面不会被旧响应标成「已保存」。
 * 进行中用独立的 inFlight 标志，markChanged 不会覆盖它，互斥不会失效。
 * 版本冲突单独成态：停掉自动保存，等用户选「重新加载」或「覆盖」。
 */

export type SaveOutcome = 'ok' | 'error' | 'conflict'
export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict'

export type SaveMachine = {
  dirtyRevision: number
  savedRevision: number
  inFlight: boolean
  inFlightRevision: number
  /** 最近一次保存失败（非冲突），下次成功前一直算未保存 */
  failed: boolean
  /** 服务端版本已被别处推进，自动保存暂停 */
  conflict: boolean
  /** 服务端上已经有这张画布（读到过或存成功过） */
  persisted: boolean
}

export function createSaveMachine(options: { persisted?: boolean } = {}): SaveMachine {
  return {
    dirtyRevision: 0,
    savedRevision: 0,
    inFlight: false,
    inFlightRevision: 0,
    failed: false,
    conflict: false,
    persisted: Boolean(options.persisted),
  }
}

export function markChanged(m: SaveMachine): SaveMachine {
  return { ...m, dirtyRevision: m.dirtyRevision + 1 }
}

export function hasPendingChanges(m: SaveMachine) {
  return m.dirtyRevision > m.savedRevision
}

/** 离开页面前要不要拦：有没存上的改动、正在存、上次失败或冲突都算 */
export function hasUnsavedChanges(m: SaveMachine) {
  return hasPendingChanges(m) || m.inFlight || m.failed || m.conflict
}

/** 自动保存能不能发起：冲突时一律不自动存，避免拿旧 version 循环失败 */
export function canAutoSave(m: SaveMachine) {
  return !m.inFlight && !m.conflict && hasPendingChanges(m)
}

export function beginSave(m: SaveMachine): SaveMachine {
  return { ...m, inFlight: true, inFlightRevision: m.dirtyRevision }
}

export function finishSave(m: SaveMachine, outcome: SaveOutcome): SaveMachine {
  const next: SaveMachine = { ...m, inFlight: false }
  if (outcome === 'ok') {
    next.savedRevision = Math.max(m.savedRevision, m.inFlightRevision)
    next.failed = false
    next.conflict = false
    next.persisted = true
  }
  else if (outcome === 'conflict') {
    next.conflict = true
    next.failed = false
  }
  else {
    next.failed = true
  }
  return next
}

/** 保存结束后还要不要再排一次：成功但途中又有新改动 */
export function needsFollowUp(m: SaveMachine) {
  return !m.inFlight && !m.conflict && !m.failed && hasPendingChanges(m)
}

/**
 * 解决冲突。
 * - reload：丢掉本地改动，已载入服务端最新版，视为全部已保存；
 * - overwrite：拿到最新 version 后用本地 graph 再存一次，这里只解除冲突态，由调用方发起保存。
 */
export function resolveConflict(m: SaveMachine, choice: 'reload' | 'overwrite'): SaveMachine {
  if (choice === 'reload')
    return { ...m, conflict: false, failed: false, savedRevision: m.dirtyRevision, persisted: true }
  return { ...m, conflict: false, failed: false }
}

export function saveStatus(m: SaveMachine): SaveStatus {
  if (m.conflict)
    return 'conflict'
  if (m.inFlight)
    return 'saving'
  if (m.failed)
    return 'error'
  if (hasPendingChanges(m))
    return 'dirty'
  return m.persisted ? 'saved' : 'idle'
}

/** 空画布保护的基线：服务端上曾有这么多节点，现在几乎没有了才算可疑（新建的空画布不算） */
export const WIPE_GUARD_MIN_NODES = 3
/** 剩这么多（含）节点算「几乎空」：重挂载后的空画布会自带一个起步占位节点，所以不是只认 0 */
export const WIPE_GUARD_MAX_LEFT = 1

/**
 * 画布是不是「意外变空」：上次载入 / 保存时有 ≥3 个节点，这次要存的只剩 ≤1 个。
 * 实测发生过：画布组件被重挂载成空图后，自动保存把 40 个节点的画布覆盖成了 1 个占位节点。
 * 用户真要清空可以手动保存并确认；自动保存遇到这种情况只暂停不覆盖。
 */
export function isSuspiciousWipe(baselineNodes: number, nextNodes: number) {
  return baselineNodes >= WIPE_GUARD_MIN_NODES && nextNodes <= WIPE_GUARD_MAX_LEFT
}

/** 后端乐观锁冲突没有错误码，只有这句话（easytv-api model.ErrCanvasVersionConflict） */
export function isCanvasVersionConflictMessage(message: unknown) {
  return typeof message === 'string' && /已在其他地方修改/.test(message)
}

/** 停手后多久自动保存。连续改动从第一次算起，最多推迟 AUTOSAVE_MAX_WAIT_MS。 */
export const AUTOSAVE_DELAY_MS = 2500
export const AUTOSAVE_MAX_WAIT_MS = 10000

export function autosaveDelayMs(
  now: number,
  firstAt: number,
  delay = AUTOSAVE_DELAY_MS,
  maxWait = AUTOSAVE_MAX_WAIT_MS,
) {
  return Math.max(0, Math.min(delay, firstAt + maxWait - now))
}

export type CanvasSaveGate =
  | { action: 'skip' }
  | { action: 'practice' }
  | { action: 'conflict' }
  | { action: 'save' }

/**
 * 这一下保存要不要真的发请求。
 * 加载中 / 只读直接跳过；跟练和版本冲突也不落库，手动保存时由页面分别提示或弹窗。
 */
export function gateCanvasSave(input: {
  loading: boolean
  readonly: boolean
  practice: boolean
  conflict: boolean
}): CanvasSaveGate {
  if (input.loading || input.readonly)
    return { action: 'skip' }
  if (input.practice)
    return { action: 'practice' }
  if (input.conflict)
    return { action: 'conflict' }
  return { action: 'save' }
}

/**
 * 串行执行器：同一时刻只跑一个任务；跑的途中再请求就记一笔，跑完接着跑一次（多次请求合并成一次）。
 * 返回的 promise 在队列清空后 resolve，调用方 await 能拿到「包含我这次请求」的结果。
 */
export function createSerialRunner(task: (manual: boolean) => Promise<void>) {
  let running: Promise<void> | null = null
  let requested = false
  let manualRequested = false

  function request(manual = false): Promise<void> {
    requested = true
    if (manual)
      manualRequested = true
    if (!running) {
      running = (async () => {
        try {
          while (requested) {
            requested = false
            const isManual = manualRequested
            manualRequested = false
            await task(isManual)
          }
        }
        finally {
          running = null
        }
      })()
    }
    return running
  }

  return {
    request,
    get busy() {
      return running !== null
    },
  }
}
