import { describe, expect, it } from 'vitest'
import { Euler, Quaternion, Vector3 } from 'three'
import {
  addCameraCaptures,
  addCameraNode,
  addCameraShot,
  applyCameraPose,
  clearCameraCaptures,
  deleteCameraCapture,
  deleteCameraNode,
  rebuildCameraTiming,
  recordCameraNode,
  setSegmentCurveMode,
  syncNodeTimes,
  updateCameraNodeTime,
  updateCameraSegment,
} from './actions-camera'
import { createInitialDirectorState, type DirectorState } from './state'
import { getCameraViewSnapshotFromShot, VIEWPORT_CAMERA_FRUSTUM_DEPTH } from '../camera-geometry'
import { getCameraPathDuration } from '../camera-path'

const CAM = 'cam_1'
/** 朝 -Z 看的单位姿态 */
const facingForward = { position: [0, 1, 5] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number], fov: 50 }

function camera(state: DirectorState) {
  return state.project.cameras.find(item => item.id === CAM)!
}

function record(state: DirectorState, z: number) {
  return recordCameraNode(state, CAM, { ...facingForward, position: [0, 1, z] })
}

describe('记录运镜节点', () => {
  it('首个节点从 0 秒开始', () => {
    const next = record(createInitialDirectorState(), 5)
    expect(camera(next).nodes).toHaveLength(1)
    expect(camera(next).nodes![0]!.time).toBe(0)
  })

  it('后续节点接在上一段的时长之后，并重建段表', () => {
    let state = record(createInitialDirectorState(), 5)
    state = record(state, 3)
    state = record(state, 1)

    const nodes = camera(state).nodes!
    const segments = camera(state).segments!

    expect(nodes).toHaveLength(3)
    expect(segments).toHaveLength(2)
    // 默认段长 1 秒，所以节点时间是 0 / 1 / 2
    expect(nodes.map(node => node.time)).toEqual([0, 1, 2])
  })

  it('节点 id 不重复', () => {
    let state = createInitialDirectorState()
    for (let i = 0; i < 4; i++)
      state = record(state, i)

    const ids = camera(state).nodes!.map(node => node.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('机位不存在时原样返回', () => {
    const state = createInitialDirectorState()
    expect(recordCameraNode(state, 'nope', facingForward)).toBe(state)
  })
})

describe('写回相机姿态', () => {
  it('机身位置沿朝向往后退一个视锥深度', () => {
    // 传进来的是取景点，机位存的是机身位置，两者差一个视锥深度
    const next = applyCameraPose(createInitialDirectorState(), CAM, facingForward, undefined)
    const position = camera(next).transform.position

    expect(position[2]).toBeCloseTo(5 + VIEWPORT_CAMERA_FRUSTUM_DEPTH, 5)
  })

  it('场景树里的机位对象跟着一起动', () => {
    const next = applyCameraPose(createInitialDirectorState(), CAM, facingForward, undefined)
    const object = next.project.objects.find(item => item.linkedCameraId === CAM)!

    expect(object.transform.position).toEqual(camera(next).transform.position)
  })

  it('旋转按 three 的 XYZ 欧拉顺序转换', () => {
    // 自己手写 roll/pitch/yaw 是 ZYX，非小角度下会歪
    const q = new Quaternion().setFromEuler(new Euler(0.3, 0.8, -0.5, 'XYZ'))
    const next = applyCameraPose(createInitialDirectorState(), CAM, {
      ...facingForward,
      rotation: [q.x, q.y, q.z, q.w],
    }, undefined)
    const rotation = camera(next).transform.rotation

    expect(rotation[0]).toBeCloseTo(0.3, 5)
    expect(rotation[1]).toBeCloseTo(0.8, 5)
    expect(rotation[2]).toBeCloseTo(-0.5, 5)
  })

  it('锁定对象的机位，注视点用对象焦点而不是姿态推出来的点', () => {
    let state = createInitialDirectorState()
    state = {
      ...state,
      project: {
        ...state.project,
        cameras: state.project.cameras.map(item => ({ ...item, targetMode: 'object' as const, targetObjectId: 'char_default_a' })),
      },
    }
    const next = applyCameraPose(state, CAM, facingForward, undefined, () => [9, 9, 9])

    expect(camera(next).target).toEqual([9, 9, 9])
  })
})

describe('节点与段的时间对齐', () => {
  it('段表反推节点时间', () => {
    const nodes = [
      { id: 'a', position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number], fov: 50, time: 0 },
      { id: 'b', position: [0, 0, 1] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number], fov: 50, time: 99 },
    ]
    const segments = [{ id: 'a:b', fromNodeId: 'a', toNodeId: 'b', curveMode: 'linear' as const, duration: 2, holdAfter: 1, easing: 'linear' as const }]

    expect(syncNodeTimes(nodes, segments).map(node => node.time)).toEqual([0, 3])
  })

  it('节点少于两个时清空段表', () => {
    const cam = { ...createInitialDirectorState().project.cameras[0]!, nodes: [], segments: [{ id: 'x' } as never] }
    expect(rebuildCameraTiming(cam).segments).toEqual([])
  })

  it('拖节点改的是前一段的时长，停顿不动', () => {
    let state = record(createInitialDirectorState(), 5)
    state = record(state, 3)
    const nodeId = camera(state).nodes![1]!.id

    state = updateCameraSegment(state, CAM, camera(state).segments![0]!.id, { holdAfter: 0.5 })
    state = updateCameraNodeTime(state, CAM, nodeId, 2.5)

    const segment = camera(state).segments![0]!
    expect(segment.holdAfter).toBe(0.5)
    expect(segment.duration).toBeCloseTo(2, 5)
  })

  it('拖到超出边界时被钳住', () => {
    let state = record(createInitialDirectorState(), 5)
    state = record(state, 3)
    const nodeId = camera(state).nodes![1]!.id

    state = updateCameraNodeTime(state, CAM, nodeId, -10)
    // 最小段长 0.1，所以第二个节点最早只能在 0.1 秒
    expect(camera(state).nodes![1]!.time).toBeCloseTo(0.1, 5)
  })

  it('删节点后段表重建，剩下的节点时间重新对齐', () => {
    let state = createInitialDirectorState()
    for (const z of [5, 4, 3])
      state = record(state, z)

    const middleId = camera(state).nodes![1]!.id
    state = deleteCameraNode(state, CAM, middleId)

    expect(camera(state).nodes).toHaveLength(2)
    expect(camera(state).segments).toHaveLength(1)
    // 新段 a:c 在旧段表里找不到，时长按两端节点的时间差推出来 ——
    // 删掉中间的经停点，首尾之间的总时长保持不变，而不是压缩成一段的长度
    expect(camera(state).nodes!.map(node => node.time)).toEqual([0, 2])
  })

  it('删不存在的节点不产生改动', () => {
    const state = record(createInitialDirectorState(), 5)
    expect(deleteCameraNode(state, CAM, 'nope')).toBe(state)
  })
})

describe('曲线模式', () => {
  it('转成贝塞尔时补上默认控制柄', () => {
    let state = record(createInitialDirectorState(), 5)
    state = record(state, 1)
    const segmentId = camera(state).segments![0]!.id

    state = setSegmentCurveMode(state, CAM, segmentId, 'bezier')
    const segment = camera(state).segments![0]!

    expect(segment.curveMode).toBe('bezier')
    expect(segment.handleOut).toBeDefined()
    expect(segment.handleIn).toBeDefined()
  })
})

describe('机位截图', () => {
  it('编号接着往下排，并记住最后一张', () => {
    let state = addCameraCaptures(createInitialDirectorState(), CAM, ['data:image/png;base64,a'])
    state = addCameraCaptures(state, CAM, ['data:image/png;base64,b', 'data:image/png;base64,c'])

    const captures = camera(state).captures!
    expect(captures.map(item => item.index)).toEqual([1, 2, 3])
    expect(captures[2]!.name).toContain('截图03')
    expect(camera(state).lastCaptureUrl).toBe('data:image/png;base64,c')
  })

  it('不传机位 id 时落到当前机位', () => {
    const state = addCameraCaptures(createInitialDirectorState(), null, ['data:image/png;base64,a'])
    expect(camera(state).captures).toHaveLength(1)
  })

  it('空数组不产生改动', () => {
    const state = createInitialDirectorState()
    expect(addCameraCaptures(state, CAM, [])).toBe(state)
  })
})

describe('机位截图的删除与清空', () => {
  function withCaptures(): DirectorState {
    const base = createInitialDirectorState()
    const first = base.project.cameras[0]!
    return addCameraCaptures({
      ...base,
      project: {
        ...base.project,
        cameras: [
          first,
          { ...first, id: 'cam_2', name: '机位02', captures: [], lastCaptureUrl: null },
        ],
      },
    }, first.id, ['data:image/png;base64,a', 'data:image/png;base64,b'])
  }

  it('删掉一张，lastCaptureUrl 跟着退回上一张', () => {
    const state = withCaptures()
    const captures = state.project.cameras[0]!.captures!
    const next = deleteCameraCapture(state, captures[1]!.id)

    expect(next.project.cameras[0]!.captures).toHaveLength(1)
    expect(next.project.cameras[0]!.lastCaptureUrl).toBe('data:image/png;base64,a')
  })

  it('删光之后 lastCaptureUrl 置空 —— 不然缩略图会指着一张不存在的图', () => {
    let state = withCaptures()
    for (const capture of [...state.project.cameras[0]!.captures!])
      state = deleteCameraCapture(state, capture.id)

    expect(state.project.cameras[0]!.captures).toHaveLength(0)
    expect(state.project.cameras[0]!.lastCaptureUrl).toBeNull()
  })

  it('截图 id 不存在时原样返回', () => {
    const state = withCaptures()
    expect(deleteCameraCapture(state, 'nope')).toBe(state)
  })

  it('清空把所有机位一起清掉', () => {
    const next = clearCameraCaptures(withCaptures())
    for (const item of next.project.cameras) {
      expect(item.captures).toEqual([])
      expect(item.lastCaptureUrl).toBeNull()
    }
  })

  it('本来就没有截图时原样返回，不占一步撤销', () => {
    const state = createInitialDirectorState()
    expect(clearCameraCaptures(state)).toBe(state)
  })
})

describe('addCameraNode', () => {
  /** 三个节点，第一段设了缓动和停顿 */
  function threeNodes(): DirectorState {
    let state = createInitialDirectorState()
    for (const z of [5, 3, 1])
      state = record(state, z)
    const segments = camera(state).segments!
    return updateCameraSegment(state, CAM, segments[0]!.id, {
      easing: 'ease-in-out',
      holdAfter: 0.4,
      duration: 1,
    })
  }

  it('不传 afterNodeId 时接在末尾，姿态取机位当前取景', () => {
    const state = threeNodes()
    const before = camera(state).nodes!.length
    const next = addCameraNode(state, CAM)
    expect(camera(next).nodes).toHaveLength(before + 1)
  })

  it('第一个节点从 0 秒开始', () => {
    const next = addCameraNode(createInitialDirectorState(), CAM)
    expect(camera(next).nodes).toHaveLength(1)
    expect(camera(next).nodes![0]!.time).toBe(0)
  })

  it('插在中间：位置取中点', () => {
    const state = threeNodes()
    const nodes = camera(state).nodes!
    const next = addCameraNode(state, CAM, nodes[0]!.id)
    const inserted = camera(next).nodes![1]!

    expect(camera(next).nodes).toHaveLength(4)
    expect(inserted.position[2]).toBeCloseTo((nodes[0]!.position[2]! + nodes[1]!.position[2]!) / 2, 10)
  })

  it('插在中间：旋转走 slerp，四元数仍是单位长度', () => {
    let state = createInitialDirectorState()
    state = recordCameraNode(state, CAM, { ...facingForward, rotation: [0, 0, 0, 1] })
    // 绕 Y 转 90 度
    state = recordCameraNode(state, CAM, {
      ...facingForward,
      position: [3, 1, 0],
      rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
    })

    const nodes = camera(state).nodes!
    const next = addCameraNode(state, CAM, nodes[0]!.id)
    const [x, y, z, w] = camera(next).nodes![1]!.rotation

    expect(Math.hypot(x, y, z, w)).toBeCloseTo(1, 10)
    // 逐分量求平均的话 y 会是 0.354；slerp 出来的是 45 度，约 0.383
    expect(y).toBeCloseTo(Math.sin(Math.PI / 8), 6)
  })

  it('插在中间：停顿归后一段，缓动两段都继承', () => {
    const state = threeNodes()
    const nodes = camera(state).nodes!
    const next = addCameraNode(state, CAM, nodes[0]!.id)
    const segments = camera(next).segments!

    expect(segments[0]!.easing).toBe('ease-in-out')
    expect(segments[0]!.holdAfter).toBe(0)
    expect(segments[1]!.easing).toBe('ease-in-out')
    expect(segments[1]!.holdAfter).toBeCloseTo(0.4, 6)
  })

  it('插在中间不改变整条路径的总时长', () => {
    const state = threeNodes()
    const nodes = camera(state).nodes!
    const before = getCameraPathDuration(nodes, camera(state).segments!)

    const next = addCameraNode(state, CAM, nodes[0]!.id)
    const after = getCameraPathDuration(camera(next).nodes!, camera(next).segments!)

    expect(after).toBeCloseTo(before, 6)
  })

  it('afterNodeId 不存在时原样返回，不会被 findIndex 的 -1 插到最前面', () => {
    const state = threeNodes()
    expect(addCameraNode(state, CAM, 'nope')).toBe(state)
  })

  it('机位不存在时原样返回', () => {
    const state = threeNodes()
    expect(addCameraNode(state, 'no-such-camera')).toBe(state)
  })
})

describe('addCameraShot', () => {
  const input = {
    position: [4, 1.7, 6] as [number, number, number],
    target: [0, 1, 0] as [number, number, number],
    fov: 40,
  }

  it('机位本体和场景树里的对象成对创建 —— 只建一半的话树里看不见', () => {
    const before = createInitialDirectorState()
    const { state, cameraId } = addCameraShot(before, input)

    expect(state.project.cameras).toHaveLength(before.project.cameras.length + 1)
    const object = state.project.objects.find(item => item.linkedCameraId === cameraId)
    expect(object).toBeDefined()
    expect(object!.kind).toBe('camera')
  })

  it('对象和本体同名，改一处不会两边对不上', () => {
    const { state, cameraId } = addCameraShot(createInitialDirectorState(), { ...input, name: '主机位' })
    const shot = state.project.cameras.find(item => item.id === cameraId)!
    const object = state.project.objects.find(item => item.linkedCameraId === cameraId)!

    expect(shot.name).toBe('主机位')
    expect(object.name).toBe('主机位')
  })

  it('新建的机位直接设为当前', () => {
    const { state, cameraId } = addCameraShot(createInitialDirectorState(), input)
    expect(state.project.activeCameraId).toBe(cameraId)
  })

  it('存的是机身位置，比取景点往后退一个视锥深度', () => {
    const { state, cameraId } = addCameraShot(createInitialDirectorState(), input)
    const shot = state.project.cameras.find(item => item.id === cameraId)!
    const rig = new Vector3(...shot.transform.position)
    const view = new Vector3(...input.position)

    expect(rig.distanceTo(view)).toBeCloseTo(VIEWPORT_CAMERA_FRUSTUM_DEPTH, 4)
  })

  it('反推回取景快照能回到传进来的取景点和目标', () => {
    const { state, cameraId } = addCameraShot(createInitialDirectorState(), input)
    const shot = state.project.cameras.find(item => item.id === cameraId)!
    const snapshot = getCameraViewSnapshotFromShot(shot)

    for (let axis = 0; axis < 3; axis++)
      expect(snapshot.position[axis]).toBeCloseTo(input.position[axis]!, 3)
    expect(snapshot.fov).toBe(40)
  })

  it('连建两台不会撞 id', () => {
    const first = addCameraShot(createInitialDirectorState(), input)
    const second = addCameraShot(first.state, input)

    expect(second.cameraId).not.toBe(first.cameraId)
    const objectIds = second.state.project.objects.map(item => item.id)
    expect(new Set(objectIds).size).toBe(objectIds.length)
  })
})
