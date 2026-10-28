import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { createDirectorHistory } from './history'
import { createInitialDirectorState, type DirectorState } from './state'

function setup() {
  const state = ref<DirectorState>(createInitialDirectorState())
  return { state, history: createDirectorHistory(state) }
}

/** 挪一下默认角色的位置，制造一次真实改动 */
function moveRole(state: DirectorState, x: number): DirectorState {
  return {
    ...state,
    project: {
      ...state.project,
      objects: state.project.objects.map(item =>
        item.id === 'char_default_a'
          ? { ...item, transform: { ...item.transform, position: [x, 0, 0] as [number, number, number] } }
          : item),
    },
  }
}

function rolePosition(state: DirectorState) {
  return state.project.objects.find(item => item.id === 'char_default_a')?.transform.position
}

describe('撤销栈', () => {
  it('撤销回到上一次改动之前', () => {
    const { state, history } = setup()
    history.commit(current => moveRole(current, 1))

    expect(rolePosition(state.value)).toEqual([1, 0, 0])
    expect(history.canUndo.value).toBe(true)

    history.undo()
    expect(rolePosition(state.value)).toEqual([0, 0, 0])
    expect(history.canUndo.value).toBe(false)
  })

  it('没有真的改动时不进撤销栈', () => {
    // 拖拽时每帧都提交，大量提交的结果和上一帧一样，不挡住的话撤销栈会被同一个位置塞满
    const { state, history } = setup()
    const changed = history.commit(current => moveRole(current, 0))

    expect(changed).toBe(false)
    expect(history.undoStack.value).toHaveLength(0)
    expect(rolePosition(state.value)).toEqual([0, 0, 0])
  })

  it('批量期间的连续改动算一步撤销', () => {
    const { state, history } = setup()
    history.beginBatch()
    history.commit(current => moveRole(current, 1))
    history.commit(current => moveRole(current, 2))
    history.commit(current => moveRole(current, 3))
    history.endBatch()

    expect(rolePosition(state.value)).toEqual([3, 0, 0])
    expect(history.undoStack.value).toHaveLength(1)

    history.undo()
    expect(rolePosition(state.value)).toEqual([0, 0, 0])
  })

  it('批量嵌套时只有最外层收口才入栈', () => {
    const { history } = setup()
    history.beginBatch()
    history.beginBatch()
    history.commit(current => moveRole(current, 5))
    history.endBatch()

    expect(history.undoStack.value).toHaveLength(0)

    history.endBatch()
    expect(history.undoStack.value).toHaveLength(1)
  })

  it('批量里什么都没改就不留下空的撤销步', () => {
    const { history } = setup()
    history.beginBatch()
    history.commit(current => moveRole(current, 0))
    history.endBatch()

    expect(history.undoStack.value).toHaveLength(0)
  })

  it('trackUndo 关掉的改动不占撤销步', () => {
    // 选中、折叠面板这类纯 UI 状态走这条路
    const { state, history } = setup()
    history.commit(current => ({ ...current, selectedObjectId: 'char_default_a' }), { trackUndo: false })

    expect(state.value.selectedObjectId).toBe('char_default_a')
    expect(history.undoStack.value).toHaveLength(0)
  })

  it('撤销拿到的是快照副本，改它不会污染栈里的记录', () => {
    const { state, history } = setup()
    history.commit(current => moveRole(current, 1))
    history.commit(current => moveRole(current, 2))

    history.undo()
    const restored = state.value.project.objects.find(item => item.id === 'char_default_a')!
    restored.transform.position[0] = 99

    history.undo()
    expect(rolePosition(state.value)).toEqual([0, 0, 0])
  })

  it('reset 装载新场景时清空撤销栈', () => {
    const { history } = setup()
    history.commit(current => moveRole(current, 1))
    expect(history.canUndo.value).toBe(true)

    history.reset(createInitialDirectorState())
    expect(history.canUndo.value).toBe(false)
  })

  it('撤销之后可以重做，新改动会清掉重做栈', () => {
    const { state, history } = setup()
    history.commit(current => moveRole(current, 1))
    history.commit(current => moveRole(current, 2))
    history.undo()
    expect(rolePosition(state.value)).toEqual([1, 0, 0])
    expect(history.canRedo.value).toBe(true)

    history.redo()
    expect(rolePosition(state.value)).toEqual([2, 0, 0])
    expect(history.canRedo.value).toBe(false)

    history.undo()
    history.commit(current => moveRole(current, 9))
    expect(history.canRedo.value).toBe(false)
    expect(rolePosition(state.value)).toEqual([9, 0, 0])
  })
})
