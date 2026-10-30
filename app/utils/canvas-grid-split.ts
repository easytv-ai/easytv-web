/**
 * 宫格切分（L4）：把一张宫格图按可拖的分割线拆成切片。
 * 纯几何，不碰 vue-flow——每个切片就是一个归一化 rect，提交时按 media 动作 crop 走本地 ffmpeg，免费。
 *
 * 分割线只存「内部的那几条」：3 列就是 2 条线，0 和 1 是图的边界，不在列表里。
 */

export type GridLines = {
  /** 竖线位置（0~1，升序），把图从左到右分成 cols.length + 1 列 */
  cols: number[]
  /** 横线位置（0~1，升序），把图从上到下分成 rows.length + 1 行 */
  rows: number[]
}

export type GridCell = {
  index: number
  row: number
  col: number
  x: number
  y: number
  w: number
  h: number
}

/** 一次最多切这么多片，再多画布上也摆不下 */
export const GRID_SPLIT_MAX = 25
/** 每格最小边长（占全图比例），拖分割线时不许压过这个值 */
export const GRID_MIN_CELL = 0.04

export const GRID_SPLIT_PRESETS = [
  { id: '2x2', label: '四宫格', cols: 2, rows: 2 },
  { id: '3x3', label: '九宫格', cols: 3, rows: 3 },
  { id: '2x3', label: '两行三列', cols: 3, rows: 2 },
  { id: '3x2', label: '三行两列', cols: 2, rows: 3 },
  { id: '4x4', label: '十六宫格', cols: 4, rows: 4 },
  { id: '5x5', label: '25 宫格', cols: 5, rows: 5 },
] as const

/** n 格的等分线：3 格 → [1/3, 2/3] */
export function evenLines(n: number): number[] {
  const count = Math.max(1, Math.floor(n))
  const out: number[] = []
  for (let i = 1; i < count; i++)
    out.push(i / count)
  return out
}

export function makeGridLines(cols: number, rows: number): GridLines {
  return { cols: evenLines(cols), rows: evenLines(rows) }
}

export function gridSize(lines: GridLines) {
  return { cols: lines.cols.length + 1, rows: lines.rows.length + 1 }
}

export function gridCellCount(lines: GridLines) {
  const size = gridSize(lines)
  return size.cols * size.rows
}

/** 分割线 → 切片矩形，行优先编号（左到右、上到下），与人读宫格的顺序一致 */
export function gridCells(lines: GridLines): GridCell[] {
  const xs = [0, ...lines.cols, 1]
  const ys = [0, ...lines.rows, 1]
  const out: GridCell[] = []
  for (let r = 0; r < ys.length - 1; r++) {
    for (let c = 0; c < xs.length - 1; c++) {
      out.push({
        index: out.length + 1,
        row: r + 1,
        col: c + 1,
        x: xs[c]!,
        y: ys[r]!,
        w: xs[c + 1]! - xs[c]!,
        h: ys[r + 1]! - ys[r]!,
      })
    }
  }
  return out
}

/**
 * 拖动第 i 条分割线：夹在相邻两条线之间，两边各留 GRID_MIN_CELL，
 * 所以永远不会拖出零宽的格子，也不会把线拖过头越过邻居。
 */
export function moveGridLine(lines: number[], index: number, to: number, min = GRID_MIN_CELL): number[] {
  if (index < 0 || index >= lines.length)
    return lines
  const low = (index === 0 ? 0 : lines[index - 1]!) + min
  const high = (index === lines.length - 1 ? 1 : lines[index + 1]!) - min
  if (low > high)
    return lines
  const next = [...lines]
  next[index] = Math.min(high, Math.max(low, to))
  return next
}

/** 切片在源图里的像素框，直接喂给 cropImage（它按像素裁） */
export function cellPixelBox(cell: GridCell, width: number, height: number) {
  const size = cellPixelSize(cell, width, height)
  return {
    x: Math.round(cell.x * (width || 0)),
    y: Math.round(cell.y * (height || 0)),
    w: size.w,
    h: size.h,
  }
}

/** 切片在源图里的像素尺寸，用来给落到画布上的节点定宽高 */
export function cellPixelSize(cell: GridCell, width: number, height: number) {
  return {
    w: Math.max(1, Math.round(cell.w * (width || 0))),
    h: Math.max(1, Math.round(cell.h * (height || 0))),
  }
}

/**
 * 切片节点在画布上的落点：贴着源节点右侧，按原来的行列摆成同样的网格。
 * 每格宽高按源节点尺寸等比缩小，行列之间留 16px。
 */
export function cellNodeLayout(
  cell: GridCell,
  source: { x: number, y: number, w: number, h: number },
  gap = 16,
  offset = 80,
) {
  const w = Math.max(80, Math.round(source.w * cell.w))
  const h = Math.max(60, Math.round(source.h * cell.h))
  return {
    w,
    h,
    x: Math.round(source.x + source.w + offset + cell.x * (source.w + gap * (cell.col - 1))),
    y: Math.round(source.y + cell.y * (source.h + gap * (cell.row - 1))),
  }
}

/**
 * 切片真实像素比例套进布局格子：等比缩到格子内，不放大、不拉伸。
 * 产物回来前只知道格子的分数尺寸，源图若不是标准比例，切片会被压成格子的形状；有了后端下发的宽高就按真实比例收一下。
 */
export function fitCellBox(real: { w?: number, h?: number }, box: { w: number, h: number }) {
  const rw = Number(real.w) || 0
  const rh = Number(real.h) || 0
  if (!(rw > 0 && rh > 0) || !(box.w > 0 && box.h > 0))
    return { w: box.w, h: box.h }
  const scale = Math.min(box.w / rw, box.h / rh)
  return {
    w: Math.max(1, Math.round(rw * scale)),
    h: Math.max(1, Math.round(rh * scale)),
  }
}

/** 超过上限时不让提交：25 片已经是画布上能看清的极限 */
export function gridSplitTooMany(lines: GridLines) {
  return gridCellCount(lines) > GRID_SPLIT_MAX
}
