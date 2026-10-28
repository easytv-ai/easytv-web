import { describe, expect, it } from 'vitest'
import {
  abortableSleep,
  busyBackoffMs,
  changedTaskResult,
  mergeTaskResults,
  pickTaskResult,
  snapshotTaskResults,
  TASK_RESULT_FIELDS,
} from './create-layers-sync'
import type { CanvasGraph } from '~/types/creative'

function node(id: string, data: Record<string, unknown>) {
  return { id, type: 'easytv', position: { x: 0, y: 0 }, data }
}

describe('pickTaskResult', () => {
  it('只挑任务结果字段', () => {
    const data = { kind: 'image', prompt: 'p', label: 'L', refAssetId: 9, taskId: 1, taskStatus: 'succeeded', taskProgress: 100, taskError: '', content: 'u', assetId: 3 }
    expect(pickTaskResult(data)).toEqual({ taskId: 1, taskStatus: 'succeeded', taskProgress: 100, taskError: '', content: 'u', assetId: 3 })
    expect(Object.keys(pickTaskResult(data)).sort()).toEqual([...TASK_RESULT_FIELDS].sort())
  })
})

describe('changedTaskResult', () => {
  it('没有基线时本地结果字段全算改过', () => {
    expect(changedTaskResult({ prompt: 'x', taskId: 1 }, undefined)).toEqual({ taskId: 1 })
  })

  it('有基线时只返回变了的字段', () => {
    const base = { taskId: 1, taskStatus: 'pending', taskProgress: 0 }
    const local = { taskId: 1, taskStatus: 'succeeded', taskProgress: 100, content: 'u', prompt: 'x' }
    expect(changedTaskResult(local, base)).toEqual({ taskStatus: 'succeeded', taskProgress: 100, content: 'u' })
  })
})

