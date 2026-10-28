import { describe, expect, it } from 'vitest'
import {
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_ZOOM,
  canvasViewportAtFlowPoint,
  canvasWheelZoomDelta,
  clampCanvasZoom,
} from './canvas-wheel-zoom'

describe('canvasWheelZoomDelta', () => {
  it('像素滚轮：上滚放大、下滚缩小，和 Vue Flow 同一套系数', () => {
    expect(canvasWheelZoomDelta({ deltaY: -100, deltaMode: 0, ctrlKey: true })).toBeCloseTo(0.2)
    expect(canvasWheelZoomDelta({ deltaY: 100, deltaMode: 0, ctrlKey: true })).toBeCloseTo(-0.2)
  })

  it('Mac 捏合带 ctrlKey 时步长 ×10', () => {
    expect(canvasWheelZoomDelta({ deltaY: -100, deltaMode: 0, ctrlKey: true }, true)).toBeCloseTo(2)
  })
})

describe('canvasViewportAtFlowPoint', () => {
  it('缩放后指针下的画布点不变', () => {
    const viewport = { x: 40, y: 80, zoom: 1 }
    const flow = { x: 120, y: 60 }
    const next = canvasViewportAtFlowPoint(viewport, flow, 2)
    expect(next.x + flow.x * next.zoom).toBeCloseTo(viewport.x + flow.x * viewport.zoom)
    expect(next.y + flow.y * next.zoom).toBeCloseTo(viewport.y + flow.y * viewport.zoom)
    expect(next.zoom).toBe(2)
  })

  it('夹在画布允许的缩放范围内', () => {
    expect(clampCanvasZoom(0.01)).toBe(CANVAS_MIN_ZOOM)
    expect(clampCanvasZoom(99)).toBe(CANVAS_MAX_ZOOM)
    expect(clampCanvasZoom(1)).toBe(1)
  })
})
