/**
 * 跟练浮层（CanvasPracticeTour）的聚光 / 卡片平滑几何：纯函数、零依赖、node 环境可测。
 *
 * 为什么是「指数趋近」而不是 CSS transition：聚光框的位置由 rAF 每帧算（锚点会跟着画布平移
 * 与相机补间一起动），CSS transition 会和逐帧写入抢同一个属性；指数趋近把 dt 折进公式，
 * 掉帧时路径不变（16.7ms 走两帧 ≈ 33.4ms 走一帧），所以是帧率无关的。
 */

import type { GuideRect, GuideViewport } from '~/utils/canvas-guide-card'

/** 稳态跟随的半衰期：每过一个半衰期，与目标的差距减半 */
export const GUIDE_SPOT_HALF_LIFE_MS = 90
/** 卡片避让移位的半衰期：比聚光再钝一点，免得卡片跟着聚光抖 */
export const GUIDE_CARD_HALF_LIFE_MS = 110
/** 卡片滑行期间挂的类名（CSS 里 pointer-events: none）：滑过锚点会吞掉用户一次点击 */
export const GUIDE_CARD_GLIDE_CLASS = 'is-gliding'
/** 收敛阈值（px）：差值小于它就落到目标精确值，免得每帧写一个亚像素差的响应式值 */
export const GUIDE_SETTLE_PX = 0.5

/**
 * 指数趋近的系数 k = 1 - 2^(-dt/halfLife)（halfLife <= 0 视为「直落」，k = 1）。
 * dt <= 0（首帧 / 手动触发的那一次测量）不动，交给调用方决定要不要直落。
 */
export function guideApproachFactor(dtMs: number, halfLifeMs: number): number {
  if (!(halfLifeMs > 0))
    return 1
  if (!(dtMs > 0))
    return 0
  return 1 - 2 ** (-dtMs / halfLifeMs)
}

/**
 * 一维的指数趋近：next = cur + (target - cur) * k。
 * halfLife <= 0 直接给目标值（reduced-motion / 相机补间在飞 / 锚点换身份都走这条）。
 */
export function guideApproach(cur: number, target: number, dtMs: number, halfLifeMs: number): number {
  const k = guideApproachFactor(dtMs, halfLifeMs)
  const next = cur + (target - cur) * k
  return Math.abs(target - next) < GUIDE_SETTLE_PX ? target : next
}

/** 锚点矩形 → 聚光框：外扩一圈呼吸位，再夹到窗口里（与 canvas.css 的 .canvas-guide__spot 同一口径，8 是贴边的最小净空、16 = 左右各 8，照原实现搬） */
export function guideSpotRect(rect: GuideRect, pad: number, win: GuideViewport): GuideRect {
  return {
    left: Math.max(8, rect.left - pad),
    top: Math.max(8, rect.top - pad),
    width: Math.min(win.width - 16, rect.width + pad * 2),
    height: rect.height + pad * 2,
  }
}

/**
 * 锚点不在时的聚光：矩形补到整视口（视觉上是洞收拢成全屏遮罩）。
 * 别用 {0,0,0,0} 当起点——那会出现一条线扫过整个屏幕。
 */
export function guideSpotFullscreen(win: GuideViewport): GuideRect {
  return { left: 0, top: 0, width: win.width, height: win.height }
}

/** 卡片 / 聚光的定位一律走 transform（.canvas-guide 已 inset:0，坐标原点即视口原点，left/top 固定 0） */
export function guideCardTransform(position: { left: number, top: number }): string {
  return `translate3d(${position.left}px, ${position.top}px, 0)`
}

/** 系统「减少动态效果」：会话开始时读一次（跟练是分钟级会话，不加 matchMedia 监听，少一个清理点） */
export function guideReducedMotion(win?: { matchMedia?: (query: string) => { matches: boolean } } | null): boolean {
  const target = win ?? (typeof window !== 'undefined' ? window : null)
  try {
    return Boolean(target?.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  }
  catch {
    // 某些内嵌 WebView 的 matchMedia 会抛：按「不降级」处理，动效照跑
    return false
  }
}
