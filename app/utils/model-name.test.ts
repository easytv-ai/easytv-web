import { readFileSync } from 'node:fs'
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

  it('导演助手下拉也走短名，不把能力介绍整段塞进菜单', () => {
    const assist = readFileSync('app/components/canvas/director/agent/DirectorAssistant.vue', 'utf8')
    expect(assist).toContain('shortModelName(item)')
    const css = readFileSync('app/assets/css/studio-parts/director.css', 'utf8')
    expect(css).toContain('.director-select__option span')
    expect(css).toContain('.director-agent__head-tools .director-select__menu')
  })
})

describe('prettyModelSlug', () => {
  it('去掉 provider 前缀并把连字符收成词', () => {
    expect(prettyModelSlug('easyapi/seedance-1.5')).toBe('Seedance 1.5')
  })
})
