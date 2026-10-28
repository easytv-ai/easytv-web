import { describe, expect, it } from 'vitest'
import { getLobeIconSlugCandidates } from './lobe-icon'

describe('getLobeIconSlugCandidates', () => {
  it('ByteDance.Color 解析成彩色图标再回退单色', () => {
    expect(getLobeIconSlugCandidates('ByteDance.Color')).toEqual(['bytedance-color', 'bytedance'])
  })

  it('没有彩色文件的厂商不请求 -color', () => {
    expect(getLobeIconSlugCandidates('OpenAI.Color')).toEqual(['openai'])
  })

  it('完整图片地址不走图标名', () => {
    expect(getLobeIconSlugCandidates('https://cdn.example.com/i.png')).toEqual([])
  })
})
