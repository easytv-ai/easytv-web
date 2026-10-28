import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import type { CanvasFlowNode } from '~/utils/canvas-group'
import { canvasIsAutoConnectedPrompt, useCanvasConnect } from './useCanvasConnect'

describe('canvasIsAutoConnectedPrompt', () => {
  it('只认连线自动写入的提示词', () => {
    expect(canvasIsAutoConnectedPrompt('@图片1 一个角色')).toBe(true)
    expect(canvasIsAutoConnectedPrompt('参考 @图片节点')).toBe(true)
    expect(canvasIsAutoConnectedPrompt('@文本2 对白')).toBe(true)
    expect(canvasIsAutoConnectedPrompt('手写的提示词')).toBe(false)
    expect(canvasIsAutoConnectedPrompt('图片1 不是自动前缀')).toBe(false)
  })
})

function makeStore(prompt: string, upstreamText = '一段上游文本') {
  const nodes = ref<CanvasFlowNode[]>([
    { id: 'text-1', type: 'text', position: { x: 0, y: 0 }, data: { kind: 'text', label: '文本', content: upstreamText } as any },
    { id: 'image-1', type: 'image', position: { x: 0, y: 200 }, data: { kind: 'image', label: '图片', content: '', prompt } as any },
  ])
  const edges = ref<Array<{ source: string, target: string }>>([])
  const connect = useCanvasConnect({
    nodes,
    edges,
    findNode: id => nodes.value.find(node => node.id === id),
    updateNodeData: (id, patch) => {
      const node = nodes.value.find(item => item.id === id)
      if (node?.data)
        Object.assign(node.data as object, patch)
    },
    addEdges: (edge: any) => {
      edges.value.push({ source: edge.source, target: edge.target })
    },
    defaultEdgeOptions: { type: 'default', animated: false },
    pushHistory: () => {},
    nodePlainText: node => String((node.data as any).content || ''),
  })
  const promptOf = () => String((nodes.value[1]!.data as any).prompt)
  return { connect, promptOf, nodes }
}

const link = { source: 'text-1', target: 'image-1', sourceHandle: 'out', targetHandle: 'in' }

describe('linkNodes 追加模式', () => {
  it('下游提示词为空：直接填上游文本', () => {
    const { connect, promptOf } = makeStore('')
    expect(connect.linkNodes(link, { mode: 'append' })).toBe('replaced')
    expect(promptOf()).toBe('一段上游文本')
  })

  it('下游是自动写入的提示词：整个替换', () => {
    const { connect, promptOf } = makeStore('@图片1 自动同步的')
    expect(connect.linkNodes(link, { mode: 'append' })).toBe('replaced')
    expect(promptOf()).toBe('一段上游文本')
  })

  it('用户手写的提示词：追加到末尾，再连同样文本不重复', () => {
    const { connect, promptOf } = makeStore('用户写的提示词')
    expect(connect.linkNodes(link, { mode: 'append' })).toBe('appended')
    expect(promptOf()).toBe('用户写的提示词\n\n一段上游文本')
    expect(connect.syncConnectedPrompt('image-1', 'append')).toBeNull()
    expect(connect.linkNodes(link, { mode: 'append' })).toBeNull()
    expect(promptOf()).toBe('用户写的提示词\n\n一段上游文本')
  })

  it('force:true 仍然覆盖用户提示词', () => {
    const { connect, promptOf } = makeStore('用户写的提示词')
    expect(connect.linkNodes(link, { force: true })).toBe('replaced')
    expect(promptOf()).toBe('一段上游文本')
    const soft = makeStore('用户写的提示词')
    expect(soft.connect.linkNodes(link, { force: false })).toBeNull()
    expect(soft.promptOf()).toBe('用户写的提示词')
  })
})

describe('linkNodes 边延迟落地', () => {
  it('addEdges 异步生效时，下一拍再同步一次并回调', async () => {
    const nodes = ref<CanvasFlowNode[]>([
      { id: 'text-1', type: 'text', position: { x: 0, y: 0 }, data: { kind: 'text', label: '文本', content: '上游文本' } as any },
      { id: 'image-1', type: 'image', position: { x: 0, y: 200 }, data: { kind: 'image', label: '图片', content: '', prompt: '用户写的' } as any },
    ])
    const edges = ref<Array<{ source: string, target: string }>>([])
    const appended: string[] = []
    const connect = useCanvasConnect({
      nodes,
      edges,
      findNode: id => nodes.value.find(node => node.id === id),
      updateNodeData: (id, patch) => {
        const node = nodes.value.find(item => item.id === id)
        if (node?.data)
          Object.assign(node.data as object, patch)
      },
      // 模拟 vue-flow：变更走队列，同步这一刻 edges 里还没有
      addEdges: (edge: any) => { queueMicrotask(() => edges.value.push({ source: edge.source, target: edge.target })) },
      defaultEdgeOptions: { type: 'default', animated: false },
      pushHistory: () => {},
      nodePlainText: node => String((node.data as any).content || ''),
      onPromptAppended: () => appended.push('yes'),
    })
    const results: string[] = []
    expect(connect.linkNodes(link, { mode: 'append', onLater: r => results.push(String(r)) })).toBe(null)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(results).toEqual(['appended'])
    expect(String((nodes.value[1]!.data as any).prompt)).toBe('用户写的\n\n上游文本')
  })
})

