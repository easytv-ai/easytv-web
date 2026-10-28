import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import {
  applyEasing,
  buildCameraSegments,
  clampNodeTime,
  evaluateCameraPath,
  getCameraPathDuration,
  getDefaultBezierHandles,
  getLookAtQuaternion,
  getNodeStartTimes,
  getSegmentRenderPoints,
} from './camera-path'
import type { CameraNode, CameraSegment } from './schema'

function makeNode(id: string, time: number, position: [number, number, number], fov = 50): CameraNode {
  return { id, position, rotation: [0, 0, 0, 1], fov, time }
}

const nodeA = makeNode('a', 0, [0, 0, 0])
const nodeB = makeNode('b', 2, [0, 0, 10])
const nodeC = makeNode('c', 4, [10, 0, 10])

describe('重建运动段', () => {
  it('按节点时间差推出默认段', () => {
    const segments = buildCameraSegments([nodeA, nodeB, nodeC])

    expect(segments).toHaveLength(2)
    expect(segments[0]).toMatchObject({ fromNodeId: 'a', toNodeId: 'b', duration: 2, curveMode: 'linear', easing: 'linear' })
    expect(segments[1]).toMatchObject({ fromNodeId: 'b', toNodeId: 'c', duration: 2 })
  })

  it('同 id 的老段保留用户调过的设置', () => {
    const previous: CameraSegment[] = [{
      id: 'a:b',
      fromNodeId: 'a',
      toNodeId: 'b',
      curveMode: 'bezier',
      duration: 1.5,
      holdAfter: 0.5,
      easing: 'ease-in-out',
    }]
    const segments = buildCameraSegments([nodeA, nodeB], previous)

    expect(segments[0]).toMatchObject({ curveMode: 'bezier', duration: 1.5, holdAfter: 0.5, easing: 'ease-in-out' })
  })

  it('节点挨得太近时段长兜底到最小值', () => {
    const close = makeNode('b2', 0.01, [0, 0, 1])
    expect(buildCameraSegments([nodeA, close])[0]!.duration).toBeCloseTo(0.1)
  })
})

describe('求任意时刻的姿态', () => {
  it('直线段中点取中间位置，越界钳到两端', () => {
    const segments = buildCameraSegments([nodeA, nodeB])

    expect(evaluateCameraPath([nodeA, nodeB], segments, 1)!.position.distanceTo(new Vector3(0, 0, 5))).toBeLessThan(1e-6)
    expect(evaluateCameraPath([nodeA, nodeB], segments, -5)!.position.distanceTo(new Vector3(0, 0, 0))).toBeLessThan(1e-6)
    expect(evaluateCameraPath([nodeA, nodeB], segments, 99)!.position.distanceTo(new Vector3(0, 0, 10))).toBeLessThan(1e-6)
  })

  it('holdAfter 期间停在段末姿态', () => {
    // A 起步，走 2 秒到 B，再停 1 秒，总长 3 秒
    const segments = buildCameraSegments([nodeA, nodeB]).map(segment => ({ ...segment, holdAfter: 1 }))

    expect(evaluateCameraPath([nodeA, nodeB], segments, 2.5)!.position.distanceTo(new Vector3(0, 0, 10))).toBeLessThan(1e-6)
    expect(evaluateCameraPath([nodeA, nodeB], segments, 10)!.position.distanceTo(new Vector3(0, 0, 10))).toBeLessThan(1e-6)
    expect(getCameraPathDuration([nodeA, nodeB], segments)).toBeCloseTo(3)
  })

  it('ease-in 在起步阶段比匀速慢', () => {
    const linear = buildCameraSegments([nodeA, nodeB])
    const eased = linear.map(segment => ({ ...segment, easing: 'ease-in' as const }))

    expect(evaluateCameraPath([nodeA, nodeB], eased, 0.25)!.position.z)
      .toBeLessThan(evaluateCameraPath([nodeA, nodeB], linear, 0.25)!.position.z)
  })

  it('贝塞尔段被控制柄顶出直线平面', () => {
    const segment: CameraSegment = {
      id: 'a:b',
      fromNodeId: 'a',
      toNodeId: 'b',
      curveMode: 'bezier',
      duration: 2,
      holdAfter: 0,
      easing: 'linear',
      handleOut: [0, 5, 3],
      handleIn: [0, 5, 7],
    }

    expect(evaluateCameraPath([nodeA, nodeB], [segment], 1)!.position.y).toBeGreaterThan(2)
  })

  it('朝向走球面插值', () => {
    // 欧拉插值在接近极点时会抽风，这里要的是 slerp
    const from: CameraNode = { ...nodeA, rotation: [0, 0, 0, 1] }
    const to: CameraNode = { ...nodeB, rotation: [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)] }
    const segments = buildCameraSegments([from, to])
    const mid = evaluateCameraPath([from, to], segments, 1)

    const expected = new Quaternion(0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4))
      .normalize()
      .slerp(new Quaternion(0, 0, 0, 1), 0.5)
      .normalize()

    expect(mid!.rotation.angleTo(expected)).toBeLessThan(1e-5)
  })

  it('fov 跟着一起插值', () => {
    const wide = makeNode('w', 0, [0, 0, 0], 30)
    const tele = makeNode('t', 2, [0, 0, 10], 70)
    const segments = buildCameraSegments([wide, tele])

    expect(evaluateCameraPath([wide, tele], segments, 1)!.fov).toBeCloseTo(50)
  })

  it('单节点返回静止姿态，空路径返回 null', () => {
    expect(evaluateCameraPath([nodeA], [], 3)?.position.z).toBe(0)
    expect(evaluateCameraPath([], [], 3)).toBeNull()
  })
})

