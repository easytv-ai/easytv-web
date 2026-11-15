import { describe, expect, it } from 'vitest'
import { pickKnownDuration, planStripFrameTimes } from './canvas-video-frame'

describe('pickKnownDuration', () => {
  it('探测失败（0 / NaN / Infinity）时落到资产库记的时长', () => {
    expect(pickKnownDuration(0, 12.5)).toBe(12.5)
    expect(pickKnownDuration(Number.NaN, undefined, '8')).toBe(8)
    expect(pickKnownDuration(Number.POSITIVE_INFINITY, 6)).toBe(6)
    expect(pickKnownDuration(4, 12.5)).toBe(4)
  })

  it('所有来源都没有时长时返回 0', () => {
    expect(pickKnownDuration(0, null, undefined, -3)).toBe(0)
  })
})

describe('planStripFrameTimes', () => {
  it('拿不到时长又要多帧时不给时刻表，不去抽 N 张相同的首帧', () => {
    expect(planStripFrameTimes(0, 6)).toBeNull()
    expect(planStripFrameTimes(Number.NaN, 2)).toBeNull()
  })

  it('拿不到时长但只要 1 帧时给首帧', () => {
    expect(planStripFrameTimes(0, 1)).toEqual([0])
  })

  it('有时长时各帧时刻互不相同且落在片长之内', () => {
    const times = planStripFrameTimes(10, 6)!
    expect(times).toHaveLength(6)
    expect(new Set(times).size).toBe(6)
    expect(times[0]).toBe(0)
    expect(Math.max(...times)).toBeLessThan(10)
  })
})
