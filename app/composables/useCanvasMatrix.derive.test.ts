import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import type { CanvasFlowNode } from '~/utils/canvas-group'
import { findMatrixPlatform, matrixEmptyGroups, matrixPlan, type MatrixSource } from '~/utils/canvas-matrix'
import { computeStaleMap, makeInputSnapshot, snapshotNodeInput } from '~/utils/canvas-upstream'
import { buildWorkflowGraph } from '~/utils/canvas-workflow'
import { useCanvasMatrix } from './useCanvasMatrix'

const api = vi.hoisted(() => ({
  savedIds: [] as string[],
  created: null as any,
}))

vi.mock('~/api/batch', () => ({
  batchApi: {
    latest: vi.fn(async () => ({ success: true, data: null })),
    create: vi.fn(async (_canvasId: number, body: { items: Array<{ node_id: string }> }) => {
      api.created = {
        id: 5,
        status: 'running',
        estimate_points: 20,
        succeeded: 0,
        failed: 0,
        items: body.items.map((item, i) => ({ node_id: item.node_id, layer: 'matrix', status: 'running', task_id: 900 + i, error: '' })),
      }
      return { success: true, data: api.created }
    }),
    action: vi.fn(async () => ({ success: true, data: { ...api.created, status: 'cancelled' } })),
  },
}))

vi.mock('~/api/canvas', () => ({
  default: {
    get: vi.fn(async () => ({ success: true, data: { graph: { nodes: api.savedIds.map(id => ({ id })) } } })),
  },
}))

/** 源图是别的节点生成出来的：自己带着当时的输入快照（上游是 text-1） */
const SOURCE_SNAPSHOT = makeInputSnapshot({ at: 1, model: 'qwen-image-2.0', prompt: '商品正面图', upstream: [{ id: 'text-1', data: { content: '脚本' } }] })

function sourceData() {
  return {
    kind: 'image',
    label: '商品图',
    prompt: '商品正面图',
    model: 'qwen-image-2.0',
    content: 'https://cdn.example.com/p.png',
    assetId: 42,
    taskId: 7,
    inputSnapshot: SOURCE_SNAPSHOT,
  }
}

function imageSource(): MatrixSource {
  return {
    id: 'image-1',
    kind: 'image',
    label: '商品图',
    prompt: '商品正面图',
    model: 'qwen-image-2.0',
    params: { quality: 'std' },
    data: sourceData(),
    assetId: 42,
    content: 'https://cdn.example.com/p.png',
  }
}

function makePlan() {
  return matrixPlan({
    source: imageSource(),
    platforms: [findMatrixPlatform('vertical-9x16')!, findMatrixPlatform('horizontal-16x9')!],
    langs: [],
    batchId: 'mx-1',
  })
}

/**
 * 假画布，照 vue-flow 的时序来：addNodes 立刻进 store（findNode 读得到），
 * 但 v-model 的 nodes 要到下一拍才回写——同一拍去 nodes 里找刚加的节点是找不到的。
 */
function makeCanvas() {
  const store: CanvasFlowNode[] = [
    { id: 'image-1', type: 'image', position: { x: 0, y: 0 }, data: sourceData() } as unknown as CanvasFlowNode,
  ]
  const nodes = ref<CanvasFlowNode[]>([...store])
  const edges = ref<Array<{ source: string, target: string }>>([])
  const sync = () => nextTick(() => {
    nodes.value = [...store]
  })
  const removed: string[][] = []
  let groups = 0
  const scope = effectScope()
  const matrix = scope.run(() => useCanvasMatrix({
    canvasId: () => 3,
    nodes,
    counts: { image: 1 } as any,
    addNodes: (list) => {
      store.push(...list)
      void sync()
    },
    addEdges: (edge: any) => {
      edges.value.push({ source: edge.source, target: edge.target })
    },
    defaultEdgeOptions: { type: 'default', animated: false },
    findNode: id => store.find(node => node.id === id),
    updateNodeData: (id, patch) => {
      const node = store.find(item => item.id === id)
      if (node)
        Object.assign(node.data as object, patch)
    },
    removeNodes: (ids) => {
      removed.push(ids)
      for (const id of ids) {
        const at = store.findIndex(node => node.id === id)
        if (at >= 0)
          store.splice(at, 1)
      }
      void sync()
    },
    groupNodeList: (ids) => {
      groups += 1
      const id = `group-${groups}`
      store.push({ id, type: 'group', position: { x: 0, y: 0 }, data: { kind: 'group', label: '组' } } as unknown as CanvasFlowNode)
      void nextTick(() => {
        for (const node of store) {
          if (ids.includes(node.id))
            node.parentNode = id
        }
        nodes.value = [...store]
      })
      return id
    },
    pollTask: () => {},
    saveCanvas: async () => {
      api.savedIds = store.map(node => node.id)
    },
    pushHistory: () => {},
    notify: () => {},
    t: key => key,
    track: () => {},
    refreshWallet: () => {},
    snapshotOf: id => snapshotNodeInput(id, store, edges.value),
  }))!
  return { matrix, store, nodes, edges, removed, stop: () => scope.stop() }
}

