import { describe, expect, it } from 'vitest'
import { BODY_OFFSET_Y_CONTROL, BODY_OFFSET_Y_RANGE, POSE_CONTROL_GROUPS } from './pose-controls'
import { getPoseBoneRotations } from './mannequin-rig'

/** 全零时每根骨骼的旋转，作为对照 */
const baseline = getPoseBoneRotations({})

describe('POSE_CONTROL_GROUPS', () => {
  const allControls = POSE_CONTROL_GROUPS.flatMap(group =>
    group.controls.map(control => ({ ...control, group: group.title })),
  )

  it('键不重复 —— 重名的两个滑块会互相覆盖', () => {
    const keys = allControls.map(control => control.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it.each(allControls)('$group · $label（$key）真的会转到骨骼上', ({ key }) => {
    const rotations = getPoseBoneRotations({ [key]: 45 })

    // 这个控制量至少要让一根骨骼的角度和全零时不一样，
    // 否则说明键名和 mannequin-rig 里读的对不上，滑块拖了没反应
    const changed = Object.keys(rotations).some((bone) => {
      const next = rotations[bone]!
      const before = baseline[bone]!
      return next.some((value, axis) => Math.abs(value - before[axis]!) > 1e-9)
    })

    expect(changed).toBe(true)
  })

  it('蹲下高度单独一条，不跟角度滑块混在同一张表里', () => {
    const keys = allControls.map(control => control.key)
    expect(keys).not.toContain(BODY_OFFSET_Y_CONTROL.key)
    expect(BODY_OFFSET_Y_CONTROL.key).toBe('body.offsetY')
    expect(BODY_OFFSET_Y_RANGE).toEqual({ min: -1, max: 1, step: 0.01 })
  })
})
