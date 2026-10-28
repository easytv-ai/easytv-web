import { describe, expect, it } from 'vitest'
import { defaultStoryboardShots, storyboardExpandPlan, storyboardShotsOf } from './canvas-storyboard'

describe('分镜节点', () => {
  it('没写过分镜时给出两条空白', () => {
    expect(storyboardShotsOf(null)).toEqual(defaultStoryboardShots())
  })

  it('只把写了提示词的镜头排到节点右侧', () => {
    const plan = storyboardExpandPlan([
      { id: 'a', prompt: '  儿子低头看手机  ', seconds: 4 },
      { id: 'b', prompt: '   ', seconds: 5 },
      { id: 'c', prompt: '妈妈放下手机', seconds: 99 },
    ], { x: 10, y: 20, w: 280, h: 220 })
    expect(plan).toEqual([
      { prompt: '儿子低头看手机', seconds: 4, x: 370, y: 20, label: '镜头 1' },
      { prompt: '妈妈放下手机', seconds: 15, x: 370, y: 268, label: '镜头 2' },
    ])
  })
})
