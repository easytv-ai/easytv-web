/**
 * 撤销栈与批量提交（复刻自 open-director 的 store/directorStore.ts，MIT）。
 *
 * 所有会改场景的动作都走 commit()，它负责三件事：
 * 1. 改动前拍快照，改动后比一次，**没真的变就不进撤销栈** —— 拖拽时每帧都在提交，
 *    没有这道闸门撤销栈会被同一个位置塞满
 * 2. 批量期间（beginBatch / endBatch）只留第一张快照，一次拖拽 = 一步撤销
 * 3. 栈长超过上限就从头截断
 */
// 显式从 vue 导入：这层要能脱离 Nuxt 在纯 vitest 下跑，不能吃自动导入
import { computed, shallowRef, type Ref } from 'vue'
import { cloneDirectorState, isSameDirectorState, trimUndoStack, type DirectorState } from './state'

export interface CommitOptions {
  /** 关掉就不进撤销栈：纯 UI 状态（选中、折叠面板）不该占撤销步数 */
  trackUndo?: boolean
}

export function createDirectorHistory(state: Ref<DirectorState>) {
  /** 存的是每次改动**之前**的快照，撤销就是把栈顶弹回去 */
  const undoStack = shallowRef<DirectorState[]>([])
  const redoStack = shallowRef<DirectorState[]>([])

  let batchDepth = 0
  let batchSnapshot: DirectorState | null = null
  let batchHasTrackedChanges = false

  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)

  function clearRedo() {
    if (redoStack.value.length)
      redoStack.value = []
  }

  function commit(updater: (current: DirectorState) => DirectorState, options: CommitOptions = {}) {
    const { trackUndo = true } = options
    const before = cloneDirectorState(state.value)
    const next = updater(state.value)

    // 改完和改前一样就直接收工，别污染撤销栈
    if (isSameDirectorState(before, next)) {
      state.value = next
      return false
    }

    if (trackUndo) {
      if (batchDepth > 0) {
        // 批量里只认第一张快照，中间的全部丢掉
        if (batchSnapshot === null)
          batchSnapshot = before
        batchHasTrackedChanges = true
      }
      else {
        undoStack.value = trimUndoStack([...undoStack.value, before])
        clearRedo()
      }
    }

    state.value = next
    return true
  }

  /** 拖拽、连续输入这类连贯操作包在 begin/end 之间，撤销时算一步 */
  function beginBatch() {
    batchDepth += 1
  }

  function endBatch() {
    if (batchDepth === 0)
      return
    batchDepth -= 1
    if (batchDepth > 0)
      return

    if (batchHasTrackedChanges && batchSnapshot) {
      undoStack.value = trimUndoStack([...undoStack.value, batchSnapshot])
      clearRedo()
    }

    batchSnapshot = null
    batchHasTrackedChanges = false
  }

  function undo() {
    const stack = undoStack.value
    if (!stack.length)
      return false
    const previous = stack[stack.length - 1]!
    undoStack.value = stack.slice(0, -1)
    redoStack.value = trimUndoStack([...redoStack.value, cloneDirectorState(state.value)])
    state.value = cloneDirectorState(previous)
    return true
  }

  function redo() {
    const stack = redoStack.value
    if (!stack.length)
      return false
    const next = stack[stack.length - 1]!
    redoStack.value = stack.slice(0, -1)
    undoStack.value = trimUndoStack([...undoStack.value, cloneDirectorState(state.value)])
    state.value = cloneDirectorState(next)
    return true
  }

  /** 装载新场景时连撤销栈一起清掉，免得撤回到上一个场景去 */
  function reset(next: DirectorState) {
    undoStack.value = []
    redoStack.value = []
    batchDepth = 0
    batchSnapshot = null
    batchHasTrackedChanges = false
    state.value = next
  }

  return { undoStack, redoStack, canUndo, canRedo, commit, beginBatch, endBatch, undo, redo, reset }
}

export type DirectorHistory = ReturnType<typeof createDirectorHistory>
