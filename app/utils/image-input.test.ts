import { describe, expect, it } from 'vitest'
import { pickCanvasImageEditModel, pickImageEditModel, listImageEditModels, pickImageUpscaleModel, pickVisionTextModel, preferredImageModel, supportsImageRefs } from './image-input'
import type { GenerationModel } from '~/types/creative'

function m(model: string, image_input: GenerationModel['image_input'], priced = true): GenerationModel {
  return { provider: 'easyapi', model, type: 'image', label: model, unit: 'image', points_per_unit: 1, member_points_per_unit: 1, priced, image_input } as GenerationModel
}

describe('image-input', () => {
  const list = [m('dall-e-3', 'none'), m('seedream-4.5', 'url'), m('gpt-image-2', 'edits'), m('gpt-image-1', 'edits', false)]

  it('supportsImageRefs', () => {
    expect(supportsImageRefs(list[0])).toBe(false)
    expect(supportsImageRefs(list[1])).toBe(true)
    expect(supportsImageRefs(undefined)).toBe(false)
  })

  it('默认模型支持就用默认模型', () => {
    expect(pickImageEditModel(list, 'seedream-4.5', false)).toBe('seedream-4.5')
  })

  it('默认模型不支持参考图时换第一个支持的', () => {
    expect(pickImageEditModel(list, 'dall-e-3', false)).toBe('seedream-4.5')
  })

  it('带蒙版只选 edits 方式且已定价的模型', () => {
    expect(pickImageEditModel(list, 'seedream-4.5', true)).toBe('gpt-image-2')
    expect(pickImageEditModel([m('gpt-image-1', 'edits', false)], '', true)).toBe('')
  })

  it('画布编辑模型和工具条报价用同一条：优先默认图模', () => {
    expect(preferredImageModel(list)).toBe('dall-e-3')
    expect(pickCanvasImageEditModel(list)).toBe('seedream-4.5')
    expect(pickCanvasImageEditModel(list)).toBe(pickImageEditModel(list, preferredImageModel(list), false))
    expect(pickImageEditModel(list, '', false)).toBe('seedream-4.5')
  })

  it('图片高清避开封顶 1536 的 gpt-image', () => {
    expect(pickImageUpscaleModel(list, 'gpt-image-2')).toBe('seedream-4.5')
    expect(pickImageUpscaleModel(list, 'seedream-4.5')).toBe('seedream-4.5')
    expect(pickImageUpscaleModel([m('gpt-image-2', 'edits')], 'gpt-image-2')).toBe('gpt-image-2')
  })

  it('图片高清不用 qwen-image-edit，有 Seedream 就用 Seedream', () => {
    const withEdit = [...list, m('qwen-image-2.0', 'url'), m('qwen-image-edit', 'url')]
    expect(pickImageUpscaleModel(withEdit, 'qwen-image-2.0')).toBe('seedream-4.5')
    expect(pickImageUpscaleModel(withEdit, 'qwen-image-edit')).toBe('seedream-4.5')
    expect(pickImageUpscaleModel([m('qwen-image-edit', 'url'), m('qwen-image-2.0', 'url')], 'qwen-image-edit')).toBe('qwen-image-2.0')
  })

  it('列出可编辑模型', () => {
    expect(listImageEditModels(list, false).map(item => item.model)).toEqual(['seedream-4.5', 'gpt-image-2'])
    expect(listImageEditModels(list, true).map(item => item.model)).toEqual(['gpt-image-2'])
  })

  it('反推提示词只挑能看图的文本模型', () => {
    const text = (model: string, priced = true) => ({ ...m(model, '', priced), type: 'text' }) as GenerationModel
    expect(pickVisionTextModel([m('gpt-image-2', 'edits'), text('gpt-4o-mini-tts'), text('deepseek-chat'), text('gpt-4o-mini')])).toBe('gpt-4o-mini')
    expect(pickVisionTextModel([text('gemini-2.5-flash', false), text('claude-sonnet-4')])).toBe('claude-sonnet-4')
    // 都已定价时按偏好顺序挑：gemini > claude > gpt > 国产 VL
    expect(pickVisionTextModel([text('gpt-4o-mini'), text('claude-sonnet-4'), text('gemini-2.5-flash')])).toBe('gemini-2.5-flash')
    expect(pickVisionTextModel([text('deepseek-chat')])).toBe('')
    // 运营配了就用运营配的（哪怕名字不在看图偏好里）；不在清单里就回落到自动挑
    expect(pickVisionTextModel([text('gpt-4o-mini'), text('gemini-2.5-flash'), text('glm-4.6v')], 'glm-4.6v')).toBe('glm-4.6v')
    expect(pickVisionTextModel([text('gpt-4o-mini'), text('gemini-2.5-flash')], 'qwen3-vl-plus')).toBe('gemini-2.5-flash')
  })
})
