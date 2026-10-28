import { describe, expect, it } from 'vitest'
import { BODY_TYPE_OPTIONS, getBodyTypeLabel, isCharacterBodyType, labelYOf } from './body-types'
import { getDirectorObjectFocusTarget } from './object-focus'
import type { DirectorObject } from './schema'

function character(bodyType: string, rigType = 'ue4-mannequin'): DirectorObject {
  return {
    id: 'c1',
    name: '角色',
    kind: 'character',
    visible: true,
    locked: false,
    bodyType: bodyType as never,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    characterRig: { rigType: rigType as never, posePresetId: 'stand', controls: {} },
  }
}

describe('体型表', () => {
  it('八种体型都在', () => {
    expect(BODY_TYPE_OPTIONS).toHaveLength(8)
    expect(isCharacterBodyType('chibi')).toBe(true)
    expect(isCharacterBodyType('不存在')).toBe(false)
  })

  it('体型不认识时退回男性素体', () => {
    expect(getBodyTypeLabel('乱填')).toBe('男性素体')
  })

  it('两套骨架的标签高度分开取', () => {
    // 程序化素体和 UE4 模型的单位尺度不同，混用会让对焦点落到身体外面
    expect(labelYOf('mannequin', 'ue4-mannequin')).toBe(2.04)
    expect(labelYOf('mannequin', 'mannequin')).toBe(2.62)
  })

  it('体型越小标签越低', () => {
    expect(labelYOf('chibi', 'ue4-mannequin')).toBeLessThan(labelYOf('child', 'ue4-mannequin')!)
    expect(labelYOf('child', 'ue4-mannequin')).toBeLessThan(labelYOf('teen', 'ue4-mannequin')!)
  })
})

describe('接进对焦点', () => {
  it('注入体型表后按真实身高取对焦点', () => {
    const focus = getDirectorObjectFocusTarget(character('mannequin'), labelYOf)
    // 标签在头顶 2.04，对焦点取一半 ≈ 腰腹
    expect(focus[1]).toBeCloseTo(1.02, 5)
  })

  it('不注入时退到通用值而不是崩掉', () => {
    expect(getDirectorObjectFocusTarget(character('mannequin'))[1]).toBeCloseTo(0.9, 5)
  })

  it('二头身的对焦点明显低于成年素体', () => {
    const chibi = getDirectorObjectFocusTarget(character('chibi'), labelYOf)[1]
    const adult = getDirectorObjectFocusTarget(character('mannequin'), labelYOf)[1]
    expect(chibi).toBeLessThan(adult)
  })

  it('角色被放大时对焦点跟着抬高', () => {
    const scaled = character('mannequin')
    scaled.transform.scale = [2, 2, 2]
    expect(getDirectorObjectFocusTarget(scaled, labelYOf)[1]).toBeCloseTo(2.04, 5)
  })
})
