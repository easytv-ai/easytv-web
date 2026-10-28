import { describe, expect, it } from 'vitest'
import { buildCameraSegments } from '../camera-path'
import type { CameraNode, DirectorCameraShot } from '../schema'
import { planPreviewFrames, PREVIEW_INTERVAL_SECONDS, PREVIEW_MAX_FRAMES_PER_SHOT, previewSamplingFromMode, previewShotRanges } from './preview-frames'

function node(id: string, time: number): CameraNode {
  return { id, time, position: [0, 0, time], rotation: [0, 0, 0, 1], fov: 50 }
}

function camera(nodes: CameraNode[], holdAfter = 0): Pick<DirectorCameraShot, 'nodes' | 'segments'> {
  const segments = buildCameraSegments(nodes).map(segment => ({ ...segment, holdAfter }))
  return { nodes, segments }
}

describe('预演帧规划', () => {
  it('没有运镜节点时不排帧', () => {
    expect(planPreviewFrames({ nodes: [] })).toEqual([])
  })

  it('只有一个节点时只排一帧，起止是同一时刻', () => {
    const frames = planPreviewFrames(camera([node('a', 1.2)]))
    expect(frames).toEqual([{ time: 1.2, shotIndex: 0, label: '镜子1-1.20s.png' }])
  })

  it('每段运动一镜，首尾帧取起点和走到终点的时刻', () => {
    const frames = planPreviewFrames(camera([node('a', 0), node('b', 2), node('c', 5)]))
    expect(frames.map(frame => `${frame.shotIndex}@${frame.time}`)).toEqual(['0@0', '0@2', '1@2', '1@5'])
    expect(frames.map(frame => frame.label)).toEqual([
      '镜子1-0.00s.png',
      '镜子1-2.00s.png',
      '镜子2-2.00s.png',
      '镜子2-5.00s.png',
    ])
  })

  it('末帧不含 hold：停住的时间算进下一镜的起点', () => {
    const shot = camera([node('a', 0), node('b', 2)], 1)
    expect(previewShotRanges(shot)).toEqual([{ start: 0, end: 2 }])
    expect(planPreviewFrames(shot).map(frame => frame.time)).toEqual([0, 2])
  })

  it('没写运动段时按节点时间现推', () => {
    const frames = planPreviewFrames({ nodes: [node('a', 0), node('b', 3)] })
    expect(frames.map(frame => frame.time)).toEqual([0, 3])
  })

  it('间隔采样保留首尾，超过 6 帧就抽成 6 帧', () => {
    const shot = camera([node('a', 0), node('b', 2)])
    const loose = planPreviewFrames(shot, { mode: 'interval', seconds: 0.5 })
    expect(loose.map(frame => frame.time)).toEqual([0, 0.5, 1, 1.5, 2])

    const dense = planPreviewFrames(shot, { mode: 'interval', seconds: 0.1 })
    expect(dense.length).toBe(PREVIEW_MAX_FRAMES_PER_SHOT)
    expect(dense[0]!.time).toBe(0)
    expect(dense[dense.length - 1]!.time).toBe(2)
    expect(dense.map(frame => frame.time)).toEqual([0, 0.4, 0.8, 1.2, 1.6, 2])
  })

  it('时间轴两档：首尾帧，或固定 0.25 秒一帧', () => {
    expect(previewSamplingFromMode('shot-ends')).toEqual({ mode: 'shot-ends' })
    expect(previewSamplingFromMode('interval')).toEqual({ mode: 'interval', seconds: PREVIEW_INTERVAL_SECONDS })
    expect(previewSamplingFromMode('其他')).toEqual({ mode: 'shot-ends' })
  })

  it('秒数不是正数时退回首尾帧', () => {
    const shot = camera([node('a', 0), node('b', 2)])
    expect(planPreviewFrames(shot, { mode: 'interval', seconds: 0 }).map(frame => frame.time)).toEqual([0, 2])
  })

  it('传入镜头范围就按这个顺序排，不再按运动段切', () => {
    const frames = planPreviewFrames(
      camera([node('a', 0), node('b', 4)]),
      { mode: 'shot-ends' },
      [{ start: 1, end: 1.5 }, { start: 3, end: 4 }],
    )
    expect(frames).toEqual([
      { time: 1, shotIndex: 0, label: '镜子1-1.00s.png' },
      { time: 1.5, shotIndex: 0, label: '镜子1-1.50s.png' },
      { time: 3, shotIndex: 1, label: '镜子2-3.00s.png' },
      { time: 4, shotIndex: 1, label: '镜子2-4.00s.png' },
    ])
  })
})
