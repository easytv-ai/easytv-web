/** 与 CanvasWorkspace / Vue Flow 的 min-zoom、max-zoom 保持一致 */
export const CANVAS_MIN_ZOOM = 0.15
export const CANVAS_MAX_ZOOM = 8

export type CanvasViewport = { x: number, y: number, zoom: number }

/**
 * 与 @vue-flow/core 的 wheelDelta 一致：把滚轮 delta 换成缩放指数。
 * Mac 触控板捏合会带 ctrlKey，步长要放大，手感才和空白画布上的缩放一样。
 */
export function canvasWheelZoomDelta(
  event: Pick<WheelEvent, 'deltaY' | 'deltaMode' | 'ctrlKey'>,
  mac = false,
) {
  const factor = event.ctrlKey && mac ? 10 : 1
  const unit = event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002
  return -event.deltaY * unit * factor
}

export function clampCanvasZoom(zoom: number, min = CANVAS_MIN_ZOOM, max = CANVAS_MAX_ZOOM) {
  return Math.min(max, Math.max(min, zoom))
}

/** 缩放后仍让该画布坐标落在指针下（屏幕落点不变） */
export function canvasViewportAtFlowPoint(
  viewport: CanvasViewport,
  flowPoint: { x: number, y: number },
  nextZoom: number,
): CanvasViewport {
  const zoom = viewport.zoom || 1
  return {
    x: viewport.x + flowPoint.x * zoom - flowPoint.x * nextZoom,
    y: viewport.y + flowPoint.y * zoom - flowPoint.y * nextZoom,
    zoom: nextZoom,
  }
}
