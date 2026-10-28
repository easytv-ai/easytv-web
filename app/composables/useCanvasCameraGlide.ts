/**
 * 相机补间的驱动器：把 canvas-viewport-tween 的纯计算按 rAF 逐帧写进 Vue Flow 的视口。
 *
 * 为什么不用 `setCenter(.., { duration })`（d3 自己的过渡）：
 * - 拿不到进度，也就没法「补间中途被 reveal 重定向」与「补间在飞时让聚光直落」；
 * - 拿不到「用户接管」的回调（Vue Flow 的 moveStart/moveEnd 有 sourceEvent 守卫，程序化写入不触发）；
 * - 数学全在 d3 里，vitest（node 环境、不挂 DOM）一条都测不到。
 *
 * 四条必须守住的约束（踩了都不报错，只是行为悄悄坏掉）：
 * 1. **单一补间槽**：新目标覆盖旧目标，起点 = 旧补间的当前插值（自己持有 current，
 *    绝不每帧回读 opts.viewport.value——圈选拖拽期间 d3 的 zoom 处理器会解绑，viewport 不再跟随）；
 * 2. **一帧只写一次 setViewport**，循环里不再调 setCenter / fitView（否则一帧两次全量派生刷新）；
 * 3. **不绑 @viewport-change / @move**：那两个每帧都触发，驱动它们容易成环；
 * 4. **退出即静默**：cancel() 不写最后一帧（宿主退出时会 loadGraph 还原视口，补间若在还原后落一帧会把它又挪走）。
 */

import { onScopeDispose, ref, type Ref } from 'vue'
import {
  canvasTweenDuration,
  canvasViewportAt,
  canvasViewportSettled,
  prefersReducedMotion,
  type CanvasViewport3,
} from '~/utils/canvas-viewport-tween'

export type CanvasCameraGlide = {
  /** 平滑到目标视口；已在飞的重定向（从当前帧位置续走）。true = 已到达，false = 被取消/被新目标接管 */
  glideTo: (to: CanvasViewport3, o?: { durationMs?: number }) => Promise<boolean>
  /** reveal 语义：按 dx/dy 平移（dx/dy 由 canvasRevealShift 给），zoom 不变 */
  panBy: (dx: number, dy: number, o?: { durationMs?: number }) => Promise<boolean>
  /** 停掉在飞的补间（用户接管 / 退出跟练 / scope 销毁），不写最后一帧 */
  cancel: () => void
  /** 补间是否在飞：聚光据此从「90ms 平滑跟随」切成「直落」，避免吊在匀速移动的节点后面 */
  tweening: Ref<boolean>
}

export function useCanvasCameraGlide(opts: {
  viewport: Ref<CanvasViewport3>
  setViewport: (vp: CanvasViewport3) => void
  /** reduced-motion 只在会话开始时读一次（跟练是分钟级会话，不为它多挂一个监听） */
  reducedMotion?: () => boolean
}): CanvasCameraGlide {
  const tweening = ref(false)
  /** rAF 句柄（无 rAF 的环境退化成定时器） */
  let frame: number | null = null
  /** 本次补间的当前插值：新补间的起点取它，而不是回读 opts.viewport.value */
  let current: CanvasViewport3 | null = null
  /** 在飞的补间对应的 Promise resolver（打断 / 取消时解成 false） */
  let settle: ((arrived: boolean) => void) | null = null

  const now = () => (typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now())

  function schedule(fn: () => void): number {
    // 补间只在客户端发起；SSR 分支只为「万一」存在（Node 的 Timeout 有 Symbol.toPrimitive，Number() 拿得到 id）
    return typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(fn)
      : Number(setTimeout(fn, 16))
  }

  function unschedule(id: number) {
    if (typeof cancelAnimationFrame === 'function')
      cancelAnimationFrame(id)
    else
      clearTimeout(id)
  }

  function stopFrame() {
    if (frame !== null) {
      unschedule(frame)
      frame = null
    }
  }

  /** 收敛：写最后一帧精确值（避免亚像素抖动永远差一点），再解掉 Promise */
  function arrive(to: CanvasViewport3) {
    stopFrame()
    current = null
    tweening.value = false
    opts.setViewport({ x: to.x, y: to.y, zoom: to.zoom })
    const done = settle
    settle = null
    done?.(true)
  }

  function cancel() {
    stopFrame()
    current = null
    tweening.value = false
    const done = settle
    settle = null
    done?.(false)
  }

  function run(to: CanvasViewport3, durationMs?: number): Promise<boolean> {
    // 新目标覆盖旧目标：旧的那次算「被打断」（false），别让它把 Promise 悬着
    const previous = settle
    settle = null
    previous?.(false)
    stopFrame()

    const from = current ? { ...current } : { ...opts.viewport.value }
    const duration = Math.max(0, Number(durationMs ?? canvasTweenDuration(from, to)) || 0)
    const reduced = opts.reducedMotion?.() ?? prefersReducedMotion()

    // reduced-motion / 零时长：直接写一次目标，不进 rAF
    if (duration <= 0 || reduced) {
      current = null
      tweening.value = false
      opts.setViewport({ x: to.x, y: to.y, zoom: to.zoom })
      return Promise.resolve(true)
    }

    current = from
    tweening.value = true
    const startedAt = now()
    return new Promise<boolean>((resolve) => {
      settle = resolve
      const step = () => {
        frame = null
        const t = (now() - startedAt) / duration
        if (t >= 1 || canvasViewportSettled(current ?? from, to)) {
          arrive(to)
          return
        }
        const at = canvasViewportAt(from, to, t)
        current = at
        opts.setViewport(at)
        frame = schedule(step)
      }
      frame = schedule(step)
    })
  }

  function glideTo(to: CanvasViewport3, o: { durationMs?: number } = {}) {
    return run({ x: to.x, y: to.y, zoom: to.zoom }, o.durationMs)
  }

  /** reveal：以当前（补间中的话就是当前插值）为基准平移 dx/dy；目标仍按补间滑过去 */
  function panBy(dx: number, dy: number, o: { durationMs?: number } = {}) {
    const from = current ?? opts.viewport.value
    return run({ x: from.x + dx, y: from.y + dy, zoom: from.zoom }, o.durationMs)
  }

  onScopeDispose(cancel)

  return { glideTo, panBy, cancel, tweening }
}
