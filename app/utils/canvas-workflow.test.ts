import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import { useCanvasHistory } from '../composables/useCanvasHistory'
import type { CanvasFlowNode } from './canvas-group'
import {
  applyWorkflowGraph,
  buildWorkflowGraph,
  clearDownstreamResults,
  defaultWorkflowName,
  isUsableWorkflowGraph,
  placeWorkflowGraph,
  WORKFLOW_GRAPH_VERSION,
  workflowCover,
  workflowNodesToFlow,
  type CanvasWorkflowGraph,
  type WorkflowNode,
} from './canvas-workflow'

const items = [
  { id: 'image-1', kind: 'image', x: 200, y: 120, width: 320, height: 200, data: { label: '参考图', content: 'https://cdn/a.png', assetId: 7 } },
  { id: 'video-1', kind: 'video', x: 600, y: 160, data: { label: '成片', content: 'https://cdn/b.mp4', assetId: 9, taskId: 31, prompt: '动起来' } },
]
const edges = [
  { source: 'image-1', target: 'video-1' },
  { source: 'text-9', target: 'video-1' },
]

describe('buildWorkflowGraph', () => {
  it('坐标归零，只留组内连线', () => {
    const graph = buildWorkflowGraph(items, edges)
    expect(graph.version).toBe(WORKFLOW_GRAPH_VERSION)
    expect(graph.nodes.map(node => [node.x, node.y])).toEqual([[0, 0], [400, 40]])
    expect(graph.edges).toEqual([{ source: 'image-1', target: 'video-1', sourceHandle: 'out', targetHandle: 'in' }])
  })

  it('源头节点留素材，下游节点清产物但留提示词', () => {
    const graph = buildWorkflowGraph(items, edges)
    expect(graph.nodes[0]!.data).toMatchObject({ content: 'https://cdn/a.png', assetId: 7 })
    expect(graph.nodes[1]!.data).toEqual({ label: '成片', prompt: '动起来' })
  })
})

describe('clearDownstreamResults', () => {
  it('没有上游的节点原样不动', () => {
    const nodes: WorkflowNode[] = [{ id: 'a', kind: 'image', x: 0, y: 0, data: { content: 'u', taskId: 1 } }]
    expect(clearDownstreamResults(nodes, [])).toEqual(nodes)
  })
})

describe('placeWorkflowGraph', () => {
  it('换新 id、落到指定位置，连线跟着改写', () => {
    const graph = buildWorkflowGraph(items, edges)
    let n = 0
    const placed = placeWorkflowGraph(graph, { x: 1000, y: 500 }, kind => `${kind}-new-${++n}`)
    expect(placed.nodes.map(node => [node.id, node.x, node.y])).toEqual([
      ['image-new-1', 1000, 500],
      ['video-new-2', 1400, 540],
    ])
    expect(placed.edges).toEqual([{ source: 'image-new-1', target: 'video-new-2', sourceHandle: 'out', targetHandle: 'in' }])
  })

  it('指向不存在节点的连线丢掉', () => {
    const graph = { version: 1, nodes: [{ id: 'a', kind: 'image', x: 0, y: 0, data: {} }], edges: [{ source: 'a', target: 'ghost' }] }
    expect(placeWorkflowGraph(graph, { x: 0, y: 0 }, () => 'a2').edges).toEqual([])
  })
})

describe('isUsableWorkflowGraph 与展示字段', () => {
  it('空图不可用', () => {
    expect(isUsableWorkflowGraph(null)).toBe(false)
    expect(isUsableWorkflowGraph({ version: 1, nodes: [], edges: [] })).toBe(false)
  })

  it('封面取第一张有产物的图', () => {
    expect(workflowCover(buildWorkflowGraph(items, edges).nodes)).toBe('https://cdn/a.png')
    expect(workflowCover([])).toBe('')
  })

  it('默认名按节点类型拼', () => {
    expect(defaultWorkflowName(buildWorkflowGraph(items, edges).nodes)).toBe('图片 → 视频 工作流')
    expect(defaultWorkflowName([])).toBe('我的工作流')
  })
})

// API.md 32 的 apply_graph：模型给的图（契约 3.3 的样例）
const agentGraph: CanvasWorkflowGraph = {
  version: 1,
  nodes: [
    { id: 'n1', kind: 'text', x: 0, y: 0, data: { label: '脚本', content: '15 秒竖屏广告' } },
    { id: 'n2', kind: 'image', x: 400, y: 0, width: 320, height: 220, data: { label: '产品首帧', prompt: '产品特写', model: 'gpt-image-1', params: { ratio: '9:16', clarity: '2K' } } },
    { id: 'n4', kind: 'audio', x: 800, y: 270, data: { label: '女声旁白', prompt: '欢快、语速偏快', model: 'tts-1' } },
  ],
  edges: [
    { source: 'n1', target: 'n2', sourceHandle: 'out', targetHandle: 'in' },
    { source: 'n2', target: 'n4' },
  ],
}

