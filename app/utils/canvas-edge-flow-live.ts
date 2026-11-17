import { shallowRef } from 'vue'

export type CanvasEdgeFlowLive = { id: string, d: string }

const byId = new Map<string, string>()
const live = shallowRef<CanvasEdgeFlowLive[]>([])
let queued = false

/** 选中后要流动的连线。所有线进同一张 SVG，避免每条线各自重画整屏。 */
export function canvasEdgeFlowLivePaths() {
  return live
}

/**
 * 流动层画进变换层后，端点会有亚像素回写。
 * 差不到 1 像素就保持原路径，避免选中后自己把自己刷新死。
 */
function sameLine(prev: string, next: string) {
  const a = prev.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)
  const b = next.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)
  if (!a || !b || a.length !== b.length)
    return false
  for (let i = 0; i < a.length; i++) {
    const delta = Number(a[i]) - Number(b[i])
    if (!Number.isFinite(delta) || Math.abs(delta) > 0.75)
      return false
  }
  return true
}

function publish() {
  queued = false
  const prev = live.value
  if (prev.length === byId.size) {
    let unchanged = true
    let index = 0
    for (const [id, d] of byId) {
      const item = prev[index]
      if (!item || item.id !== id || item.d !== d) {
        unchanged = false
        break
      }
      index += 1
    }
    if (unchanged)
      return
  }
  const next: CanvasEdgeFlowLive[] = []
  for (const [id, d] of byId)
    next.push({ id, d })
  live.value = next
}

function schedule() {
  if (queued)
    return
  queued = true
  // 推到当前这轮 Vue 更新之后。写在渲染过程里会把流动层再次排进同一轮队列。
  if (typeof requestAnimationFrame === 'function')
    requestAnimationFrame(publish)
  else
    queueMicrotask(publish)
}

export function setCanvasEdgeFlowLive(id: string, d: string | null) {
  if (!d) {
    if (!byId.delete(id))
      return
  }
  else {
    const prev = byId.get(id)
    if (prev !== undefined && (prev === d || sameLine(prev, d)))
      return
    byId.set(id, d)
  }
  schedule()
}
