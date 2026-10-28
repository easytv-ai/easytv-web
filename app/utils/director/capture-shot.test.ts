import { describe, expect, it, vi } from 'vitest'
import { captureActiveCameraShot } from './capture-shot'

describe('captureActiveCameraShot', () => {
  it('把当前画面记到当前机位', () => {
    const addCaptures = vi.fn()
    const result = captureActiveCameraShot({
      canvas: { toDataURL: () => 'data:image/png;base64,abc' },
      cameraId: 'cam-1',
      addCaptures,
    })
    expect(result).toBe('ok')
    expect(addCaptures).toHaveBeenCalledWith('cam-1', ['data:image/png;base64,abc'])
  })

  it('视口或机位还没有时不拍', () => {
    const addCaptures = vi.fn()
    expect(captureActiveCameraShot({ canvas: null, cameraId: 'cam-1', addCaptures })).toBe('viewport-not-ready')
    expect(captureActiveCameraShot({
      canvas: { toDataURL: () => 'data:image/png;base64,abc' },
      cameraId: '',
      addCaptures,
    })).toBe('no-camera')
    expect(addCaptures).not.toHaveBeenCalled()
  })

  it('画布被跨域内容污染时返回失败，不抛出去', () => {
    const result = captureActiveCameraShot({
      canvas: {
        toDataURL: () => {
          throw new Error('tainted')
        },
      },
      cameraId: 'cam-1',
      addCaptures: vi.fn(),
    })
    expect(result).toBe('tainted')
  })

  it('只读画布拒绝写入时不当成已截到', () => {
    const result = captureActiveCameraShot({
      canvas: { toDataURL: () => 'data:image/png;base64,abc' },
      cameraId: 'cam-1',
      addCaptures: () => false,
    })
    expect(result).toBe('rejected')
  })
})
