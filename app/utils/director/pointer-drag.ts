/**
 * 指针拖动的公共收尾逻辑。
 *
 * 轴输入的把手、时间轴的播放头和节点、截图查看器的平移，四处是同一套：
 * 按下记起点 → 移动时算增量 → 抬起收尾。各写一遍的结果是有的地方忘了
 * 摘监听、有的忘了处理 pointercancel。
 *
 * setPointerCapture 要兜住异常。它只是让指针移出元素之后事件还回到这个
 * 元素上，不是拖动的前提；但它会在指针已经不存在时抛 NotFoundError，
 * 抛出来就把后面注册监听的代码一起带走了 —— 表现是拖动完全没反应。
 * 捕获不上就退回监听 window，效果一样。
 */

/** 只要求拖动过程中真正用到的那几个方法，方便单测传个假的进来 */
export interface PointerDragTarget {
  setPointerCapture?: (pointerId: number) => void
  releasePointerCapture?: (pointerId: number) => void
  addEventListener: (type: string, listener: (event: PointerEvent) => void) => void
  removeEventListener: (type: string, listener: (event: PointerEvent) => void) => void
}

export interface PointerDragHandlers {
  onMove: (event: PointerEvent) => void
  /** 抬起或取消时调一次，且只调一次 */
  onEnd?: () => void
}

export interface StartPointerDragOptions {
  target: PointerDragTarget
  pointerId: number
  /** 捕获失败时的退路，浏览器里传 window */
  fallback: PointerDragTarget
  handlers: PointerDragHandlers
}

export function startPointerDrag(options: StartPointerDragOptions): () => void {
  const { target, pointerId, fallback, handlers } = options

  let source = fallback
  try {
    target.setPointerCapture?.(pointerId)
    source = target
  }
  catch {
    // 捕获不上不算失败，照样能拖，只是指针移出元素时靠 window 收事件
    source = fallback
  }

  let finished = false

  function finish() {
    // pointerup 和 pointercancel 可能都来，onEnd 只该跑一次
    // （它常常是 endBatch，跑两次会把上一批也一起关掉）
    if (finished)
      return
    finished = true
    source.removeEventListener('pointermove', handlers.onMove)
    source.removeEventListener('pointerup', finish)
    source.removeEventListener('pointercancel', finish)
    handlers.onEnd?.()
  }

  source.addEventListener('pointermove', handlers.onMove)
  source.addEventListener('pointerup', finish)
  source.addEventListener('pointercancel', finish)

  // 返回一个提前收尾的口子，组件卸载时用得上
  return finish
}
