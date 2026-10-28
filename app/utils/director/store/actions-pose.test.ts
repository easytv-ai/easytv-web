import { describe, expect, it } from 'vitest'
import {
  applyCrowdPosePreset,
  applyPosePreset,
  updateCrowdPoseControl,
  updatePoseControl,
  type PosePresetLookup,
} from './actions-pose'
import { createInitialDirectorState, type DirectorState } from './state'
import type { DirectorObject } from '../schema'

const lookup: PosePresetLookup = presetId =>
  presetId === 'wave' ? { armR: 1.2, armL: 0 } : null

function withCrowd(state: DirectorState): DirectorState {
  const members: DirectorObject[] = ['a', 'b'].map(suffix => ({
    id: `crowd_${suffix}`,
    name: `群众${suffix}`,
    kind: 'character',
    visible: true,
    locked: false,
    crowdId: 'crowd_1',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    characterRig: { rigType: 'ue4-mannequin', posePresetId: 'stand', controls: { armR: 0 } },
  }))
  return { ...state, project: { ...state.project, objects: [...state.project.objects, ...members] } }
}

function rig(state: DirectorState, id: string) {
  return state.project.objects.find(item => item.id === id)?.characterRig
}

describe('姿势预设', () => {
  it('套用预设会整套替换控制量', () => {
    const next = applyPosePreset(createInitialDirectorState(), 'char_default_a', 'wave', lookup)

    expect(rig(next, 'char_default_a')?.posePresetId).toBe('wave')
    expect(rig(next, 'char_default_a')?.controls).toEqual({ armR: 1.2, armL: 0 })
  })

  it('预设查不到时保留原有控制量，不会把角色摆成一堆零', () => {
    const state = updatePoseControl(createInitialDirectorState(), 'char_default_a', 'armR', 0.7)
    const next = applyPosePreset(state, 'char_default_a', 'fight', lookup)

    expect(rig(next, 'char_default_a')?.posePresetId).toBe('fight')
    expect(rig(next, 'char_default_a')?.controls).toEqual({ armR: 0.7 })
  })

  it('没有骨骼的对象不受影响', () => {
    // 机位对象没有 characterRig，套姿势时要安静跳过
    const next = applyPosePreset(createInitialDirectorState(), 'cam_object_1', 'wave', lookup)
    expect(rig(next, 'cam_object_1')).toBeUndefined()
  })
})

describe('单根骨头微调', () => {
  it('只覆盖这一项，预设 id 留着', () => {
    const state = applyPosePreset(createInitialDirectorState(), 'char_default_a', 'wave', lookup)
    const next = updatePoseControl(state, 'char_default_a', 'armL', -0.4)

    expect(rig(next, 'char_default_a')?.posePresetId).toBe('wave')
    expect(rig(next, 'char_default_a')?.controls).toEqual({ armR: 1.2, armL: -0.4 })
  })
})

describe('群众组姿势', () => {
  it('整组套同一个预设', () => {
    const next = applyCrowdPosePreset(withCrowd(createInitialDirectorState()), 'crowd_1', 'wave', lookup)

    expect(rig(next, 'crowd_a')?.controls).toEqual({ armR: 1.2, armL: 0 })
    expect(rig(next, 'crowd_b')?.controls).toEqual({ armR: 1.2, armL: 0 })
  })

  it('整组微调不影响组外的角色', () => {
    const state = withCrowd(createInitialDirectorState())
    const next = updateCrowdPoseControl(state, 'crowd_1', 'armR', 0.9)

    expect(rig(next, 'crowd_a')?.controls.armR).toBe(0.9)
    expect(rig(next, 'char_default_a')?.controls).toEqual({})
  })

  it('每个成员拿到的是各自的控制量副本', () => {
    const next = applyCrowdPosePreset(withCrowd(createInitialDirectorState()), 'crowd_1', 'wave', lookup)
    rig(next, 'crowd_a')!.controls.armR = 99

    expect(rig(next, 'crowd_b')?.controls.armR).toBe(1.2)
  })
})
