import { describe, expect, it } from 'vitest'
import { directorCardPreviewSize } from './card-preview'

describe('directorCardPreviewSize', () => {
  it('比上限窄的画布保持原尺寸', () => {
    expect(directorCardPreviewSize(320, 220)).toEqual({ width: 320, height: 220 })
  })

  it('比上限宽的画布按比例缩小', () => {
    expect(directorCardPreviewSize(1280, 720)).toEqual({ width: 640, height: 360 })
  })

  it('空画布不算尺寸', () => {
    expect(directorCardPreviewSize(0, 100)).toEqual({ width: 0, height: 0 })
    expect(directorCardPreviewSize(100, 0)).toEqual({ width: 0, height: 0 })
  })
})