describe('workflowNodesToFlow', () => {
  it('id 重建与偏移跟 placeWorkflowGraph 的 idMap 对齐', () => {
    let n = 0
    const { nodes: flowNodes, edges: flowEdges, idMap } = applyWorkflowGraph(agentGraph, { x: 1000, y: 500 }, kind => `${kind}-${++n}`)
    expect([...idMap.entries()]).toEqual([['n1', 'text-1'], ['n2', 'image-2'], ['n4', 'audio-3']])
    expect(flowNodes.map(node => [node.id, node.type, node.position.x, node.position.y])).toEqual([
      ['text-1', 'easytv', 1000, 500],
      ['image-2', 'easytv', 1400, 500],
      ['audio-3', 'easytv', 1800, 770],
    ])
    expect(flowEdges.map(edge => [edge.source, edge.target, edge.sourceHandle, edge.targetHandle])).toEqual([
      ['text-1', 'image-2', 'out', 'in'],
      ['image-2', 'audio-3', 'out', 'in'],
    ])
    expect(flowEdges[0]!.id).toBeTruthy()
    expect(flowEdges[0]!.id).not.toBe(flowEdges[1]!.id)
  })

  it('宽高：显式给了用给的，没给取 canvasStageSize', () => {
    const { nodes: flowNodes } = workflowNodesToFlow(agentGraph.nodes, agentGraph.edges)
    expect(flowNodes.map(node => [node.id, node.width, node.height, node.style.width, node.style.height])).toEqual([
      ['n1', 252, 220, '252px', '220px'],
      ['n2', 320, 220, '320px', '220px'],
      ['n4', 280, 118, '280px', '118px'],
    ])
  })

  it('data 补齐 CanvasNodeData 的必填项，模型与参数原样带下来', () => {
    const { nodes: flowNodes } = workflowNodesToFlow(agentGraph.nodes, agentGraph.edges)
    expect(flowNodes[1]!.data).toEqual({
      label: '产品首帧',
      prompt: '产品特写',
      model: 'gpt-image-1',
      params: { ratio: '9:16', clarity: '2K' },
      kind: 'image',
      mode: 'idle',
      content: '',
    })
    expect(workflowNodesToFlow([{ id: 'n9', kind: 'video', x: 0, y: 0, data: { prompt: '动起来' } }], []).nodes[0]!.data)
      .toEqual({ prompt: '动起来', kind: 'video', mode: 'idle', content: '', label: 'n9' })
  })
})

describe('apply_graph 落图', () => {
  it('整批只占一步撤销历史：一次撤销回到原状（前后快照相等）', async () => {
    const existing: CanvasFlowNode = {
      id: 'text-9',
      type: 'easytv',
      position: { x: 0, y: 0 },
      data: { kind: 'text', label: '原有节点', content: '原有内容', prompt: '', mode: 'idle' },
    } as CanvasFlowNode
    const nodes = ref<CanvasFlowNode[]>([existing])
    const edges = ref<Edge[]>([])
    const history = useCanvasHistory({ nodes, edges, emitChange: () => {} })
    history.gate.suppress = false
    history.pushHistory()
    const snap = () => JSON.stringify({ nodes: nodes.value, edges: edges.value })
    const before = snap()

    // 与 CanvasWorkspace.applyAssistChanges 的 apply_graph 分支同一条路径：落图 → 合入 → 只压一条历史
    let n = 0
    const placed = applyWorkflowGraph(agentGraph, { x: 1000, y: 500 }, kind => `${kind}-${++n}`)
    nodes.value = [...nodes.value, ...placed.nodes] as unknown as CanvasFlowNode[]
    edges.value = [...edges.value, ...placed.edges] as unknown as Edge[]
    history.pushHistory()

    const after = snap()
    expect(after).not.toBe(before)
    expect(nodes.value).toHaveLength(4)
    expect(edges.value).toHaveLength(2)
    expect(history.historySnaps.value).toHaveLength(2)

    history.undo()
    expect(snap()).toBe(before)
    await nextTick()
    expect(history.canRedo.value).toBe(true)
    history.redo()
    expect(snap()).toBe(after)
  })
})
