import { describe, expect, it } from 'vitest'
import {
  applyCrowdTransformPatch,
  toggleObjectLocked,
  toggleObjectVisible,
  toggleObjectsVisible,
  updateCrowdLabel,
  updateCrowdTransform,
  updateCrowdUniformScale,
  updateObjectName,
  updateObjectTransform,
  updateUniformScale,
} from './actions-transform'
import { createInitialDirectorState, type DirectorState } from './state'
import type { DirectorObject } from '../schema'

/** 三个群众站成一排：x = 0 / 2 / 4，锚点在 x=2 */
function withCrowd(state: DirectorState): DirectorState {
  const members: DirectorObject[] = [0, 2, 4].map((x, index) => ({
    id: `crowd_${index}`,
    name: `群众${index}`,
    kind: 'character',
    visible: true,
    locked: false,
    crowdId: 'crowd_1',
    crowdLabel: '群众01',
    transform: { position: [x, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  }))
  return { ...state, project: { ...state.project, objects: [...state.project.objects, ...members] } }
}

function positions(state: DirectorState) {
  return state.project.objects.filter(item => item.crowdId === 'crowd_1').map(item => item.transform.position)
}

describe('单个对象变换', () => {
  it('只改传进来的分量', () => {
    const state = createInitialDirectorState()
    const next = updateObjectTransform(state, 'char_default_a', { position: [1, 2, 3] })
    const role = next.project.objects.find(item => item.id === 'char_default_a')!

    expect(role.transform.position).toEqual([1, 2, 3])
    expect(role.transform.rotation).toEqual([0, 0, 0])
    expect(role.transform.scale).toEqual([1, 1, 1])
  })

  it('拖动机位对象时机位数据同步跟上', () => {
    // 场景树里的机位对象和 cameras 里的机位是两份数据，不同步的话视角会和线框对不上
    const state = createInitialDirectorState()
    const next = updateObjectTransform(state, 'cam_object_1', { position: [9, 1, 9] })

    expect(next.project.cameras[0]!.transform.position).toEqual([9, 1, 9])
  })

  it('拖动机身时手动注视点跟着平移', () => {
    const state = createInitialDirectorState()
    const camera = state.project.cameras[0]!
    const next = updateObjectTransform(state, 'cam_object_1', {
      position: [camera.transform.position[0] + 2, camera.transform.position[1], camera.transform.position[2]],
    })

    expect(next.project.cameras[0]!.target[0]).toBeCloseTo(camera.target[0] + 2)
    expect(next.project.cameras[0]!.target[1]).toBeCloseTo(camera.target[1])
    expect(next.project.cameras[0]!.target[2]).toBeCloseTo(camera.target[2])
  })

  it('对象不存在时原样返回', () => {
    const state = createInitialDirectorState()
    expect(updateObjectTransform(state, 'nope', { position: [1, 1, 1] })).toBe(state)
  })

  it('整体缩放三轴同值', () => {
    const state = updateUniformScale(createInitialDirectorState(), 'char_default_a', 1.5)
    expect(state.project.objects.find(item => item.id === 'char_default_a')!.transform.scale).toEqual([1.5, 1.5, 1.5])
  })
})

describe('群众组整体变换', () => {
  it('整组平移时保持成员之间的相对站位', () => {
    const state = withCrowd(createInitialDirectorState())
    // 锚点从 x=2 挪到 x=10，整组右移 8
    const next = updateCrowdTransform(state, 'crowd_1', { position: [10, 0, 0] })

    expect(positions(next)).toEqual([[8, 0, 0], [10, 0, 0], [12, 0, 0]])
  })

  it('整组缩放按锚点放大间距，成员自身也跟着缩放', () => {
    const state = withCrowd(createInitialDirectorState())
    const next = updateCrowdTransform(state, 'crowd_1', { scale: [2, 2, 2] })

    // 间距从 2 变成 4，锚点 x=2 不动
    expect(positions(next)).toEqual([[-2, 0, 0], [2, 0, 0], [6, 0, 0]])
    for (const item of next.project.objects.filter(o => o.crowdId === 'crowd_1'))
      expect(item.transform.scale).toEqual([2, 2, 2])
  })

  it('整组绕 Y 轴旋转 90 度，站位跟着转到 Z 轴上', () => {
    const state = withCrowd(createInitialDirectorState())
    const next = updateCrowdTransform(state, 'crowd_1', { rotation: [0, Math.PI / 2, 0] })
    const result = positions(next)

    // 原本排在 X 轴上（相对锚点 -2 / 0 / +2），转 90° 后应该排到 Z 轴上
    expect(result[0]![0]).toBeCloseTo(2, 5)
    expect(result[0]![2]).toBeCloseTo(2, 5)
    expect(result[1]![0]).toBeCloseTo(2, 5)
    expect(result[1]![2]).toBeCloseTo(0, 5)
    expect(result[2]![2]).toBeCloseTo(-2, 5)
  })

  it('旋转是在成员各自角度上叠加增量，不是统一设成同一个角度', () => {
    const state = withCrowd(createInitialDirectorState())
    const tilted = {
      ...state,
      project: {
        ...state.project,
        objects: state.project.objects.map(item =>
          item.id === 'crowd_0'
            ? { ...item, transform: { ...item.transform, rotation: [0, 1, 0] as [number, number, number] } }
            : item),
      },
    }
    // 锚点旋转取第一个成员（crowd_0）的角度，也就是 1；改成 1.5 等于整组 +0.5
    const next = updateCrowdTransform(tilted, 'crowd_1', { rotation: [0, 1.5, 0] })
    const members = next.project.objects.filter(item => item.crowdId === 'crowd_1')

    // 关键：不是把所有人统一设成 1.5，而是各自加同一个增量
    expect(members[0]!.transform.rotation[1]).toBeCloseTo(1.5, 5)
    expect(members[1]!.transform.rotation[1]).toBeCloseTo(0.5, 5)
    expect(members[2]!.transform.rotation[1]).toBeCloseTo(0.5, 5)
  })

  it('锚点缩放为 0 时退回 1 倍，不会把整组塌成一个点', () => {
    const state = withCrowd(createInitialDirectorState())
    const zeroed = {
      ...state,
      project: {
        ...state.project,
        objects: state.project.objects.map(item =>
          item.crowdId === 'crowd_1'
            ? { ...item, transform: { ...item.transform, scale: [0, 0, 0] as [number, number, number] } }
            : item),
      },
    }
    const next = updateCrowdTransform(zeroed, 'crowd_1', { position: [0, 0, 0] })

    // 间距保持 2，没有因为除以 0 变成 NaN 或全部重合
    const result = positions(next)
    expect(result[0]![0]).toBeCloseTo(-2, 5)
    expect(result[2]![0]).toBeCloseTo(2, 5)
  })

  it('组不存在时不产生改动', () => {
    const state = createInitialDirectorState()
    const result = applyCrowdTransformPatch(state.project.objects, 'nope', { position: [1, 1, 1] })

    expect(result.changedObjectIds).toEqual([])
    expect(result.objects).toBe(state.project.objects)
    expect(updateCrowdTransform(state, 'nope', { position: [1, 1, 1] })).toBe(state)
  })

  it('整组缩放走 uniform 入口', () => {
    const state = withCrowd(createInitialDirectorState())
    const next = updateCrowdUniformScale(state, 'crowd_1', 3)
    expect(next.project.objects.find(item => item.id === 'crowd_0')!.transform.scale).toEqual([3, 3, 3])
  })
})

describe('名称与开关', () => {
  it('改组名不动成员各自的名字', () => {
    const state = withCrowd(createInitialDirectorState())
    const next = updateCrowdLabel(state, 'crowd_1', '路人甲组')
    const members = next.project.objects.filter(item => item.crowdId === 'crowd_1')

    expect(members.every(item => item.crowdLabel === '路人甲组')).toBe(true)
    expect(members.map(item => item.name)).toEqual(['群众0', '群众1', '群众2'])
  })

  it('改单个对象的名字', () => {
    const next = updateObjectName(createInitialDirectorState(), 'char_default_a', '主角')
    expect(next.project.objects.find(item => item.id === 'char_default_a')!.name).toBe('主角')
  })

  it('可见性和锁定是来回切换', () => {
    let state = createInitialDirectorState()
    state = toggleObjectVisible(state, 'char_default_a')
    expect(state.project.objects.find(item => item.id === 'char_default_a')!.visible).toBe(false)

    state = toggleObjectVisible(state, 'char_default_a')
    expect(state.project.objects.find(item => item.id === 'char_default_a')!.visible).toBe(true)

    state = toggleObjectLocked(state, 'char_default_a')
    expect(state.project.objects.find(item => item.id === 'char_default_a')!.locked).toBe(true)
  })

  it('一批对象一起切可见：全开就全关', () => {
    const crowd = withCrowd(createInitialDirectorState())
    const ids = crowd.project.objects.filter(item => item.crowdId === 'crowd_1').map(item => item.id)
    const hidden = toggleObjectsVisible(crowd, ids)
    expect(hidden.project.objects.filter(item => item.crowdId === 'crowd_1').every(item => !item.visible)).toBe(true)
    const shown = toggleObjectsVisible(hidden, ids)
    expect(shown.project.objects.filter(item => item.crowdId === 'crowd_1').every(item => item.visible)).toBe(true)
  })
})
