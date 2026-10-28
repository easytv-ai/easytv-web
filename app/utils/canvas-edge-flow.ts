/** 连线七等分，3 段波动各占 1 份，加起来正好 3/7；每段里 7 格无缝拼接 */

export const CANVAS_EDGE_FLOW_CELLS = 7
export const CANVAS_EDGE_FLOW_COUNT = 3
export const CANVAS_EDGE_FLOW_PARTS = 7
export const CANVAS_EDGE_CELL_GAP = 0
/** 底线约 1.25px，光斑粗细只大一圈 */
export const CANVAS_EDGE_THICKNESS = 3.6
/** 走完一整圈的秒数；像素速度随线长同比，短线不会飙太快 */
export const CANVAS_EDGE_FLOW_PERIOD = 5

export function canvasEdgeFlowSpeed(total: number) {
  if (!Number.isFinite(total) || total <= 0)
    return 0
  return total / CANVAS_EDGE_FLOW_PERIOD
}

export function canvasEdgeFlowLayout(total: number) {
  if (!Number.isFinite(total) || total <= 0) {
    return {
      count: 0,
      slugLen: 0,
      gap: 0,
      cell: 0,
      cellGap: CANVAS_EDGE_CELL_GAP,
      cells: CANVAS_EDGE_FLOW_CELLS,
      thickness: CANVAS_EDGE_THICKNESS,
    }
  }
  const count = CANVAS_EDGE_FLOW_COUNT
  const slugLen = total / CANVAS_EDGE_FLOW_PARTS
  const cell = slugLen / CANVAS_EDGE_FLOW_CELLS
  const gap = Math.max(0, total / count - slugLen)
  return {
    count,
    slugLen,
    gap,
    cell,
    cellGap: CANVAS_EDGE_CELL_GAP,
    cells: CANVAS_EDGE_FLOW_CELLS,
    thickness: CANVAS_EDGE_THICKNESS,
  }
}
