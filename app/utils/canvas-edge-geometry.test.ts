import { getBezierPath, Position } from '@vue-flow/core'
import { describe, expect, it } from 'vitest'
import {
  buildCanvasEdgeGeoms,
  canvasEdgeClosestPoint,
  canvasEdgeCubic,
  canvasEdgeCubicPoint,
  canvasEdgeInView,
  canvasEdgeScreenWidth,
  pickCanvasEdge,
} from './canvas-edge-geometry'

describe('canvasEdgeCubic', () => {
  it('控制点和 vue-flow 的贝塞尔一致', () => {
    const cubic = canvasEdgeCubic(10, 20, 180, 90, 'right', 'left')
    const [d] = getBezierPath({
      sourceX: 10,
      sourceY: 20,
      targetX: 180,
      targetY: 90,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      curvature: 0.4,
    })
    expect(d).toBe(`M${cubic.x0},${cubic.y0} C${cubic.c1x},${cubic.c1y} ${cubic.c2x},${cubic.c2y} ${cubic.x1},${cubic.y1}`)
  })

  it('反向拉线时控制点仍和 vue-flow 一致', () => {
    const cubic = canvasEdgeCubic(400, 40, 80, 220, 'right', 'left')
    const [d] = getBezierPath({
      sourceX: 400,
      sourceY: 40,
      targetX: 80,
      targetY: 220,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      curvature: 0.4,
    })
    expect(d).toBe(`M${cubic.x0},${cubic.y0} C${cubic.c1x},${cubic.c1y} ${cubic.c2x},${cubic.c2y} ${cubic.x1},${cubic.y1}`)
  })
})

describe('canvasEdgeScreenWidth', () => {
  it('放大时按 1.25 个画布像素变粗，缩小时屏幕上至少 1px', () => {
    expect(canvasEdgeScreenWidth(1)).toBe(1.25)
    expect(canvasEdgeScreenWidth(2)).toBe(1.25)
    expect(canvasEdgeScreenWidth(0.2)).toBeCloseTo(5)
  })
})

describe('canvasEdgeInView', () => {
  it('穿出视口的线留着，完全在外面的丢掉', () => {
    const cross = canvasEdgeCubic(0, 0, 400, 0, 'right', 'left')
    const away = canvasEdgeCubic(0, 800, 400, 900, 'right', 'left')
    const view = { left: 100, top: -20, right: 300, bottom: 40 }
    expect(canvasEdgeInView(cross, view)).toBe(true)
    expect(canvasEdgeInView(away, view)).toBe(false)
  })
})

describe('pickCanvasEdge', () => {
  it('点在曲线附近命中，离远了不命中', () => {
    const { geoms } = buildCanvasEdgeGeoms(
      [
        { id: 'a', x: 0, y: 0, w: 40, h: 40 },
        { id: 'b', x: 240, y: 0, w: 40, h: 40 },
      ],
      [{ id: 'e1', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in' }],
    )
    const mid = canvasEdgeCubicPoint(geoms[0]!, 0.5)
    const near = canvasEdgeClosestPoint(geoms[0]!, mid.x, mid.y + 2)
    expect(near.dist2).toBeLessThan(25)
    const hit = pickCanvasEdge(geoms, mid.x, mid.y + 2, 8)
    expect(hit?.geom.id).toBe('e1')
    expect(pickCanvasEdge(geoms, mid.x, mid.y + 80, 8)).toBeNull()
  })

  it('藏起来的卡片不参与连线，少选才标流动', () => {
    const nodes = [
      { id: 'a', x: 0, y: 0, w: 10, h: 10, selected: true },
      { id: 'b', x: 80, y: 0, w: 10, h: 10 },
      { id: 'c', x: 0, y: 40, w: 10, h: 10, hidden: true },
    ]
    const { geoms } = buildCanvasEdgeGeoms(nodes, [
      { id: 'show', source: 'a', target: 'b' },
      { id: 'hide', source: 'a', target: 'c' },
    ])
    expect(geoms.map(item => item.id)).toEqual(['show'])
    expect(geoms[0]?.live).toBe(true)
    expect(geoms[0]?.flow).toBe(true)
    expect(geoms[0]?.length).toBeGreaterThan(0)
  })
})
