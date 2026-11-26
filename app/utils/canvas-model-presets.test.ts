import { describe, expect, it } from 'vitest'
import { capturePresetParams, deleteModelPreset, parseModelPresets, presetsForModel, upsertModelPreset } from './canvas-model-presets'

describe('创作预设', () => {
  it('只留下参数档位，种子和提交模式不记', () => {
    expect(capturePresetParams({
      ratio: '9:16',
      resolution: '1080P',
      duration: 5,
      audio: true,
      seed: 7,
      mode: 'reference',
      preset: 'talking',
      prompt: '不要记',
      empty: '  ',
    })).toEqual({
      ratio: '9:16',
      resolution: '1080P',
      duration: 5,
      audio: true,
    })
  })

  it('同模型同名覆盖，别的模型留着', () => {
    const first = upsertModelPreset([], {
      name: '竖屏',
      model: 'wan3.0-video',
      params: { ratio: '9:16', duration: 5 },
      videoMode: 'reference',
    }, 1)
    const second = upsertModelPreset(first.list, {
      name: '竖屏',
      model: 'wan3.0-video',
      params: { ratio: '9:16', duration: 10 },
    }, 2)
    expect(second.replaced).toBe(true)
    expect(second.list).toHaveLength(1)
    expect(second.list[0]?.params.duration).toBe(10)
    expect(second.list[0]?.id).toBe(first.list[0]?.id)
    const other = upsertModelPreset(second.list, {
      name: '竖屏',
      model: 'kling-3.0',
      params: { ratio: '16:9' },
    }, 3)
    expect(presetsForModel(other.list, 'wan3.0-video')).toHaveLength(1)
    expect(presetsForModel(other.list, 'kling-3.0')).toHaveLength(1)
  })

  it('坏的云端数据丢掉，合法的留下', () => {
    const raw = JSON.stringify([
      { id: 'a', name: '竖屏', model: 'wan3.0-video', params: { ratio: '9:16', seed: 1 }, videoMode: 't2v', updatedAt: 3 },
      { id: '', name: '缺 id', model: 'wan3.0-video', params: { ratio: '1:1' } },
      'nope',
    ])
    const list = parseModelPresets(raw)
    expect(list).toHaveLength(1)
    expect(list?.[0]?.params).toEqual({ ratio: '9:16' })
    expect(deleteModelPreset(list || [], 'a')).toEqual([])
  })
})
