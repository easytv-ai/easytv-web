import { describe, expect, it } from 'vitest'
import { canvasCachedEdgePath } from './canvas-edge-path'

const ends = {
  sourceX: 10,
  sourceY: 20,
  targetX: 180,
  targetY: 90,
  sourcePosition: 'right',
  targetPosition: 'left',
}

describe('canvasCachedEdgePath', () => {
  it('同一条线再问一次，直接交回上次的路径', () => {
    const first = canvasCachedEdgePath(ends)
    const again = canvasCachedEdgePath(ends)
    expect(again).toBe(first)
    expect(first.d.startsWith('M')).toBe(true)
  })

  it('不到 1px 的抖动不重算', () => {
    const first = canvasCachedEdgePath(ends)
    const jitter = canvasCachedEdgePath({
      ...ends,
      sourceX: 10.2,
      sourceY: 19.6,
      targetX: 180.4,
      targetY: 90.2,
    })
    expect(jitter).toBe(first)
  })

  it('端点真的挪了才换一条路径', () => {
    const first = canvasCachedEdgePath(ends)
    const moved = canvasCachedEdgePath({ ...ends, targetX: 320 })
    expect(moved).not.toBe(first)
    expect(moved.d).not.toBe(first.d)
  })
})
