import { describe, expect, it } from 'vitest'
import { estimateSecondDuration } from '~/utils/model-price'

describe('视频高清面板', () => {
  it('按秒计价与服务端同一口径：不足 1 秒按 5 秒', () => {
    expect(estimateSecondDuration(12.9)).toBe(12)
    expect(estimateSecondDuration(1)).toBe(1)
    expect(estimateSecondDuration(0)).toBe(5)
    expect(estimateSecondDuration(0.4)).toBe(5)
  })
})
