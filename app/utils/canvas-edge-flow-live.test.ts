import { describe, expect, it } from 'vitest'
import { canvasEdgeFlowLivePaths, setCanvasEdgeFlowLive } from './canvas-edge-flow-live'

function settle() {
  return new Promise((resolve) => queueMicrotask(() => resolve(null)))
}

describe('setCanvasEdgeFlowLive', () => {
  it('亚像素回写不换路径，真正移动才提交一次', async () => {
    const id = 'live-edge-test'
    setCanvasEdgeFlowLive(id, 'M10.2,20.4 C30.1,20.4 30.1,80.2 60.6,80.2')
    await settle()
    const first = canvasEdgeFlowLivePaths().value.find(item => item.id === id)
    expect(first?.d).toContain('M10.2,20.4')

    setCanvasEdgeFlowLive(id, 'M10.4,20.2 C30.3,20.6 30.0,80.4 60.4,80.1')
    await settle()
    expect(canvasEdgeFlowLivePaths().value.find(item => item.id === id)).toBe(first)

    setCanvasEdgeFlowLive(id, 'M40,20.4 C60,20.4 60,80.2 90,80.2')
    await settle()
    expect(canvasEdgeFlowLivePaths().value.find(item => item.id === id)?.d).toContain('M40,20.4')

    setCanvasEdgeFlowLive(id, null)
    await settle()
    expect(canvasEdgeFlowLivePaths().value.some(item => item.id === id)).toBe(false)
  })
})
