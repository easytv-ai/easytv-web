import { describe, expect, it } from 'vitest'
import { nodeGeneratePatch, pickNodeParams } from './canvas-node-params'

describe('pickNodeParams', () => {
  it('只留 Inspector 会读的键，空值丢掉', () => {
    expect(pickNodeParams({ ratio: '9:16', clarity: '2K', count: 4, camera: 'push', seed: 1, resolution: '', duration: 5, lang: 'en', voice: 'nova', audioKind: 'bgm', mood: 'pulse' }))
      .toEqual({ ratio: '9:16', clarity: '2K', duration: 5, lang: 'en', voice: 'nova', audioKind: 'bgm', mood: 'pulse' })
  })

  it('没有可记的参数返回 undefined', () => {
    expect(pickNodeParams({ count: 2 })).toBeUndefined()
    expect(pickNodeParams(null)).toBeUndefined()
  })
})

describe('nodeGeneratePatch', () => {
  it('模型与参数都有就都记', () => {
    expect(nodeGeneratePatch('kling-v1', { mode: 'i2v', ratio: '16:9', count: 1 }))
      .toEqual({ model: 'kling-v1', params: { mode: 'i2v', ratio: '16:9' } })
  })

  it('没有参数时不覆盖节点上原有的 params', () => {
    expect(nodeGeneratePatch('gpt-image-1', { count: 3 })).toEqual({ model: 'gpt-image-1' })
    expect(nodeGeneratePatch('', null)).toEqual({})
  })
})
