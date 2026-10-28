import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import { useCanvasHistory } from '../composables/useCanvasHistory'
import type { CanvasFlowNode } from './canvas-group'

function node(id: string): CanvasFlowNode {
  return { id, type: 'easytv', position: { x: 0, y: 0 }, data: { kind: 'text', label: id } } as CanvasFlowNode
}

describe('useCanvasHistory', () => {
  it('相同快照不重复入栈，内容变了才新增', () => {
    const nodes = ref<CanvasFlowNode[]>([node('a')])
    const edges = ref<Edge[]>([])
    const changes: number[] = []
    const history = useCanvasHistory({
      nodes,
      edges,
      emitChange: () => { changes.push(1) },
    })
    history.gate.suppress = false
    history.pushHistory()
    history.pushHistory()
    expect(history.historySnaps.value).toHaveLength(1)
    nodes.value = [node('a'), node('b')]
    history.pushHistory()
    expect(history.historySnaps.value).toHaveLength(2)
    expect(history.canUndo.value).toBe(true)
    expect(changes.length).toBeGreaterThan(0)
  })

  it('撤销回到上一版，重做再回来', async () => {
    const nodes = ref<CanvasFlowNode[]>([node('a')])
    const edges = ref<Edge[]>([])
    const history = useCanvasHistory({ nodes, edges, emitChange: () => {} })
    history.gate.suppress = false
    history.pushHistory()
    nodes.value = [node('b')]
    history.pushHistory()
    history.undo()
    expect(nodes.value.map(item => item.id)).toEqual(['a'])
    history.redo()
    expect(nodes.value.map(item => item.id)).toEqual(['b'])
    await nextTick()
    expect(history.gate.lock).toBe(false)
  })

  it('lock 期间不入栈', () => {
    const nodes = ref<CanvasFlowNode[]>([node('a')])
    const edges = ref<Edge[]>([])
    const history = useCanvasHistory({ nodes, edges, emitChange: () => {} })
    history.gate.suppress = false
    history.pushHistory()
    history.gate.lock = true
    nodes.value = [node('b')]
    history.pushHistory()
    expect(history.historySnaps.value).toHaveLength(1)
  })
})
