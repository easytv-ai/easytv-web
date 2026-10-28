/**
 * 相机补间的纯计算部分：缓动、插值、时长、收敛判定、reveal 的位移几何、指数趋近系数。
 *
 * 拆出来的理由：这套数学在 node 环境的 vitest 里能直接跑（不碰 DOM、不碰 rAF），
 * 而 rAF 调度、打断、写视口那部分（useCanvasCameraGlide）只能靠浏览器验收。
 *
 * 命名口径（与设计文档 §6.1 对齐）：
 * - 时长 = 160 + 0.25*等效位移，夹在 [200, 420]；整屏级位移刻意比 hover/focus（150–200ms）长；
 * - 缓动 = easeOutCubic（快进慢收，与 organizeCanvas 的 d3 手感同族）；
 * - 跟练的两处调用（reveal 与成片居中）zoom 恒等，插值实际只作用于 x/y。
 *
 * 交叉源：`--st-motion-camera: 260ms`（app/assets/css/studio-parts/tokens-motion.css）
 * 与本文件的 CAMERA_GLIDE_MS 是同一个数，改一边要改另一边（测试各锁一处）。
 */

export type CanvasViewport3 = { x: number, y: number, zoom: number }

/** 相机补间的最短时长（ms）：太短会看不出「滑过去」，位移再小也给这个值 */
export const CAMERA_GLIDE_MIN_MS = 200
/** 相机补间的最长时长（ms）：再远也不拖，超过就砍到这个值 */
export const CAMERA_GLIDE_MAX_MS = 420
/** 每像素位移折算的时长（ms/px） */
export const CAMERA_GLIDE_MS_PER_PX = 0.25
/** 时长公式的基数（ms）：160 + 0.25*位移（典型 100–400px → 200–260ms） */
const CAMERA_GLIDE_BASE_MS = 160
/** 缩放差折算成等效位移的比例（px/倍）：1 倍缩放差按 1200px 位移算 */
const CAMERA_GLIDE_ZOOM_PX = 1200
/** 默认整段时长（ms），与 CSS 令牌 --st-motion-camera 同值；给「成片到达感」这类定长滑动用 */
export const CAMERA_GLIDE_MS = 260

/** 出场缓动 easeOutCubic：t 夹到 [0,1]，t<=0 → 0，t>=1 → 1（两端精确，避免补间收尾差一点） */
export function canvasEaseOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0))
  return 1 - (1 - clamped) ** 3
}

/** from → to 走 t（0..1）的视口：先过 easeOutCubic，再逐分量线性插值（zoom 同一条，本功能里恒等） */
export function canvasViewportAt(from: CanvasViewport3, to: CanvasViewport3, t: number): CanvasViewport3 {
  const eased = canvasEaseOutCubic(t)
  return {
    x: from.x + (to.x - from.x) * eased,
    y: from.y + (to.y - from.y) * eased,
    zoom: from.zoom + (to.zoom - from.zoom) * eased,
  }
}

/**
 * 补间时长：160 + 0.25*位移(px)，夹在 [200, 420]。
 * 「位移」= x/y 的欧氏距离 + 缩放差按 1200px/倍折算；跟练里 zoom 恒等，第二项为 0。
 */
export function canvasTweenDuration(
  from: CanvasViewport3,
  to: CanvasViewport3,
  opts?: { minMs?: number, maxMs?: number, msPerPx?: number },
): number {
  const minMs = opts?.minMs ?? CAMERA_GLIDE_MIN_MS
  const maxMs = opts?.maxMs ?? CAMERA_GLIDE_MAX_MS
  const msPerPx = opts?.msPerPx ?? CAMERA_GLIDE_MS_PER_PX
  const distance = Math.hypot(to.x - from.x, to.y - from.y) + Math.abs(to.zoom - from.zoom) * CAMERA_GLIDE_ZOOM_PX
  const raw = CAMERA_GLIDE_BASE_MS + msPerPx * distance
  return Math.min(Math.max(minMs, raw), Math.max(minMs, maxMs))
}

/** 是否已收敛（提前收尾，避免亚像素抖动）：|dx|、|dy| < 0.5px 且 |dzoom| < 0.001 */
export function canvasViewportSettled(a: CanvasViewport3, b: CanvasViewport3): boolean {
  return Math.abs(a.x - b.x) < 0.5
    && Math.abs(a.y - b.y) < 0.5
    && Math.abs(a.zoom - b.zoom) < 0.001
}

/**
 * 把锚点元素带进舞台可视区要平移多少：从「锚点矩形 + 舞台矩形 + 内边距」算。
 *
 * 视口平移与元素的 client 位移是 1:1（zoom 不变），所以返回的 dx/dy 直接加到 viewport 上。
 * 四种越界各自处理；元素比舞台还高时只保证顶部对齐，底边交给用户自己看。
 */
export function canvasRevealShift(
  anchor: { left: number, top: number, right: number, bottom: number, height: number },
  pane: { left: number, top: number, width: number, height: number },
  pad = 16,
): { dx: number, dy: number } {
  const right = pane.left + pane.width - pad
  const bottom = pane.top + pane.height - pad
  let dx = 0
  let dy = 0
  if (anchor.left < pane.left + pad)
    dx = pane.left + pad - anchor.left
  else if (anchor.right > right)
    dx = right - anchor.right
  if (anchor.height > pane.height - pad * 2)
    dy = pane.top + pad - anchor.top
  else if (anchor.top < pane.top + pad)
    dy = pane.top + pad - anchor.top
  else if (anchor.bottom > bottom)
    dy = bottom - anchor.bottom
  return { dx, dy }
}

/**
 * 帧率无关的指数趋近系数：k = 1 - 2^(-dtMs/halfLifeMs)。
 * 用 2 的幂而不是 e：半衰期的语义就是「半个半衰期后误差减半」，120Hz 与 60Hz 手感一致。
 * halfLifeMs <= 0 → 1（直落：相机补间在飞 / 锚点换对象 / reduced-motion 三种情况都用它）。
 */
export function canvasApproachFactor(dtMs: number, halfLifeMs: number): number {
  if (!(halfLifeMs > 0))
    return 1
  const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0
  return 1 - 2 ** (-dt / halfLifeMs)
}

/** 系统是否要求减少动态效果；可注入 matcher 以便测试，无 window（SSR）时返回 false */
export function prefersReducedMotion(win?: { matchMedia?: (q: string) => { matches: boolean } }): boolean {
  const target = win ?? (typeof window === 'undefined' ? null : window)
  if (!target?.matchMedia)
    return false
  try {
    return target.matchMedia('(prefers-reduced-motion: reduce)').matches
  }
  catch {
    // 老浏览器 / 异常实现：当作不降级，别让动效开关把跟练整个绊倒
    return false
  }
}
