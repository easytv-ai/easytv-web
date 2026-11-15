import { describe, expect, it } from 'vitest'
import { applyVisualViewportFit, VISUAL_VIEWPORT_NARROW_PX } from './useVisualViewportFit'

function box() {
  return { style: {} as Record<string, string> }
}

describe('applyVisualViewportFit', () => {
  it('宽屏不改定位，小屏贴 visualViewport 并建立 fixed 包含块', () => {
    const el = box()
    applyVisualViewportFit(el as unknown as HTMLElement, {
      innerWidth: VISUAL_VIEWPORT_NARROW_PX + 1,
      visualViewport: { offsetTop: 40, offsetLeft: 0, width: 390, height: 400 },
    })
    expect(el.style.position).toBe('')
    expect(el.style.transform).toBe('')

    applyVisualViewportFit(el as unknown as HTMLElement, {
      innerWidth: 390,
      visualViewport: { offsetTop: 40, offsetLeft: 8, width: 390, height: 420 },
    })
    expect(el.style.position).toBe('fixed')
    expect(el.style.top).toBe('40px')
    expect(el.style.left).toBe('8px')
    expect(el.style.width).toBe('390px')
    expect(el.style.height).toBe('420px')
    expect(el.style.transform).toBe('translateZ(0)')
  })

  it('没有 visualViewport 或回到宽屏时清掉贴合样式', () => {
    const el = box()
    applyVisualViewportFit(el as unknown as HTMLElement, {
      innerWidth: 390,
      visualViewport: { offsetTop: 0, offsetLeft: 0, width: 390, height: 420 },
    })
    applyVisualViewportFit(el as unknown as HTMLElement, { innerWidth: 390, visualViewport: null })
    expect(el.style.position).toBe('')
    expect(el.style.height).toBe('')
    expect(el.style.transform).toBe('')
  })
})
