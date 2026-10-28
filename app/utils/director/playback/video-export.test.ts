import { describe, expect, it } from 'vitest'
import {
  checkExportable,
  getExportExtension,
  getExportFileName,
  pickRecorderMimeType,
} from './video-export'
import type { CameraNode, DirectorCameraShot } from '../schema'

function makeNode(id: string, time: number): CameraNode {
  return { id, position: [0, 1, time], rotation: [0, 0, 0, 1], fov: 50, time }
}

function makeCamera(nodes: CameraNode[]): DirectorCameraShot {
  return {
    id: 'cam_1',
    name: '机位01',
    fov: 50,
    transform: { position: [0, 1, 5], rotation: [0, 0, 0], scale: [1, 1, 1] },
    targetMode: 'manual',
    target: [0, 1, 0],
    nodes,
  }
}

describe('pickRecorderMimeType', () => {
  it('优先挑排在前面的（画质更好的编码）', () => {
    expect(pickRecorderMimeType(() => true)).toBe('video/webm;codecs=vp9')
  })

  it('只支持后面的就退到后面', () => {
    expect(pickRecorderMimeType(type => type === 'video/mp4')).toBe('video/mp4')
  })

  it('全都不支持时给 undefined，交给 MediaRecorder 自己选', () => {
    expect(pickRecorderMimeType(() => false)).toBeUndefined()
  })
})

describe('getExportExtension', () => {
  it('按容器给扩展名', () => {
    expect(getExportExtension('video/webm;codecs=vp9')).toBe('webm')
    expect(getExportExtension('video/mp4')).toBe('mp4')
  })

  it('没挑到容器时按 webm 算', () => {
    expect(getExportExtension(undefined)).toBe('webm')
  })
})

describe('getExportFileName', () => {
  it('带上机位名', () => {
    expect(getExportFileName('机位01', 'webm')).toBe('机位01-运镜.webm')
  })

  it('把会被当成路径分隔的字符换掉', () => {
    expect(getExportFileName('A/B:C', 'webm')).toBe('A_B_C-运镜.webm')
  })

  it('机位没名字时有个兜底，不会出现以横杠开头的文件名', () => {
    expect(getExportFileName('', 'mp4')).toBe('机位-运镜.mp4')
  })
})

describe('checkExportable', () => {
  it('没有机位', () => {
    expect(checkExportable(null).ok).toBe(false)
  })

  it('只有一个节点时没有运动段，导不出', () => {
    expect(checkExportable(makeCamera([makeNode('a', 0)])).ok).toBe(false)
  })

  it('两个节点就能导，并带回总时长', () => {
    const result = checkExportable(makeCamera([makeNode('a', 0), makeNode('b', 1)]))
    expect(result.ok).toBe(true)
    expect(result.duration).toBeGreaterThan(0)
  })

  it('总时长过短时挡住 —— 录出来只有几帧没有参考价值', () => {
    const camera = makeCamera([makeNode('a', 0), makeNode('b', 0.05)])
    camera.segments = [{
      id: 'a:b',
      fromNodeId: 'a',
      toNodeId: 'b',
      duration: 0.05,
      holdAfter: 0,
      easing: 'linear',
      curveMode: 'linear',
    }]
    expect(checkExportable(camera).ok).toBe(false)
  })
})
