/** 平移 / 缩放时不写 Vue 状态，只改 HUD 合成层，避免整棵工作区重渲染。 */

export type CanvasLiveViewport = {
  x: number
  y: number
  zoom: number
}

export function copyCanvasLiveViewport(vp: CanvasLiveViewport): CanvasLiveViewport {
  return {
    x: vp.x,
    y: vp.y,
    zoom: vp.zoom || 1,
  }
}

export function sameCanvasLiveViewport(left: CanvasLiveViewport, right: CanvasLiveViewport) {
  return left.x === right.x && left.y === right.y && (left.zoom || 1) === (right.zoom || 1)
}

/**
 * 把「按旧视口算好的屏幕坐标」映射到新视口。
 * HUD 用 transform-origin: 0 0，子元素仍是 position:fixed 的客户端坐标。
 */
export function canvasLiveHudTransform(
  start: CanvasLiveViewport,
  next: CanvasLiveViewport,
  origin: { left: number, top: number },
) {
  const startZoom = start.zoom || 1
  const nextZoom = next.zoom || 1
  const scale = nextZoom / startZoom
  const tx = origin.left + next.x - scale * (origin.left + start.x)
  const ty = origin.top + next.y - scale * (origin.top + start.y)
  if (Math.abs(tx) < 0.05 && Math.abs(ty) < 0.05 && Math.abs(scale - 1) < 1e-5)
    return ''
  if (Math.abs(scale - 1) < 1e-5)
    return `translate(${tx}px, ${ty}px)`
  return `translate(${tx}px, ${ty}px) scale(${scale})`
}

/** 与 Vue Flow 世界层同一条 transform，滚轮平移直接写 DOM，不经过 setViewport。 */
export function canvasPaneTransform(vp: CanvasLiveViewport) {
  const zoom = vp.zoom || 1
  return `translate(${vp.x}px, ${vp.y}px) scale(${zoom})`
}

export function applyCanvasPaneTransform(el: HTMLElement | null, vp: CanvasLiveViewport) {
  if (!el)
    return
  el.style.transformOrigin = '0 0'
  el.style.transform = canvasPaneTransform(vp)
  el.style.willChange = 'transform'
}

export function applyCanvasLiveHud(
  el: HTMLElement | null,
  transform: string,
  interacting: boolean,
) {
  if (!el)
    return
  el.style.transformOrigin = '0 0'
  el.style.transform = transform
  el.style.willChange = interacting && transform ? 'transform' : ''
}
