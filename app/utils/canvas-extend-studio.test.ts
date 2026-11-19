import { describe, expect, it } from 'vitest'
import { extendSourceWindow } from '~/utils/canvas-extend-studio'

describe('extendSourceWindow', () => {
  it('整段选区不裁，直接用已入库的源视频', () => {
    expect(extendSourceWindow({ start: 0, end: 1, duration: 8 })).toBeNull()
  })

  it('后半段不好时，裁到坏的那段之前', () => {
    expect(extendSourceWindow({ start: 0, end: 0.5, duration: 10 })).toEqual({ start: 0, end: 5 })
  })

  it('从中间某一刻接着写时，只留这一段', () => {
    expect(extendSourceWindow({ start: 0.2, end: 0.8, duration: 10 })).toEqual({ start: 2, end: 8 })
  })

  it('读不到时长时不裁', () => {
    expect(extendSourceWindow({ start: 0.2, end: 0.4, duration: 0 })).toBeNull()
  })
})
