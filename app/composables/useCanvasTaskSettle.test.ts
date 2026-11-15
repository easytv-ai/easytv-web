import { describe, expect, it } from 'vitest'
import { effectScope, nextTick, reactive } from 'vue'
import { useCanvasTaskSettle, type TaskSettleResult } from './useCanvasTaskSettle'
import type { NodeTaskView } from '~/utils/canvas-chat-media-report'

function setup() {
  const nodes = reactive<Record<string, NodeTaskView>>({})
  const scope = effectScope()
  const settle = scope.run(() => useCanvasTaskSettle(id => nodes[id] ?? null))!
  return { nodes, scope, settle }
}

describe('S-3 useCanvasTaskSettle：盯到后端终态才回调', () => {
  it('任务一直 running 时不回调；轮询把状态写成 succeeded 后回调一次', async () => {
    const { nodes, settle } = setup()
    nodes.v1 = { taskId: 42, status: 'running', url: '' }
    const results: TaskSettleResult[] = []
    settle.track('v1', 42, r => results.push(r))
    await nextTick()
    expect(results).toEqual([])

    nodes.v1.status = 'pending'
    await nextTick()
    expect(results).toEqual([])

    nodes.v1.url = 'https://x/a.mp4'
    nodes.v1.status = 'succeeded'
    await nextTick()
    expect(results).toEqual([{ state: 'settled', view: { taskId: 42, status: 'succeeded', url: 'https://x/a.mp4' } }])

    // 结束后节点再变（用户又点了一次生成）不会重复回调
    nodes.v1.status = 'running'
    await nextTick()
    expect(results).toHaveLength(1)
  })

  it('失败也是终态', async () => {
    const { nodes, settle } = setup()
    nodes.v1 = { taskId: 42, status: 'running' }
    const results: TaskSettleResult[] = []
    settle.track('v1', 42, r => results.push(r))
    nodes.v1.status = 'failed'
    nodes.v1.error = '上游超时'
    await nextTick()
    expect(results).toEqual([{ state: 'settled', view: { taskId: 42, status: 'failed', error: '上游超时' } }])
  })

  it('开始盯的时候已经是终态：立刻回调', () => {
    const { nodes, settle } = setup()
    nodes.v1 = { taskId: 42, status: 'cancelled' }
    const results: TaskSettleResult[] = []
    settle.track('v1', 42, r => results.push(r))
    expect(results.map(r => r.state)).toEqual(['settled'])
  })

  it('节点被删或换了任务：回 lost', async () => {
    const { nodes, settle } = setup()
    nodes.v1 = { taskId: 42, status: 'running' }
    nodes.v2 = { taskId: 50, status: 'running' }
    const results: string[] = []
    settle.track('v1', 42, r => results.push(`v1:${r.state}`))
    settle.track('v2', 50, r => results.push(`v2:${r.state}`))
    delete nodes.v1
    nodes.v2.taskId = 51
    await nextTick()
    expect(results.sort()).toEqual(['v1:lost', 'v2:lost'])
  })

  it('画布晚于对话栏载入：节点出现前一直等，出现后照常跟踪', async () => {
    const { nodes, settle } = setup()
    const results: TaskSettleResult[] = []
    settle.track('v1', 42, r => results.push(r))
    await nextTick()
    expect(results).toEqual([])
    nodes.v1 = { taskId: 42, status: 'running' }
    await nextTick()
    expect(results).toEqual([])
    nodes.v1.status = 'succeeded'
    await nextTick()
    expect(results.map(r => r.state)).toEqual(['settled'])
  })

  it('画布卸载后不再回调', async () => {
    const { nodes, scope, settle } = setup()
    nodes.v1 = { taskId: 42, status: 'running' }
    const results: TaskSettleResult[] = []
    settle.track('v1', 42, r => results.push(r))
    scope.stop()
    nodes.v1.status = 'succeeded'
    await nextTick()
    expect(results).toEqual([])
  })
})