describe('mergeTaskResults', () => {
  it('不覆盖另一页刚改的 prompt / label / 引用，只合入本地任务结果', () => {
    const base: CanvasGraph = { nodes: [node('image-1', { kind: 'image', prompt: 'old', label: '镜头1' })], edges: [] }
    const remote: CanvasGraph = { nodes: [node('image-1', { kind: 'image', prompt: 'new prompt', label: '改过的名字', refAssetId: 77 })], edges: [] }
    const local: CanvasGraph = { nodes: [node('image-1', { kind: 'image', prompt: 'old', label: '镜头1', taskId: 5, taskStatus: 'succeeded', taskProgress: 100, taskError: '', content: 'https://x/a.png', assetId: 12 })], edges: [] }

    const merged = mergeTaskResults(remote, local, snapshotTaskResults(base))
    expect(merged.nodes[0].data).toEqual({
      kind: 'image',
      prompt: 'new prompt',
      label: '改过的名字',
      refAssetId: 77,
      taskId: 5,
      taskStatus: 'succeeded',
      taskProgress: 100,
      taskError: '',
      content: 'https://x/a.png',
      assetId: 12,
    })
  })

  it('本地基线后没动过的结果字段以服务端为准（别处重跑过）', () => {
    const baseGraph: CanvasGraph = { nodes: [node('video-1', { taskId: 1, taskStatus: 'succeeded', content: 'a' })], edges: [] }
    const remote: CanvasGraph = { nodes: [node('video-1', { taskId: 2, taskStatus: 'running', content: 'a' })], edges: [] }
    const local: CanvasGraph = { nodes: [node('video-1', { taskId: 1, taskStatus: 'succeeded', content: 'a' })], edges: [] }
    const merged = mergeTaskResults(remote, local, snapshotTaskResults(baseGraph))
    expect(merged.nodes[0].data).toEqual({ taskId: 2, taskStatus: 'running', content: 'a' })
  })

  it('服务端新增的节点和连线保留', () => {
    const remote: CanvasGraph = { nodes: [node('a', {}), node('b', {})], edges: [{ id: 'e1', source: 'a', target: 'b' }] }
    const local: CanvasGraph = { nodes: [node('a', { taskId: 1 })], edges: [] }
    const merged = mergeTaskResults(remote, local, snapshotTaskResults({ nodes: [node('a', {})], edges: [] }))
    expect(merged.nodes.map((n: { id: string }) => n.id)).toEqual(['a', 'b'])
    expect(merged.edges).toEqual([{ id: 'e1', source: 'a', target: 'b' }])
    expect(merged.nodes[0].data).toEqual({ taskId: 1 })
  })

  it('本地有、服务端没有且本地产出了新结果的节点不丢，连线一起带回', () => {
    const baseGraph: CanvasGraph = { nodes: [node('img', {}), node('vid', {})], edges: [{ id: 'e1', source: 'img', target: 'vid' }] }
    const remote: CanvasGraph = { nodes: [node('img', { prompt: 'changed' })], edges: [] }
    const local: CanvasGraph = {
      nodes: [node('img', {}), node('vid', { taskId: 9, taskStatus: 'running' })],
      edges: [{ id: 'e1', source: 'img', target: 'vid' }],
    }
    const merged = mergeTaskResults(remote, local, snapshotTaskResults(baseGraph))
    expect(merged.nodes.map((n: { id: string }) => n.id)).toEqual(['img', 'vid'])
    expect(merged.nodes[0].data).toEqual({ prompt: 'changed' })
    expect(merged.edges).toEqual([{ id: 'e1', source: 'img', target: 'vid' }])
  })

  it('本地没产出新结果、服务端已删掉的节点不复活', () => {
    const baseGraph: CanvasGraph = { nodes: [node('a', {}), node('gone', { taskId: 1 })], edges: [] }
    const remote: CanvasGraph = { nodes: [node('a', {})], edges: [] }
    const local: CanvasGraph = { nodes: [node('a', {}), node('gone', { taskId: 1 })], edges: [] }
    const merged = mergeTaskResults(remote, local, snapshotTaskResults(baseGraph))
    expect(merged.nodes.map((n: { id: string }) => n.id)).toEqual(['a'])
  })

  it('没有基线时本地独有节点保留', () => {
    const merged = mergeTaskResults({ nodes: [], edges: [] }, { nodes: [node('x', { prompt: 'p' })], edges: [] })
    expect(merged.nodes.map((n: { id: string }) => n.id)).toEqual(['x'])
  })

  it('不改动入参', () => {
    const remote: CanvasGraph = { nodes: [node('a', { prompt: 'r' })], edges: [] }
    const local: CanvasGraph = { nodes: [node('a', { taskId: 1 })], edges: [] }
    mergeTaskResults(remote, local)
    expect(remote.nodes[0].data).toEqual({ prompt: 'r' })
  })
})

describe('busyBackoffMs', () => {
  it('3s 起指数退避，上限 20s', () => {
    expect([0, 1, 2, 3, 4, 10].map(n => busyBackoffMs(n))).toEqual([3000, 6000, 12000, 20000, 20000, 20000])
    expect(busyBackoffMs(-1)).toBe(3000)
    expect(busyBackoffMs(Number.NaN)).toBe(3000)
  })

  it('10 分钟上限内的重试次数有限', () => {
    let waited = 0
    let tries = 0
    while (waited < 10 * 60 * 1000) {
      waited += busyBackoffMs(tries)
      tries += 1
    }
    expect(tries).toBeLessThan(40)
  })
})

describe('abortableSleep', () => {
  it('正常到时返回 true', async () => {
    await expect(abortableSleep(1)).resolves.toBe(true)
  })

  it('中止后立即返回 false', async () => {
    const ctrl = new AbortController()
    const pending = abortableSleep(10_000, ctrl.signal)
    ctrl.abort()
    await expect(pending).resolves.toBe(false)
  })

  it('已中止的 signal 直接返回 false', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(abortableSleep(10_000, ctrl.signal)).resolves.toBe(false)
  })
})
