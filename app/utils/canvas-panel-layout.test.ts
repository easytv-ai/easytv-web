import { describe, expect, it } from 'vitest'
import { canvasFlowToClient, canvasPanelBelowNode } from './canvas-panel-layout'

const viewport = { x: 10, y: 20, zoom: 1 }
const pane = { left: 100, top: 50, width: 800, height: 600 }
const box = { x: 40, y: 30, w: 100, h: 80 }

describe('canvasFlowToClient', () => {
  it('画布点加上视口偏移和舞台位置', () => {
    expect(canvasFlowToClient(viewport, 40, 30, pane)).toEqual({ x: 150, y: 100 })
  })

  it('zoom=2 时画布坐标按缩放放大', () => {
    expect(canvasFlowToClient({ x: 0, y: 0, zoom: 2 }, 10, 20, { left: 0, top: 0 })).toEqual({ x: 20, y: 40 })
  })
})

describe('canvasPanelBelowNode', () => {
  it('没有节点包围盒时不定位', () => {
    expect(canvasPanelBelowNode(null, viewport)).toBeNull()
  })

  it('窄条：贴节点下缘居中，不写宽度', () => {
    const style = canvasPanelBelowNode(box, viewport, { paneRect: pane, gap: 16 })
    expect(style).toEqual({ left: '200px', top: '196px' })
  })

  it('宽面板：写宽度，左右不夹界（完全跟随节点）', () => {
    const style = canvasPanelBelowNode(box, viewport, {
      paneRect: pane,
      panelW: 360,
      windowWidth: 400,
    })
    expect(style?.width).toBe('360px')
    expect(style?.left).toBe('200px')
  })
})
