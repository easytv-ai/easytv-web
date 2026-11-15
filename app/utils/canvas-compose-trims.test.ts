import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { applyComposeTrims, composeTrimPatches } from './canvas-compose'
import { useCanvasHistory } from '~/composables/useCanvasHistory'

type Clip = { id: string, data: { trimIn?: number, trimOut?: number, locked?: boolean } }

function makeCanvas() {
  const nodes = ref<Clip[]>([
    { id: 'video-1', data: {} },
    { id: 'video-2', data: { trimIn: 1, trimOut: 4 } },
    { id: 'video-3', data: { locked: true } },
  ])
  const edges = ref<unknown[]>([])
  const emitChange = vi.fn()
  const history = useCanvasHistory({ nodes, edges, emitChange })
  history.resetHistory()
  history.gate.suppress = false
  const persist = (items: Array<{ id: string, trimIn?: number, trimOut?: number }>) => applyComposeTrims(items, {
    lookup: (id) => {
      const node = nodes.value.find(item => item.id === id)
      return node ? { trimIn: node.data.trimIn, trimOut: node.data.trimOut, locked: node.data.locked } : null
    },
    update: (id, patch) => Object.assign(nodes.value.find(item => item.id === id)!.data, patch),
    commit: history.pushHistory,
  })
  return { nodes, history, emitChange, persist }
}

describe('合成面板入出点写回画布', () => {
  it('一次调整改了多段：只入一次撤销栈、只通知一次保存', () => {
    const { nodes, history, emitChange, persist } = makeCanvas()
    const changed = persist([
      { id: 'video-1', trimIn: 0.5, trimOut: 3 },
      { id: 'video-2', trimIn: 2, trimOut: 4 },
    ])
    expect(changed).toBe(2)
    expect(nodes.value[0]!.data).toMatchObject({ trimIn: 0.5, trimOut: 3 })
    expect(nodes.value[1]!.data).toMatchObject({ trimIn: 2, trimOut: 4 })
    expect(history.historySnaps.value).toHaveLength(2)
    expect(emitChange).toHaveBeenCalledTimes(1)
  })

  it('撤销一次就回到调整之前', () => {
    const { nodes, history, persist } = makeCanvas()
    persist([{ id: 'video-1', trimIn: 0.5, trimOut: 3 }, { id: 'video-2', trimIn: 2, trimOut: 4 }])
    expect(history.canUndo.value).toBe(true)
    history.undo()
    expect(nodes.value[0]!.data.trimIn).toBeUndefined()
    expect(nodes.value[1]!.data).toMatchObject({ trimIn: 1, trimOut: 4 })
  })

  it('数值没变（关面板时面板会交回两次）：不入栈、不触发保存', () => {
    const { history, emitChange, persist } = makeCanvas()
    persist([{ id: 'video-2', trimIn: 2, trimOut: 4 }])
    emitChange.mockClear()
    expect(persist([{ id: 'video-2', trimIn: 2, trimOut: 4 }])).toBe(0)
    expect(persist([{ id: 'video-1', trimIn: 0, trimOut: 0 }])).toBe(0)
    expect(history.historySnaps.value).toHaveLength(2)
    expect(emitChange).not.toHaveBeenCalled()
  })

  it('锁定的 / 已删掉的片段不写', () => {
    const { nodes, history, persist } = makeCanvas()
    expect(persist([{ id: 'video-3', trimIn: 1, trimOut: 2 }, { id: 'gone', trimIn: 1, trimOut: 2 }])).toBe(0)
    expect(nodes.value[2]!.data.trimIn).toBeUndefined()
    expect(history.historySnaps.value).toHaveLength(1)
  })

  it('清回 0 写成 undefined（不在节点上留 0）', () => {
    expect(composeTrimPatches([{ id: 'a', trimIn: 0, trimOut: 0 }], () => ({ trimIn: 1, trimOut: 4 }))).toEqual([
      { id: 'a', patch: { trimIn: undefined, trimOut: undefined } },
    ])
  })
})
