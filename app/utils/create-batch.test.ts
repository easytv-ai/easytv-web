import { describe, expect, it } from 'vitest'
import { batchActive, batchNodePatches, waitingNodeIds } from './create-batch'
import type { GenerationBatch, GenerationBatchItem } from '~/types/creative'

function item(node_id: string, patch: Partial<GenerationBatchItem> = {}): GenerationBatchItem {
  return { id: 1, batch_id: 1, node_id, layer: '', type: 'image', model: 'm', status: 'waiting', estimate: 2, task_id: 0, asset_id: 0, attempts: 0, error: '', seq: 0, ...patch }
}

describe('create-batch', () => {
  it('提交出的新任务挂到节点上，已挂上的不重复改', () => {
    const tasks: Record<string, number> = { 'image-1': 100, 'image-2': 7 }
    const patches = batchNodePatches([
      item('image-1', { status: 'submitted', task_id: 100 }),
      item('image-2', { status: 'submitted', task_id: 101 }),
      item('video-1', { status: 'skipped', error: '上游节点 image-2 没有生成成功' }),
      item('audio-1', { status: 'waiting' }),
    ], id => tasks[id] ?? 0)
    expect(patches).toEqual([
      { nodeId: 'image-2', patch: { taskId: 101, taskStatus: 'pending', taskProgress: 0, taskError: '' } },
      { nodeId: 'video-1', patch: { taskStatus: 'failed', taskError: '上游节点 image-2 没有生成成功' } },
    ])
  })

  it('waitingNodeIds 只看进行中 / 暂停的批次', () => {
    const batch = { status: 'paused', items: [item('a'), item('b', { status: 'submitted' })] } as GenerationBatch
    expect([...waitingNodeIds(batch)]).toEqual(['a'])
    expect(waitingNodeIds({ ...batch, status: 'done' }).size).toBe(0)
    expect(batchActive(null)).toBe(false)
  })
})
