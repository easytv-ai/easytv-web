import { describe, expect, it } from 'vitest'
import { prettyModelSlug, shortModelName } from './model-name'

describe('shortModelName', () => {
  it('短 label 原样用', () => {
    expect(shortModelName({ model: 'x', label: 'GPT Image 2.5' })).toBe('GPT Image 2.5')
  })

  it('英文介绍太长时改用模型 id', () => {
    expect(shortModelName({
      model: 'openai/gpt-image-2.5-sunburst',
      label: 'Flexible sizing and high-fidelity rendering for production stills',
    })).toBe('Gpt Image 2.5 Sunburst')
  })
})

describe('prettyModelSlug', () => {
  it('去掉 provider 前缀并把连字符收成词', () => {
    expect(prettyModelSlug('easyapi/seedance-1.5')).toBe('Seedance 1.5')
  })
})