describe('一稿多版：派生 → 出片 → 回滚', () => {
  it('派生节点不带源节点的输入快照（配方不是成品）', () => {
    for (const version of makePlan().versions)
      expect(version.data.inputSnapshot).toBeUndefined()
  })

  it('批次任务挂回节点时盖的是派生节点自己的快照；出片后不判过期，真改了上游才判', async () => {
    const { matrix, store, edges, stop } = makeCanvas()
    await matrix.derive(makePlan(), 20)
    await nextTick()
    const derived = matrix.run.value!.nodeIds
    expect(derived).toHaveLength(2)
    for (const id of derived) {
      const data = store.find(node => node.id === id)!.data as any
      expect(data.taskId).toBeGreaterThan(0)
      expect(data.inputSnapshot.prompt).toBe(data.prompt)
      expect(data.inputSnapshot.upstream.map((item: { id: string }) => item.id)).toEqual(['image-1'])
      expect(data.inputSnapshot).not.toEqual(SOURCE_SNAPSHOT)
      // 任务轮询把结果写回节点
      Object.assign(data, { taskStatus: 'succeeded', content: `https://cdn.example.com/${id}.png`, assetId: 100 })
    }
    expect(Object.keys(computeStaleMap(store, edges.value)).filter(id => derived.includes(id))).toEqual([])

    // 真的改了上游：源图重新生成了一张
    Object.assign(store[0]!.data as object, { content: 'https://cdn.example.com/p2.png', assetId: 43, taskId: 8 })
    const stale = computeStaleMap(store, edges.value)
    expect(derived.map(id => stale[id])).toEqual(['upstream', 'upstream'])
    // 改了派生节点自己的提示词同样判过期
    ;(store.find(node => node.id === derived[0])!.data as any).prompt = '换一句'
    expect(computeStaleMap(store, edges.value)[derived[0]!]).toBe('input')
    stop()
  })

  it('没盖快照的老数据：带着源节点快照的派生节点一出片就会被判过期（回归对照）', () => {
    const inherited = { ...sourceData(), content: 'https://cdn.example.com/v.png', taskId: 901 }
    const stale = computeStaleMap(
      [{ id: 'image-1', data: sourceData() }, { id: 'image-2', data: inherited }],
      [{ source: 'image-1', target: 'image-2' }],
    )
    expect(stale['image-2']).toBe('upstream')
  })

  it('打组的组 id 当拍就记住；回滚时连空组一起收', async () => {
    const { matrix, store, removed, stop } = makeCanvas()
    await matrix.derive(makePlan(), 20)
    await nextTick()
    expect(matrix.run.value!.groupId).toBe('group-1')
    const derived = [...matrix.run.value!.nodeIds]
    await matrix.rollback()
    expect(removed.at(-1)).toEqual([...derived, 'group-1'])
    expect(store.map(node => node.id)).toEqual(['image-1'])
    expect(matrix.run.value).toBeNull()
    stop()
  })

  it('用户往组里放了别的节点：只收派生节点，组留着', async () => {
    const { matrix, store, nodes, removed, stop } = makeCanvas()
    await matrix.derive(makePlan(), 20)
    await nextTick()
    store.push({ id: 'text-9', type: 'text', position: { x: 0, y: 0 }, parentNode: 'group-1', data: { kind: 'text', label: '备注' } } as unknown as CanvasFlowNode)
    nodes.value = [...store]
    const derived = [...matrix.run.value!.nodeIds]
    await matrix.rollback()
    expect(removed.at(-1)).toEqual(derived)
    expect(store.map(node => node.id)).toEqual(['image-1', 'group-1', 'text-9'])
    stop()
  })
})

describe('matrixEmptyGroups', () => {
  const nodes = [
    { id: 'group-1', data: { kind: 'group' } },
    { id: 'image-2', parentNode: 'group-1', data: { kind: 'image' } },
    { id: 'image-3', parentNode: 'group-1', data: { kind: 'image' } },
    { id: 'image-4', data: { kind: 'image' } },
  ]

  it('刷新后没记住组 id：按派生节点的父组认', () => {
    expect(matrixEmptyGroups(nodes, ['image-2', 'image-3'], '')).toEqual(['group-1'])
  })

  it('组里还剩别的节点 / 组已不在 / 记的 id 不是组：都不收', () => {
    expect(matrixEmptyGroups(nodes, ['image-2'], 'group-1')).toEqual([])
    expect(matrixEmptyGroups(nodes, ['image-2', 'image-3'], 'group-x')).toEqual([])
    expect(matrixEmptyGroups(nodes, ['image-4'], 'image-4')).toEqual([])
    expect(matrixEmptyGroups(nodes, ['image-4'], '')).toEqual([])
  })
})

describe('存为工作流', () => {
  it('下游节点的输入快照随产物一起清掉，不把旧画布的节点 id 带进模板', () => {
    const graph = buildWorkflowGraph(
      [
        { id: 'text-1', kind: 'text', x: 0, y: 0, data: { kind: 'text', content: '脚本' } },
        { id: 'image-1', kind: 'image', x: 300, y: 0, data: sourceData() },
      ],
      [{ source: 'text-1', target: 'image-1' }],
    )
    const image = graph.nodes.find(node => node.kind === 'image')!
    expect(image.data.inputSnapshot).toBeUndefined()
    expect(image.data.content).toBeUndefined()
    expect(image.data.prompt).toBe('商品正面图')
  })
})
