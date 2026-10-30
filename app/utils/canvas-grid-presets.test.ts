import { describe, expect, it } from 'vitest'
import { buildGridPrompt, GRID_PRESETS, gridPresetById, gridPresetPatch, gridPresetsFor } from './canvas-grid-presets'

describe('GRID_PRESETS', () => {
  it('九项宫格预设都在', () => {
    expect(GRID_PRESETS.map(item => item.id)).toEqual([
      'multi-cam-9', 'story-4', 'storyboard-25', 'cine-light',
      'before-5s', 'after-3s', 'character-sheet', 'storyboard', 'blocking-board',
    ])
  })

  it('每条都得有说明、提示词和比例，id 不重复', () => {
    for (const item of GRID_PRESETS) {
      expect(item.hint.length, item.id).toBeGreaterThan(0)
      expect(item.prompt.length, item.id).toBeGreaterThan(20)
      expect(item.ratio, item.id).toMatch(/^\d+:\d+$/)
    }
    expect(new Set(GRID_PRESETS.map(item => item.id)).size).toBe(GRID_PRESETS.length)
  })

  it('宫格类锁 1:1，推演与设定图走 16:9', () => {
    expect(gridPresetById('multi-cam-9')!.ratio).toBe('1:1')
    expect(gridPresetById('storyboard-25')!.ratio).toBe('1:1')
    expect(gridPresetById('after-3s')!.ratio).toBe('16:9')
  })

  it('查不到的 id 给 null', () => {
    expect(gridPresetById('zzz')).toBeNull()
    expect(gridPresetById()).toBeNull()
  })
})

describe('gridPresetsFor', () => {
  it('没有参考图时只留不需要图的两条', () => {
    expect(gridPresetsFor(false).map(item => item.id)).toEqual(['storyboard', 'blocking-board'])
  })

  it('有参考图时全给', () => {
    expect(gridPresetsFor(true)).toHaveLength(GRID_PRESETS.length)
  })
})

describe('buildGridPrompt 与 gridPresetPatch', () => {
  const preset = gridPresetById('multi-cam-9')!

  it('提示词为空时直接用预设正文', () => {
    expect(buildGridPrompt(preset, '   ')).toBe(preset.prompt)
  })

  it('用户写过的留在前面，预设接在后面', () => {
    const merged = buildGridPrompt(preset, '深夜面馆，老板在下面')
    expect(merged.startsWith('深夜面馆，老板在下面')).toBe(true)
    expect(merged).toContain(preset.prompt)
  })

  it('重复选同一条不会叠第二遍', () => {
    const once = buildGridPrompt(preset, '深夜面馆')
    expect(buildGridPrompt(preset, once)).toBe(once)
  })

  it('补丁把比例写进 params，并保留已有的其它参数', () => {
    expect(gridPresetPatch(preset, '', { clarity: '4K' })).toEqual({
      prompt: preset.prompt,
      params: { clarity: '4K', ratio: '1:1' },
    })
  })
})
