import { describe, expect, it } from 'vitest'
import { estimateTaskPoints, estimateUpscalePoints } from './model-price'

describe('estimateUpscalePoints', () => {
  it('按原图像素和倍数计价，和 billing.go 同一组数', () => {
    expect(estimateUpscalePoints(8, 1024, 1024, 2)).toBe(9)
    expect(estimateUpscalePoints(8, 1024, 1024, 4)).toBe(34)
    expect(estimateUpscalePoints(8, 1024, 1024, 6)).toBe(76)
    expect(estimateUpscalePoints(8, 2048, 2048, 2)).toBe(34)
    expect(estimateUpscalePoints(6, 1024, 1024, 2)).toBe(7)
  })

  it('没有原图尺寸时按倍数面积比，2、4、6 各不相同', () => {
    expect(estimateUpscalePoints(8, 0, 0, 2)).toBe(8)
    expect(estimateUpscalePoints(8, 0, 0, 4)).toBe(32)
    expect(estimateUpscalePoints(8, 0, 0, 6)).toBe(72)
  })

  it('原图小于基准时不低于模型单价乘倍数面积比', () => {
    expect(estimateUpscalePoints(5, 100, 100, 2)).toBe(5)
    expect(estimateUpscalePoints(5, 100, 100, 4)).toBe(20)
    expect(estimateUpscalePoints(5, 100, 100, 6)).toBe(45)
  })

  it('非法倍数按 2 倍，普通生图不走这条', () => {
    expect(estimateUpscalePoints(8, 1024, 1024, 3)).toBe(9)
    expect(estimateUpscalePoints(0, 1024, 1024, 4)).toBe(0)
    expect(estimateTaskPoints(8, 'image', 1)).toBe(8)
  })
})
