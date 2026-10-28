import { describe, expect, it } from 'vitest'
import {
  catalogModelKey,
  catalogModelsEqual,
  resolveCatalogModel,
  resolveCatalogModelId,
} from './canvas-catalog-model'

function item(model: string, type = 'video', priced = true, label = '') {
  return { model, type, priced, label }
}

describe('catalogModelKey / catalogModelsEqual', () => {
  it('大小写和分隔符不同仍是同一个模型', () => {
    expect(catalogModelKey('Kling-2.5')).toBe('kling25')
    expect(catalogModelKey('kling/2.5')).toBe('kling25')
    expect(catalogModelsEqual('Kling-2.5', 'kling-2.5')).toBe(true)
    expect(catalogModelsEqual('qwen-image-2.0', 'Qwen-Image-2.0')).toBe(true)
    expect(catalogModelsEqual('Kling-2.5', 'Kling-2.6')).toBe(false)
    expect(catalogModelsEqual('', 'Kling-2.5')).toBe(false)
  })
})

describe('resolveCatalogModel', () => {
  const catalog = [
    item('gpt-image-2', 'image'),
    item('qwen-image-2.0', 'image'),
    item('seedance-2.0-fast', 'video'),
    item('kling-2.5', 'video'),
    item('kling-2.6', 'video'),
  ]

  it('精确命中就用清单 id', () => {
    expect(resolveCatalogModel('qwen-image-2.0', catalog, { type: 'image' })).toBe('qwen-image-2.0')
    expect(resolveCatalogModel('kling-2.5', catalog, { type: 'video' })).toBe('kling-2.5')
  })

  it('剧本里的 Kling-2.5 对到清单的 kling-2.5，不会落到 Seedance', () => {
    expect(resolveCatalogModel('Kling-2.5', catalog, { type: 'video' })).toBe('kling-2.5')
    expect(resolveCatalogModel('Kling-2.5', catalog, { type: 'video' })).not.toBe('seedance-2.0-fast')
  })

  it('按类型收窄：视频 wanted 不会命中同名图片', () => {
    const mixed = [item('kling-2.5', 'image'), item('kling-2.5-pro', 'video')]
    expect(resolveCatalogModel('Kling-2.5', mixed, { type: 'video' })).toBe('kling-2.5-pro')
  })

  it('带版本后缀的变体：Kling-2.5 可以落到 kling-2.5-turbo', () => {
    expect(resolveCatalogModel('Kling-2.5', [item('kling-2.5-turbo')], { type: 'video' })).toBe('kling-2.5-turbo')
  })

  it('太短的前缀不能乱撞：kling 不会命中 kling-2.6', () => {
    expect(resolveCatalogModel('kling', catalog, { type: 'video' })).toBeNull()
  })

  it('同分时已定价优先', () => {
    const rows = [item('kling-2.5', 'video', false), item('Kling-2.5', 'video', true)]
    expect(resolveCatalogModel('Kling-2.5', rows, { type: 'video' })).toBe('Kling-2.5')
  })

  it('清单空或对不上返回 null，resolveCatalogModelId 保留原文', () => {
    expect(resolveCatalogModel('Kling-2.5', [])).toBeNull()
    expect(resolveCatalogModel('not-a-model', catalog, { type: 'video' })).toBeNull()
    expect(resolveCatalogModel('auto', catalog, { type: 'video' })).toBeNull()
    expect(resolveCatalogModelId('Kling-2.5', [])).toBe('Kling-2.5')
    expect(resolveCatalogModelId('auto', catalog)).toBe('auto')
  })

  it('label 对得上也可以', () => {
    expect(resolveCatalogModel('Kling 2.5', [item('vendor/kling-v2.5', 'video', true, 'Kling 2.5')])).toBe('vendor/kling-v2.5')
  })
})
