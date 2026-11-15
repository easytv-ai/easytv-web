import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import type { AssistChange } from './canvas-assist'
import { assistChangeNodeIds, splitAssistChangesByLock } from './canvas-assist-lock'
import type { CanvasFlowNode } from './canvas-group'
import { useCanvasConnect } from '~/composables/useCanvasConnect'

function node(id: string, kind: string, extra: Record<string, unknown> = {}, parentNode?: string): CanvasFlowNode {
  return { id, type: kind, position: { x: 0, y: 0 }, parentNode, data: { kind, label: id, content: '', prompt: '', ...extra } } as unknown as CanvasFlowNode
}

const NODES: CanvasFlowNode[] = [
  node('text-1', 'text', { content: '上游文本' }),
  node('image-1', 'image', { locked: true, prompt: '锁定的提示词' }),
  node('image-2', 'image'),
  node('group-1', 'group', { locked: true }),
  node('video-1', 'video', {}, 'group-1'),
]

describe('助手方案遇到锁定节点', () => {
  it('每类改动碰到哪些既有节点', () => {
    expect(assistChangeNodeIds({ action: 'connect', source: 'a', target: 'b' })).toEqual(['a', 'b'])
    expect(assistChangeNodeIds({ action: 'add_node', kind: 'image', from: 'a' })).toEqual(['a'])
    expect(assistChangeNodeIds({ action: 'add_node', kind: 'image' })).toEqual([])
    expect(assistChangeNodeIds({ action: 'update_prompt', node_id: 'a' })).toEqual(['a'])
    expect(assistChangeNodeIds({ action: 'regenerate', node_id: 'a' })).toEqual(['a'])
    expect(assistChangeNodeIds({ action: 'apply_graph' })).toEqual([])
  })

  it('改锁定节点的提示词 / 重新生成 / 连到锁定节点 / 从锁定节点长新节点都被跳过，其余照常', () => {
    const changes: AssistChange[] = [
      { action: 'update_prompt', node_id: 'image-1', prompt: '新的' },
      { action: 'update_prompt', node_id: 'image-2', prompt: '新的' },
      { action: 'regenerate', node_id: 'image-1', model: 'm' },
      { action: 'connect', source: 'text-1', target: 'image-1' },
      { action: 'connect', source: 'text-1', target: 'image-2' },
      { action: 'add_node', kind: 'video', from: 'image-1' },
      { action: 'add_node', kind: 'video', from: 'image-2' },
      { action: 'apply_graph' },
    ]
    const { open, locked } = splitAssistChangesByLock(changes, NODES)
    expect(locked).toEqual([changes[0], changes[2], changes[3], changes[5]])
    expect(open).toEqual([changes[1], changes[4], changes[6], changes[7]])
  })

  it('父组锁定时组内节点同样算锁定', () => {
    const { open, locked } = splitAssistChangesByLock([
      { action: 'update_prompt', node_id: 'video-1', prompt: 'x' },
      { action: 'connect', source: 'image-2', target: 'video-1' },
    ], NODES)
    expect(open).toEqual([])
    expect(locked).toHaveLength(2)
  })

  it('节点已不在画布上的改动不算锁定（留给应用时按「节点不在了」计）', () => {
    const { open, locked } = splitAssistChangesByLock([{ action: 'update_prompt', node_id: 'gone', prompt: 'x' }], NODES)
    expect(locked).toEqual([])
    expect(open).toHaveLength(1)
  })
})

describe('linkNodes 与锁定', () => {
  function makeStore() {
    const nodes = ref<CanvasFlowNode[]>([
      node('text-1', 'text', { content: '上游文本' }),
      node('image-1', 'image', { locked: true, prompt: '' }),
      node('image-2', 'image', { prompt: '' }),
    ])
    const edges = ref<Array<{ source: string, target: string }>>([])
    const connect = useCanvasConnect({
      nodes,
      edges,
      findNode: id => nodes.value.find(item => item.id === id),
      updateNodeData: (id, patch) => {
        const hit = nodes.value.find(item => item.id === id)
        if (hit?.data)
          Object.assign(hit.data as object, patch)
      },
      addEdges: (edge: any) => {
        edges.value.push({ source: edge.source, target: edge.target })
      },
      defaultEdgeOptions: { type: 'default', animated: false },
      pushHistory: () => {},
      nodePlainText: item => String((item.data as any).content || ''),
    })
    const promptOf = (id: string) => String((nodes.value.find(item => item.id === id)!.data as any).prompt)
    return { connect, edges, promptOf }
  }

  it('一端锁定：不连线，也不把上游文本写进锁定节点的提示词', async () => {
    const { connect, edges, promptOf } = makeStore()
    const result = connect.linkNodes({ source: 'text-1', target: 'image-1', sourceHandle: 'out', targetHandle: 'in' })
    await Promise.resolve()
    expect(result).toBeNull()
    expect(edges.value).toEqual([])
    expect(promptOf('image-1')).toBe('')
  })

  it('两端都没锁：照常连线并同步提示词', () => {
    const { connect, edges, promptOf } = makeStore()
    connect.linkNodes({ source: 'text-1', target: 'image-2', sourceHandle: 'out', targetHandle: 'in' })
    expect(edges.value).toEqual([{ source: 'text-1', target: 'image-2' }])
    expect(promptOf('image-2')).toBe('上游文本')
  })

  it('allowLocked（对话落图 / 跟练搭图）跳过锁定检查', () => {
    const { connect, edges } = makeStore()
    connect.linkNodes({ source: 'text-1', target: 'image-1', sourceHandle: 'out', targetHandle: 'in' }, { force: false, allowLocked: true })
    expect(edges.value).toEqual([{ source: 'text-1', target: 'image-1' }])
  })
})
