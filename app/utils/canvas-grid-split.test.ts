import { describe, expect, it } from 'vitest'
import {
  cellNodeLayout,
  cellPixelBox,
  cellPixelSize,
  evenLines,
  fitCellBox,
  GRID_MIN_CELL,
  GRID_SPLIT_MAX,
  gridCellCount,
  gridCells,
  gridSize,
  gridSplitTooMany,
  makeGridLines,
  moveGridLine,
} from './canvas-grid-split'

describe('evenLines / makeGridLines', () => {
  it('n 格给 n-1 条等分线', () => {
    expect(evenLines(1)).toEqual([])
    expect(evenLines(2)).toEqual([0.5])
    expect(evenLines(4)).toEqual([0.25, 0.5, 0.75])
  })

  it('非法格数按 1 格算', () => {
    expect(evenLines(0)).toEqual([])
    expect(evenLines(-3)).toEqual([])
  })

  it('九宫格是两横两竖九格', () => {
    const lines = makeGridLines(3, 3)
    expect(lines.cols).toHaveLength(2)
    expect(lines.rows).toHaveLength(2)
    expect(gridSize(lines)).toEqual({ cols: 3, rows: 3 })
    expect(gridCellCount(lines)).toBe(9)
  })
})

describe('gridCells', () => {
  it('行优先编号，四格的坐标与宽高都对', () => {
    expect(gridCells(makeGridLines(2, 2))).toEqual([
      { index: 1, row: 1, col: 1, x: 0, y: 0, w: 0.5, h: 0.5 },
      { index: 2, row: 1, col: 2, x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { index: 3, row: 2, col: 1, x: 0, y: 0.5, w: 0.5, h: 0.5 },
      { index: 4, row: 2, col: 2, x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ])
  })

  it('不等分的线也能算出对的格子', () => {
    const cells = gridCells({ cols: [0.3], rows: [] })
    expect(cells.map(cell => [cell.x, cell.w])).toEqual([[0, 0.3], [0.3, 0.7]])
    expect(cells.every(cell => cell.h === 1)).toBe(true)
  })

  it('没有分割线就是整张图一格', () => {
    expect(gridCells({ cols: [], rows: [] })).toEqual([
      { index: 1, row: 1, col: 1, x: 0, y: 0, w: 1, h: 1 },
    ])
  })

  it('每一行的宽度加起来正好是 1', () => {
    const lines = { cols: [0.2, 0.55], rows: [0.4] }
    const firstRow = gridCells(lines).filter(cell => cell.row === 1)
    expect(firstRow.reduce((sum, cell) => sum + cell.w, 0)).toBeCloseTo(1)
  })
})

describe('moveGridLine', () => {
  const lines = [0.25, 0.5, 0.75]

  it('正常拖动就落在目标位置', () => {
    expect(moveGridLine(lines, 1, 0.6)).toEqual([0.25, 0.6, 0.75])
  })

  it('拖过左邻居时被挡在最小格宽外', () => {
    expect(moveGridLine(lines, 1, 0.1)).toEqual([0.25, 0.25 + GRID_MIN_CELL, 0.75])
  })

  it('拖过右邻居时同样被挡住', () => {
    expect(moveGridLine(lines, 1, 0.99)).toEqual([0.25, 0.75 - GRID_MIN_CELL, 0.75])
  })

  it('第一条线以图的左边界为界，最后一条以右边界为界', () => {
    expect(moveGridLine([0.5], 0, -1)).toEqual([GRID_MIN_CELL])
    expect(moveGridLine([0.5], 0, 2)).toEqual([1 - GRID_MIN_CELL])
  })

  it('下标越界时原样返回', () => {
    expect(moveGridLine(lines, 9, 0.5)).toBe(lines)
    expect(moveGridLine(lines, -1, 0.5)).toBe(lines)
  })
})

describe('尺寸与落点', () => {
  const cell = gridCells(makeGridLines(2, 2))[3]!

  it('切片像素尺寸按源图算，最小 1px', () => {
    expect(cellPixelSize(cell, 1024, 1024)).toEqual({ w: 512, h: 512 })
    expect(cellPixelSize(cell, 0, 0)).toEqual({ w: 1, h: 1 })
  })

  it('像素框的左上角与宽高都按源图算', () => {
    expect(cellPixelBox(cell, 1024, 768)).toEqual({ x: 512, y: 384, w: 512, h: 384 })
  })

  it('落点在源节点右侧，并按原行列摆成同样的网格', () => {
    const source = { x: 100, y: 200, w: 320, h: 320 }
    const first = cellNodeLayout(gridCells(makeGridLines(2, 2))[0]!, source)
    const last = cellNodeLayout(cell, source)
    expect(first).toEqual({ w: 160, h: 160, x: 500, y: 200 })
    expect(last.x).toBeGreaterThan(first.x)
    expect(last.y).toBeGreaterThan(first.y)
  })
})

describe('fitCellBox', () => {
  it('真实比例等比套进格子，不拉伸', () => {
    expect(fitCellBox({ w: 1024, h: 512 }, { w: 160, h: 160 })).toEqual({ w: 160, h: 80 })
    expect(fitCellBox({ w: 300, h: 600 }, { w: 160, h: 120 })).toEqual({ w: 60, h: 120 })
  })

  it('没有真实尺寸就原样用格子', () => {
    expect(fitCellBox({}, { w: 160, h: 120 })).toEqual({ w: 160, h: 120 })
    expect(fitCellBox({ w: 0, h: 10 }, { w: 160, h: 120 })).toEqual({ w: 160, h: 120 })
  })
})

describe('gridSplitTooMany', () => {
  it('25 宫格刚好到顶，再多就拦下', () => {
    expect(GRID_SPLIT_MAX).toBe(25)
    expect(gridSplitTooMany(makeGridLines(5, 5))).toBe(false)
    expect(gridSplitTooMany(makeGridLines(6, 5))).toBe(true)
  })
})
