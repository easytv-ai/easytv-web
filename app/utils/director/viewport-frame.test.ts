import { describe, expect, it } from 'vitest'
import { fitFrameWithinViewport, FRAME_PADDING, getViewportFrameRect } from './viewport-frame'

describe('fitFrameWithinViewport', () => {
  it('宽视口里放竖框：顶满高度，左右居中', () => {
    const rect = fitFrameWithinViewport(1000, 600, 9 / 16)
    const safeHeight = 600 - FRAME_PADDING * 2

    expect(rect.height).toBeCloseTo(safeHeight, 6)
    expect(rect.width).toBeCloseTo(safeHeight * (9 / 16), 6)
    expect(rect.left).toBeCloseTo(FRAME_PADDING + (1000 - FRAME_PADDING * 2 - rect.width) / 2, 6)
  })

  it('窄视口里放横框：顶满宽度，上下居中', () => {
    const rect = fitFrameWithinViewport(600, 1000, 16 / 9)
    const safeWidth = 600 - FRAME_PADDING * 2

    expect(rect.width).toBeCloseTo(safeWidth, 6)
    expect(rect.height).toBeCloseTo(safeWidth / (16 / 9), 6)
  })

  it('框的比例始终等于要求的比例', () => {
    for (const ratio of [1, 4 / 3, 16 / 9, 21 / 9, 9 / 16]) {
      const rect = fitFrameWithinViewport(1280, 720, ratio)
      expect(rect.width / rect.height).toBeCloseTo(ratio, 6)
    }
  })

  it('底部留白更大时框整体往上挪', () => {
    const normal = fitFrameWithinViewport(1000, 600, 1)
    const withBar = fitFrameWithinViewport(1000, 600, 1, 160)

    expect(withBar.height).toBeLessThan(normal.height)
    expect(withBar.top).toBeLessThanOrEqual(normal.top + normal.height / 2)
  })

  it('视口小到留白都放不下时给零尺寸，不产生 NaN', () => {
    const rect = fitFrameWithinViewport(40, 40, 1)
    expect(rect.width).toBe(0)
    expect(rect.height).toBe(0)
    expect(Number.isFinite(rect.left)).toBe(true)
  })

  it('比例非法时同样不产生 NaN', () => {
    const rect = fitFrameWithinViewport(1000, 600, 0)
    expect(rect.width).toBe(0)
    expect(Number.isFinite(rect.top)).toBe(true)
  })

  it('框永远落在留白之内', () => {
    const rect = fitFrameWithinViewport(1000, 600, 21 / 9)
    expect(rect.left).toBeGreaterThanOrEqual(FRAME_PADDING - 1e-9)
    expect(rect.top).toBeGreaterThanOrEqual(FRAME_PADDING - 1e-9)
    expect(rect.left + rect.width).toBeLessThanOrEqual(1000 - FRAME_PADDING + 1e-9)
  })
})

describe('getViewportFrameRect', () => {
  it('auto 不画框', () => {
    expect(getViewportFrameRect('auto', 1000, 600)).toBeNull()
  })

  it('具体比例给出框', () => {
    const rect = getViewportFrameRect('16:9', 1000, 600)
    expect(rect).not.toBeNull()
    expect(rect!.width / rect!.height).toBeCloseTo(16 / 9, 6)
  })
})
