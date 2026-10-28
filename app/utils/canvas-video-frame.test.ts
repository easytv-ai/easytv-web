import { describe, expect, it } from 'vitest'
import { promptReverseFrameRanges, samplePromptReverseTimes } from './canvas-video-frame'

describe('samplePromptReverseTimes', () => {
  it('时长为 0 只取首帧', () => {
    expect(samplePromptReverseTimes(0)).toEqual([0])
  })

  it('短片至少两帧且落在片内', () => {
    const times = samplePromptReverseTimes(3)
    expect(times.length).toBeGreaterThanOrEqual(2)
    expect(times[0]).toBe(0)
    expect(times.at(-1)!).toBeLessThan(3)
  })

  it('长片按约 2 秒一帧、不超过上限', () => {
    const times = samplePromptReverseTimes(20, 8)
    expect(times.length).toBe(8)
    expect(times[0]).toBe(0)
  })
})

describe('promptReverseFrameRanges', () => {
  it('用相邻时刻中点切段并覆盖整段', () => {
    expect(promptReverseFrameRanges([0, 2, 4], 5)).toEqual([
      { index: 1, timeSec: 0, startSec: 0, endSec: 1 },
      { index: 2, timeSec: 2, startSec: 1, endSec: 3 },
      { index: 3, timeSec: 4, startSec: 3, endSec: 5 },
    ])
  })
})
