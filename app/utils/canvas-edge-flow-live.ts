import { shallowRef } from 'vue'

export type CanvasEdgeFlowLive = { id: string, d: string }

const byId = new Map<string, string>()
const live = shallowRef<CanvasEdgeFlowLive[]>([])

/** 选中后要流动的连线。所有线进同一张 SVG，避免每条线各自重画整屏。 */
export function canvasEdgeFlowLivePaths() {
  return live
}

export function setCanvasEdgeFlowLive(id: string, d: string | null) {
  if (!d) {
    if (!byId.delete(id))
      return
  }
  else if (byId.get(id) === d) {
    return
  }
  else {
    byId.set(id, d)
  }
  const next: CanvasEdgeFlowLive[] = []
  for (const [key, path] of byId)
    next.push({ id: key, d: path })
  live.value = next
}
