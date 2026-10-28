import { describe, expect, it } from 'vitest'
import {
  computeStaleMap,
  hashSignature,
  inputSnapshotOf,
  makeInputSnapshot,
  outputSignature,
  staleReason,
} from './canvas-upstream'

const imageNode = (overrides: Record<string, any> = {}) => ({
  id: 'i1',
  data: { kind: 'image', model: 'qwen-image-2.0', prompt: '一只橘猫', content: 'https://cdn/a.png', assetId: 7, taskId: 91, ...overrides },
})

describe('outputSignature', () => {
  it('没有产物给空串', () => {
    expect(outputSignature({ kind: 'image' })).toBe('')
    expect(outputSignature(null)).toBe('')
  })

  it('内容或素材变了就换签名，仅样式/标签变化不换', () => {
    const base = outputSignature(imageNode().data)
    expect(base).not.toBe('')
    expect(outputSignature(imageNode({ label: '改个名' }).data)).toBe(base)
    expect(outputSignature(imageNode({ position: { x: 9 } }).data)).toBe(base)
    expect(outputSignature(imageNode({ content: 'https://cdn/b.png' }).data)).not.toBe(base)
    expect(outputSignature(imageNode({ assetId: 8 }).data)).not.toBe(base)
  })

  it('hashSignature 稳定且区分不同文本', () => {
    expect(hashSignature('abc')).toBe(hashSignature('abc'))
    expect(hashSignature('abc')).not.toBe(hashSignature('abd'))
  })
})

describe('输入快照', () => {
  it('拍下模型 / 提示词 / 上游签名，并能读回来', () => {
    const snap = makeInputSnapshot({
      model: 'Kling-2.5',
      prompt: '风把衣角吹起',
      upstream: [{ id: 'i1', data: imageNode().data }],
      at: 1791000000,
    })
    expect(snap.upstream).toHaveLength(1)
    expect(snap.upstream[0]!.sig).toBe(outputSignature(imageNode().data))
    const back = inputSnapshotOf({ inputSnapshot: snap })
    expect(back?.model).toBe('Kling-2.5')
    expect(back?.prompt).toBe('风把衣角吹起')
  })

  it('形状不对就当没有快照', () => {
    expect(inputSnapshotOf({ inputSnapshot: { model: 1 } })).toBeNull()
    expect(inputSnapshotOf({ inputSnapshot: 'x' })).toBeNull()
    expect(inputSnapshotOf({})).toBeNull()
    expect(inputSnapshotOf(null)).toBeNull()
  })
})

describe('staleReason', () => {
  /** 快照记的是"当时的上游"（snapUpstream），当前上游（upstream）是另一回事，两者不同才算过期 */
  const withSnap = (
    data: Record<string, any>,
    upstream: Array<{ id: string, data?: any }> = [],
    snapUpstream: Array<{ id: string, data?: any }> = upstream,
  ) => ({
    id: 'v1',
    data: {
      kind: 'video',
      model: 'Kling-2.5',
      prompt: '风把衣角吹起',
      content: 'https://cdn/v.mp4',
      inputSnapshot: makeInputSnapshot({ model: 'Kling-2.5', prompt: '风把衣角吹起', upstream: snapUpstream }),
      ...data,
    },
    upstream,
  })

  it('没有产物 / 没有快照 / 文本节点都不标', () => {
    expect(staleReason({ id: 'v1', data: { kind: 'video', content: '', inputSnapshot: makeInputSnapshot({ upstream: [] }) }, upstream: [] })).toBeNull()
    expect(staleReason({ id: 'v1', data: { kind: 'video', content: 'https://cdn/v.mp4' }, upstream: [] })).toBeNull()
    expect(staleReason({ id: 't1', data: { kind: 'text', content: '改了文案', inputSnapshot: makeInputSnapshot({ prompt: '原文', upstream: [] }) }, upstream: [] })).toBeNull()
  })

  it('提示词或模型改了就标 input', () => {
    expect(staleReason(withSnap({ prompt: '换个动作' }))).toBe('input')
    expect(staleReason(withSnap({ model: 'Kling-3.0' }))).toBe('input')
  })

  it('上游产物变了、或连线增删了，标 upstream', () => {
    const upstream = [{ id: 'i1', data: imageNode().data }]
    expect(staleReason(withSnap({}, upstream))).toBeNull()
    // 上游重新生成（内容变了）
    const regenerated = [{ id: 'i1', data: imageNode({ content: 'https://cdn/a2.png' }).data }]
    expect(staleReason(withSnap({}, regenerated, upstream))).toBe('upstream')
    // 上游被撤掉了
    expect(staleReason(withSnap({}, [], upstream))).toBe('upstream')
    // 多接了一个上游
    const two = [...upstream, { id: 'i2', data: imageNode({ id: 'i2' }).data }]
    expect(staleReason(withSnap({}, two, upstream))).toBe('upstream')
  })
})

describe('computeStaleMap', () => {
  it('只把过期的节点挑出来', () => {
    const upstream = { id: 'i1', data: imageNode().data }
    const nodes = [
      upstream,
      {
        id: 'v1',
        data: {
          kind: 'video',
          model: 'Kling-2.5',
          prompt: '风把衣角吹起',
          content: 'https://cdn/v.mp4',
          inputSnapshot: makeInputSnapshot({ model: 'Kling-2.5', prompt: '风把衣角吹起', upstream: [upstream] }),
        },
      },
      {
        id: 'v2',
        data: {
          kind: 'video',
          model: 'Kling-2.5',
          prompt: '另一段',
          content: 'https://cdn/v2.mp4',
          inputSnapshot: makeInputSnapshot({ model: 'Kling-2.5', prompt: '旧的提示词', upstream: [] }),
        },
      },
    ]
    const map = computeStaleMap(nodes, [{ source: 'i1', target: 'v1' }])
    expect(map).toEqual({ v2: 'input' })
  })
})
