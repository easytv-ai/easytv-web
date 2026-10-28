export type CanvasViewportLike = { x: number, y: number, zoom: number }

export type CanvasPaneRect = { left: number, top: number, width?: number, height?: number }

export type CanvasNodeBox = { x: number, y: number, w: number, h: number }

/** 画布舞台在页面上的矩形；SSR / 还没挂载时给一个够用的兜底 */
export function canvasFlowPaneRect(): CanvasPaneRect {
  if (typeof document === 'undefined')
    return { left: 0, top: 0, width: 1200, height: 800 }
  const el = document.querySelector('.canvas-flow') as HTMLElement | null
  const rect = el?.getBoundingClientRect()
  return {
    left: rect?.left ?? 0,
    top: rect?.top ?? 0,
    width: rect?.width ?? 1200,
    height: rect?.height ?? 800,
  }
}

/** 画布坐标 → 视口客户端坐标 */
export function canvasFlowToClient(
  viewport: CanvasViewportLike,
  x: number,
  y: number,
  pane: CanvasPaneRect = canvasFlowPaneRect(),
) {
  const z = viewport.zoom || 1
  return {
    x: pane.left + viewport.x + x * z,
    y: pane.top + viewport.y + y * z,
  }
}

/**
 * 浮动面板贴在节点下缘居中。
 * 完全跟随节点：节点滚出屏幕时面板也跟着出屏（position: fixed 超出视口不可见）。
 */
export function canvasPanelBelowNode(
  box: CanvasNodeBox | null | undefined,
  viewport: CanvasViewportLike,
  opts: {
    paneRect?: CanvasPaneRect
    panelW?: number
    gap?: number
    windowWidth?: number
  } = {},
): { left: string, top: string, width?: string } | null {
  if (!box)
    return null
  const z = viewport.zoom || 1
  const origin = canvasFlowToClient(viewport, box.x, box.y, opts.paneRect ?? canvasFlowPaneRect())
  const gap = opts.gap ?? 16
  const left = origin.x + (box.w * z) / 2
  // 完全跟随节点：上下左右都不夹界，节点滚出屏幕时面板也跟着出屏，
  // position: fixed 的元素超出视口自然不可见，滚回来就重新出现
  const top = origin.y + box.h * z + gap
  const panelW = opts.panelW
  if (!panelW) {
    return {
      left: `${left}px`,
      top: `${top}px`,
    }
  }
  return {
    left: `${left}px`,
    top: `${top}px`,
    width: `${panelW}px`,
  }
}
