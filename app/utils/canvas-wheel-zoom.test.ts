import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_ZOOM,
  CANVAS_WHEEL_PAN_SPEED,
  canvasViewportAtFlowPoint,
  canvasWheelPanDelta,
  canvasWheelPanFollow,
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

describe('canvasWheelPanDelta', () => {
  it('触控板像素滚动：下滚画布上移，右滚画布左移', () => {
    expect(canvasWheelPanDelta({ deltaX: 40, deltaY: 80, deltaMode: 0, shiftKey: false })).toEqual({
      x: -40 * CANVAS_WHEEL_PAN_SPEED,
      y: -80 * CANVAS_WHEEL_PAN_SPEED,
    })
  })

  it('Shift+只有纵向时改成横移', () => {
    const pan = canvasWheelPanDelta({ deltaX: 0, deltaY: 100, deltaMode: 0, shiftKey: true })
    expect(pan.x).toBe(-100 * CANVAS_WHEEL_PAN_SPEED)
    expect(pan.y).toBe(0)
  })

  it('一帧跟手只走一部分，避免刻度滚轮跳视口', () => {
    const next = canvasWheelPanFollow(
      { x: 0, y: 0, zoom: 1 },
      { x: 100, y: 0, zoom: 1 },
      16,
    )
    expect(next.x).toBeGreaterThan(0)
    expect(next.x).toBeLessThan(100)
    expect(next.y).toBe(0)
  })
})

describe('Workspace 自己接管滚轮平移', () => {
  it('关掉 Vue Flow pan-on-scroll，捕获阶段自己平移并进入 live viewport', () => {
    const ws = readFileSync(new URL('../components/canvas/CanvasWorkspace.vue', import.meta.url), 'utf8')
    const body = ws.slice(ws.indexOf('function onWindowWheel'), ws.indexOf('function onWindowWheel') + 2200)
    expect(ws).toContain(':pan-on-scroll="false"')
    expect(ws).toContain('function pulseLiveViewport()')
    expect(body).toContain('pulseLiveViewport()')
    expect(body).toContain('canvasWheelPanTarget')
    expect(body).toContain('canvasWheelPanDelta')
    expect(body).toContain('requestAnimationFrame')
    expect(body).not.toContain('setViewport({ x: current.x + dx')
    expect(ws).toContain('applyCanvasPaneTransform')
    expect(ws).toContain('commitWheelPan()')
  })
})
