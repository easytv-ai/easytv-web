import { describe, expect, it } from 'vitest'
import { canvasLiveHudTransform, sameCanvasLiveViewport } from './canvas-live-viewport'

describe('canvasLiveHudTransform', () => {
  const origin = { left: 100, top: 50 }

  it('纯平移只跟视口位移', () => {
    expect(canvasLiveHudTransform(
      { x: 0, y: 0, zoom: 1 },
      { x: 24, y: -8, zoom: 1 },
      origin,
    )).toBe('translate(24px, -8px)')
  })

  it('缩放绕舞台原点，屏幕点仍对齐', () => {
    const start = { x: 10, y: 20, zoom: 1 }
    const next = { x: 10, y: 20, zoom: 2 }
    const transform = canvasLiveHudTransform(start, next, origin)
    expect(transform).toContain('scale(2)')
    // 画布点 (0,0) 旧屏幕 = origin+start；新屏幕 = origin+next
    // HUD: scale*(screen) + t = 新屏幕
    const screenX = origin.left + start.x
    const wantX = origin.left + next.x
    const tx = origin.left + next.x - 2 * (origin.left + start.x)
    expect(2 * screenX + tx).toBeCloseTo(wantX, 5)
  })

  it('没动就空字符串，避免多余合成', () => {
    expect(canvasLiveHudTransform(
      { x: 3, y: 4, zoom: 1 },
      { x: 3, y: 4, zoom: 1 },
      origin,
    )).toBe('')
  })

  it('视口相等比较', () => {
    expect(sameCanvasLiveViewport({ x: 1, y: 2, zoom: 1 }, { x: 1, y: 2, zoom: 1 })).toBe(true)
    expect(sameCanvasLiveViewport({ x: 1, y: 2, zoom: 1 }, { x: 1, y: 3, zoom: 1 })).toBe(false)
  })
})
