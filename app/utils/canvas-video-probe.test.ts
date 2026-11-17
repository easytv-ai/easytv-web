import { describe, expect, it } from 'vitest'
import { enqueueVideoProbe } from './canvas-video-probe'

describe('enqueueVideoProbe', () => {
  it('同时只跑两个，完成一个再放行下一个', () => {
    const started: number[] = []
    const done: Array<() => void> = []
    const cancel = [0, 1, 2].map(index => enqueueVideoProbe((finish) => {
      started.push(index)
      done.push(finish)
    }))
    expect(started).toEqual([0, 1])
    done[0]?.()
    expect(started).toEqual([0, 1, 2])
    cancel.forEach(stop => stop())
    done.slice(1).forEach(finish => finish())
  })
})
