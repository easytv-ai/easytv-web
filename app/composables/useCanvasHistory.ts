import { computed, nextTick, ref } from 'vue'

export type CanvasHistorySnap = { nodes: string, edges: string }

const HISTORY_LIMIT = 40

type SnapList = { value: unknown }

/**
 * 画布撤销栈。lock：程序写节点时不要入栈；suppress：载入期间不要通知父页保存。
 */
export function useCanvasHistory(opts: {
  nodes: SnapList
  edges: SnapList
  emitChange: () => void
}) {
  const historySnaps = ref<CanvasHistorySnap[]>([])
  const historyIndex = ref(-1)
  const canUndo = computed(() => historyIndex.value > 0)
  const canRedo = computed(() => historyIndex.value >= 0 && historyIndex.value < historySnaps.value.length - 1)
  const gate = { lock: false, suppress: true }
  /**
   * 挂起（跟练期间）：练习数据全部丢进垃圾桶，一条也不进用户的历史栈。
   * 独立开关，不复用 gate.lock——lock 是"程序正在写节点"的短锁（删除兜底、助手落图、载入），
   * 拿它当跟练开关会把正常的撤销点一起吞掉。
   */
  const suspended = ref(false)

  function snapshot(): CanvasHistorySnap {
    return {
      nodes: JSON.stringify(opts.nodes.value),
      edges: JSON.stringify(opts.edges.value),
    }
  }

  function notifyChange() {
    if (!gate.suppress)
      opts.emitChange()
  }

  function pushHistory() {
    if (gate.lock || suspended.value)
      return
    const snap = snapshot()
    const top = historySnaps.value[historyIndex.value]
    // 同一次操作被显式调用和删除兜底各压一次时，内容相同就不重复入栈，免得撤销要按两下
    if (top && top.nodes === snap.nodes && top.edges === snap.edges) {
      notifyChange()
      return
    }
    historySnaps.value = historySnaps.value.slice(0, historyIndex.value + 1)
    historySnaps.value.push(snap)
    if (historySnaps.value.length > HISTORY_LIMIT)
      historySnaps.value.shift()
    historyIndex.value = historySnaps.value.length - 1
    notifyChange()
  }

  function restoreHistory(index: number) {
    const snap = historySnaps.value[index]
    if (!snap)
      return
    gate.lock = true
    historyIndex.value = index
    opts.nodes.value = JSON.parse(snap.nodes)
    opts.edges.value = JSON.parse(snap.edges)
    notifyChange()
    nextTick(() => {
      gate.lock = false
    })
  }

  function undo() {
    if (historyIndex.value <= 0)
      return
    restoreHistory(historyIndex.value - 1)
  }

  function redo() {
    if (historyIndex.value >= historySnaps.value.length - 1)
      return
    restoreHistory(historyIndex.value + 1)
  }

  function resetHistory() {
    historySnaps.value = [snapshot()]
    historyIndex.value = 0
  }

  return {
    historySnaps,
    historyIndex,
    canUndo,
    canRedo,
    gate,
    suspended,
    snapshot,
    pushHistory,
    notifyChange,
    restoreHistory,
    undo,
    redo,
    resetHistory,
  }
}