describe('拖动节点时间', () => {
  it('夹在相邻节点的 hold 边界之间', () => {
    const segments = buildCameraSegments([nodeA, nodeB, nodeC]).map((segment, index) => ({
      ...segment,
      holdAfter: index === 0 ? 1 : 0.5,
    }))

    // B 的可动范围：[A.time + hold + 最小段长, C.time - 自身 hold - 最小段长] = [1.1, 3.4]
    expect(clampNodeTime([nodeA, nodeB, nodeC], segments, 1, 0)).toBeCloseTo(1.1)
    expect(clampNodeTime([nodeA, nodeB, nodeC], segments, 1, 99)).toBeCloseTo(3.4)
    expect(clampNodeTime([nodeA, nodeB, nodeC], segments, 1, 2)).toBeCloseTo(2)
  })

  it('首节点不能小于 0，末节点没有上限', () => {
    const segments = buildCameraSegments([nodeA, nodeB])
    expect(clampNodeTime([nodeA, nodeB], segments, 0, -3)).toBe(0)
    expect(clampNodeTime([nodeA, nodeB], segments, 1, 1000)).toBe(1000)
  })
})

describe('节点起始时间', () => {
  it('逐段累计时长与停顿', () => {
    const segments = buildCameraSegments([nodeA, nodeB, nodeC]).map((segment, index) => ({
      ...segment,
      holdAfter: index === 0 ? 1 : 0,
    }))

    expect(getNodeStartTimes([nodeA, nodeB, nodeC], segments)).toEqual([0, 3, 5])
  })
})

describe('缓动曲线', () => {
  it('端点固定，中点符合各自的形状', () => {
    expect(applyEasing(0, 'ease-in-out')).toBe(0)
    expect(applyEasing(1, 'ease-in-out')).toBe(1)
    expect(applyEasing(0.5, 'linear')).toBeCloseTo(0.5)
    expect(applyEasing(0.5, 'ease-in')).toBeCloseTo(0.25)
    expect(applyEasing(0.5, 'ease-out')).toBeCloseTo(0.75)
    expect(applyEasing(0.5, 'ease-in-out')).toBeCloseTo(0.5)
  })
})

describe('路径的可视化采样', () => {
  it('直线段只给两端，贝塞尔段给采样点且首尾对齐节点', () => {
    const linear: CameraSegment = {
      id: 'a:b',
      fromNodeId: 'a',
      toNodeId: 'b',
      curveMode: 'linear',
      duration: 1,
      holdAfter: 0,
      easing: 'linear',
    }
    expect(getSegmentRenderPoints(nodeA, nodeB, linear)).toEqual([nodeA.position, nodeB.position])

    const bezier: CameraSegment = { ...linear, curveMode: 'bezier', handleOut: [0, 3, 3], handleIn: [0, 3, 7] }
    const points = getSegmentRenderPoints(nodeA, nodeB, bezier)

    expect(points).toHaveLength(32)
    expect(points[0]).toEqual(nodeA.position)
    expect(points[points.length - 1]).toEqual(nodeB.position)
  })
})

describe('默认控制柄与朝向', () => {
  it('默认控制柄落在直线的三等分点上', () => {
    const { handleOut, handleIn } = getDefaultBezierHandles([0, 0, 0], [0, 0, 9])

    expect(handleOut[2]).toBeCloseTo(3)
    expect(handleIn[2]).toBeCloseTo(6)
  })

  it('视点与注视点重合时给单位四元数', () => {
    expect(getLookAtQuaternion([1, 1, 1], [1, 1, 1]).equals(new Quaternion())).toBe(true)
  })

  it('垂直向下看时不会因为 up 共线而退化', () => {
    // forward 和默认 up (0,1,0) 共线，要换参考轴，否则矩阵求不出朝向
    const quaternion = getLookAtQuaternion([0, 5, 0], [0, 0, 0])
    expect(Number.isNaN(quaternion.x)).toBe(false)
    expect(quaternion.length()).toBeCloseTo(1)
  })
})
