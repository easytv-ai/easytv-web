import { describe, expect, it } from 'vitest'
import { getPosePresetLabel, lookupPosePreset, MANNEQUIN_POSE_PRESETS } from './pose-presets'
import { POSE_PRESET_IDS } from './schema'

describe('姿势预设表', () => {
  it('schema 声明的每个姿势都有对应的预设', () => {
    // 少一个就会在面板上点出空姿势
    for (const id of POSE_PRESET_IDS)
      expect(MANNEQUIN_POSE_PRESETS.some(item => item.id === id), `缺少姿势 ${id}`).toBe(true)
  })

  it('预设数量和 schema 对得上，没有多余项', () => {
    expect(MANNEQUIN_POSE_PRESETS).toHaveLength(POSE_PRESET_IDS.length)
  })

  it('控制量的键名符合 骨骼.属性 的形式', () => {
    // runtime 按这个形式查骨骼，写错了姿势就静默不生效
    for (const preset of MANNEQUIN_POSE_PRESETS) {
      for (const key of Object.keys(preset.controls))
        expect(key, `${preset.id} 的 ${key}`).toMatch(/^[a-zA-Z]+\.[a-zA-Z]+$/)
    }
  })

  it('控制量都是有限的角度数值', () => {
    for (const preset of MANNEQUIN_POSE_PRESETS) {
      for (const [key, value] of Object.entries(preset.controls)) {
        expect(Number.isFinite(value), `${preset.id} 的 ${key}`).toBe(true)
        expect(Math.abs(value), `${preset.id} 的 ${key} 超出合理角度`).toBeLessThanOrEqual(180)
      }
    }
  })

  it('站立是全零姿态', () => {
    expect(lookupPosePreset('stand')).toEqual({})
  })

  it('查不到时返回 null，调用方会保留原有控制量', () => {
    expect(lookupPosePreset('不存在' as never)).toBeNull()
  })

  it('标签能查到，查不到时退回 id', () => {
    expect(getPosePresetLabel('t-pose')).toBe('T型')
    expect(getPosePresetLabel('未知' as never)).toBe('未知')
  })
})