describe('detachLinkedRef', () => {
  function videoStore() {
    const nodes = ref<CanvasFlowNode[]>([
      {
        id: 'image-1',
        type: 'image',
        position: { x: 0, y: 0 },
        data: { kind: 'image', label: '图片', content: 'https://cdn/a.png', assetId: 3, prompt: '' } as any,
      },
      {
        id: 'video-1',
        type: 'video',
        position: { x: 200, y: 0 },
        data: {
          kind: 'video',
          label: '视频',
          content: '',
          prompt: '',
          refAssetId: 3,
          refUrl: 'https://cdn/a.png',
          lastAssetId: 3,
          lastUrl: 'https://cdn/a.png',
        } as any,
      },
    ])
    const connect = useCanvasConnect({
      nodes,
      edges: ref([]),
      findNode: id => nodes.value.find(node => node.id === id),
      updateNodeData: (id, patch) => {
        const node = nodes.value.find(item => item.id === id)
        if (node?.data)
          Object.assign(node.data as object, patch)
      },
      addEdges: () => {},
      defaultEdgeOptions: { type: 'default', animated: false },
      pushHistory: () => {},
      nodePlainText: () => '',
    })
    const video = () => nodes.value[1]!.data as any
    return { connect, video }
  }

  it('剪断连线后，接收节点上从这条线抄来的参考和尾帧一起消失', () => {
    const { connect, video } = videoStore()
    connect.detachLinkedRef({ source: 'image-1', target: 'video-1' })
    expect(video().refUrl).toBe('')
    expect(video().refAssetId).toBeUndefined()
    expect(video().lastUrl).toBe('')
    expect(video().lastAssetId).toBeUndefined()
  })

  it('反向连线同样清；自己上传的参考不跟着线消失', () => {
    const { connect, video } = videoStore()
    video().refItems = [{ assetId: 3, url: 'https://cdn/a.png' }]
    connect.detachLinkedRef({ source: 'video-1', target: 'image-1' })
    expect(video().refUrl).toBe('https://cdn/a.png')
    expect(video().refAssetId).toBe(3)
    expect(video().lastUrl).toBe('')
  })

  it('参考不是这条线上的图片时不动', () => {
    const { connect, video } = videoStore()
    video().refAssetId = 9
    video().refUrl = 'https://cdn/other.png'
    video().lastAssetId = undefined
    video().lastUrl = ''
    connect.detachLinkedRef({ source: 'image-1', target: 'video-1' })
    expect(video().refUrl).toBe('https://cdn/other.png')
    expect(video().refAssetId).toBe(9)
  })
})

describe('锁定节点不能连', () => {
  it('isValidConnection 两端任一锁定就拒绝', () => {
    const { connect, nodes } = makeStore('用户写的提示词')
    expect(connect.isValidConnection(link)).toBe(true)
    ;(nodes.value[1]!.data as { locked?: boolean }).locked = true
    expect(connect.isValidConnection(link)).toBe(false)
  })

  it('左侧对左侧、右侧对右侧都不算参考线', () => {
    const { connect } = makeStore('用户写的提示词')
    expect(connect.isValidConnection({ source: 'image-2', target: 'image-1', sourceHandle: 'in', targetHandle: 'in' })).toBe(false)
    expect(connect.isValidConnection({ source: 'image-2', target: 'image-1', sourceHandle: 'out', targetHandle: 'out' })).toBe(false)
  })

  it('connectSelected 跳过锁定目标，不追加提示词', () => {
    const { connect, promptOf, nodes } = makeStore('用户写的提示词')
    nodes.value[0]!.selected = true
    nodes.value[1]!.selected = true
    ;(nodes.value[1]!.data as { locked?: boolean }).locked = true
    connect.connectSelected()
    expect(promptOf()).toBe('用户写的提示词')
  })
})
