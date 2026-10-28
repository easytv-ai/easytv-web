import { describe, expect, it } from 'vitest'
import { CANVAS_EDGE_FLOW_CELLS, CANVAS_EDGE_THICKNESS, canvasEdgeFlowLayout, canvasEdgeFlowSpeed } from './canvas-edge-flow'

describe('canvasEdgeFlowLayout', () => {
  it('空线没有光斑', () => {
    expect(canvasEdgeFlowLayout(0).count).toBe(0)
    expect(canvasEdgeFlowLayout(0).cell).toBe(0)
  })

  it('整条线七等分，3 段波动加起来占 3 份', () => {
    const long = canvasEdgeFlowLayout(700)
    expect(long.count).toBe(3)
    expect(long.cells).toBe(CANVAS_EDGE_FLOW_CELLS)
    expect(long.cellGap).toBe(0)
    expect(long.thickness).toBe(CANVAS_EDGE_THICKNESS)
    expect(long.slugLen).toBeCloseTo(100, 5)
    expect(long.count * long.slugLen).toBeCloseTo(300, 5)
    expect(long.slugLen).toBeCloseTo(long.cells * long.cell, 5)
  })

  it('短线时 3 段一起变短，仍是 7 格拼在一起', () => {
    const short = canvasEdgeFlowLayout(70)
    const long = canvasEdgeFlowLayout(700)
    expect(short.count).toBe(3)
    expect(short.slugLen).toBeCloseTo(10, 5)
    expect(short.slugLen).toBeLessThan(long.slugLen)
    expect(short.slugLen).toBeCloseTo(short.cells * short.cell, 5)
  })

  it('流速随线长同比，走完一圈时间一样', () => {
    expect(canvasEdgeFlowSpeed(0)).toBe(0)
    expect(canvasEdgeFlowSpeed(480)).toBeCloseTo(canvasEdgeFlowSpeed(240) * 2, 5)
    expect(canvasEdgeFlowSpeed(240) * 5).toBeCloseTo(240, 5)
  })
})
