import { canvasApproachFactor } from '~/utils/canvas-viewport-tween'

/** 与 CanvasWorkspace / Vue Flow 的 min-zoom、max-zoom 保持一致 */
export const CANVAS_MIN_ZOOM = 0.15
export const CANVAS_MAX_ZOOM = 8
/** 与原先 Vue Flow pan-on-scroll-speed 一致 */
export const CANVAS_WHEEL_PAN_SPEED = 0.85
/** 滚轮/触控板停手后再提交 HUD，惯性滚动期间保持交互态 */
export const CANVAS_WHEEL_IDLE_MS = 180
/** 鼠标滚轮 / 行模式：一步很大，滑一下再停，避免一格跳一截 */
export const CANVAS_WHEEL_PAN_HALF_LIFE_MS = 28
/** 触控板像素流：本帧直接落到累计目标，不再叠一层滞后 */
export const CANVAS_WHEEL_PAN_PIXEL_HALF_LIFE_MS = 0
const CANVAS_WHEEL_NO_PAN = '.nowheel, textarea, input, select, [contenteditable="true"]'

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

/** 画布上的滚轮平移：像素 delta 转视口位移。Shift+只有纵向时改成横移。 */
export function canvasWheelPanDelta(
  event: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode' | 'shiftKey'>,
  speed = CANVAS_WHEEL_PAN_SPEED,
) {
  let dx = event.deltaX
  let dy = event.deltaY
  if (event.shiftKey && !dx && dy) {
    dx = dy
    dy = 0
  }
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode ? 32 : 1
  return {
    x: -dx * unit * speed,
    y: dy ? -dy * unit * speed : 0,
  }
}

/**
 * 触控板是小步连发（间隔很短）；Windows 上鼠标滚轮也报像素模式，但一步就一百多、而且孤立。
 * 连发走直落，孤立大步才用半衰期。
 */
export function canvasWheelPanHalfLife(
  event: { deltaX: number, deltaY: number, deltaMode: number },
  gapMs: number,
) {
  if (event.deltaMode !== 0)
    return CANVAS_WHEEL_PAN_HALF_LIFE_MS
  const mag = Math.hypot(event.deltaX || 0, event.deltaY || 0)
  if (mag >= 80 && gapMs > 40)
    return CANVAS_WHEEL_PAN_HALF_LIFE_MS
  return CANVAS_WHEEL_PAN_PIXEL_HALF_LIFE_MS
}

/** 当前视口向滚轮目标做一帧指数趋近，和抓手拖动一样只改坐标、不碰 Vue。 */
export function canvasWheelPanFollow(
  shown: CanvasViewport,
  target: CanvasViewport,
  dtMs: number,
  halfLifeMs = CANVAS_WHEEL_PAN_HALF_LIFE_MS,
) {
  const k = canvasApproachFactor(dtMs, halfLifeMs)
  return {
    x: shown.x + (target.x - shown.x) * k,
    y: shown.y + (target.y - shown.y) * k,
    zoom: shown.zoom || 1,
  }
}

/** 只有落在舞台上、且不是 nowheel 控件时才由画布接管平移 */
export function canvasWheelPanTarget(target: EventTarget | null) {
  if (!(target instanceof Element))
    return null
  if (!target.closest('.canvas-workspace'))
    return null
  if (target.closest(CANVAS_WHEEL_NO_PAN))
    return null
  return target.closest('.canvas-flow')
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
