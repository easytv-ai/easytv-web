import { describe, expect, it, vi } from 'vitest'
import { dispatchCanvasShortcut, type CanvasShortcutApi } from './canvas-shortcuts'

function api(overrides: Partial<CanvasShortcutApi> = {}): CanvasShortcutApi {
  const noop = () => {}
  return {
    markPickOpen: false,
    closeMarkPick: noop,
    smartEditOpen: false,
    markOpen: false,
    cropOpen: false,
    eraseOpen: false,
    outpaintOpen: false,
    flipOpen: false,
    depthOpen: false,
    lightOpen: false,
    angleOpen: false,
    viralOpen: false,
    closeDepth: noop,
    closeLight: noop,
    closeAngle: noop,
    closeViral: noop,
    dismissChrome: noop,
    isTyping: false,
    readonly: false,
    organizeCanvas: noop,
    toggleHelp: noop,
    openMenuAtAdd: noop,
    setToolSelect: noop,
    beginSpacePan: noop,
    groupSelected: noop,
    ungroupSelected: noop,
    copySelected: noop,
    pasteClip: noop,
    duplicateSelected: noop,
    connectSelected: noop,
    onGenerate: noop,
    zoomIn: noop,
    zoomOut: noop,
    fitView: noop,
    openFind: noop,
    closeFind: noop,
    undo: noop,
    redo: noop,
    removeSelectedNodes: noop,
    alignSelection: noop,
    toggleLockSelected: noop,
    findStep: noop,
    nudgeSelection: noop,
    ...overrides,
  }
}

function event(partial: Partial<Parameters<typeof dispatchCanvasShortcut>[0]> = {}) {
  return {
    key: 'a',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    preventDefault: vi.fn(),
    ...partial,
  }
}

describe('dispatchCanvasShortcut', () => {
  it('标记选区打开时只处理 Escape，其余按键吞掉', () => {
    const closeMarkPick = vi.fn()
    const undo = vi.fn()
    dispatchCanvasShortcut(event({ key: 'Escape' }), api({ markPickOpen: true, closeMarkPick, undo }))
    expect(closeMarkPick).toHaveBeenCalledOnce()
    dispatchCanvasShortcut(event({ key: 'z', ctrlKey: true }), api({ markPickOpen: true, closeMarkPick, undo }))
    expect(undo).not.toHaveBeenCalled()
  })

  it('智能编辑等弹层打开时快捷键不进画布', () => {
    const undo = vi.fn()
    dispatchCanvasShortcut(event({ key: 'z', ctrlKey: true }), api({ smartEditOpen: true, undo }))
    dispatchCanvasShortcut(event({ key: 'Escape' }), api({ cropOpen: true, dismissChrome: undo }))
    expect(undo).not.toHaveBeenCalled()
  })

  it('Escape 按深度 / 打光 / 多角度 / 爆款顺序关，否则收菜单', () => {
    const closeDepth = vi.fn()
    const closeLight = vi.fn()
    const dismissChrome = vi.fn()
    dispatchCanvasShortcut(event({ key: 'Escape' }), api({ depthOpen: true, lightOpen: true, closeDepth, closeLight, dismissChrome }))
    expect(closeDepth).toHaveBeenCalledOnce()
    expect(closeLight).not.toHaveBeenCalled()
    expect(dismissChrome).not.toHaveBeenCalled()
    dispatchCanvasShortcut(event({ key: 'Escape' }), api({ dismissChrome }))
    expect(dismissChrome).toHaveBeenCalledOnce()
  })

  it('输入中或只读时不处理编辑快捷键', () => {
    const removeSelectedNodes = vi.fn()
    dispatchCanvasShortcut(event({ key: 'Delete' }), api({ isTyping: true, removeSelectedNodes }))
    dispatchCanvasShortcut(event({ key: 'Delete' }), api({ readonly: true, removeSelectedNodes }))
    expect(removeSelectedNodes).not.toHaveBeenCalled()
  })

  it('深度面板开着时不响应删除和撤销', () => {
    const undo = vi.fn()
    const removeSelectedNodes = vi.fn()
    dispatchCanvasShortcut(event({ key: 'z', ctrlKey: true }), api({ depthOpen: true, undo, removeSelectedNodes }))
    dispatchCanvasShortcut(event({ key: 'Delete' }), api({ lightOpen: true, undo, removeSelectedNodes }))
    expect(undo).not.toHaveBeenCalled()
    expect(removeSelectedNodes).not.toHaveBeenCalled()
  })

  it('常用编辑快捷键走对应回调', () => {
    const groupSelected = vi.fn()
    const ungroupSelected = vi.fn()
    const copySelected = vi.fn()
    const connectSelected = vi.fn()
    const undo = vi.fn()
    const redo = vi.fn()
    const removeSelectedNodes = vi.fn()
    const setToolSelect = vi.fn()
    const beginSpacePan = vi.fn()
    dispatchCanvasShortcut(event({ key: 'g', ctrlKey: true }), api({ groupSelected, ungroupSelected }))
    expect(groupSelected).toHaveBeenCalledOnce()
    dispatchCanvasShortcut(event({ key: 'g', ctrlKey: true, shiftKey: true }), api({ groupSelected, ungroupSelected }))
    expect(ungroupSelected).toHaveBeenCalledOnce()
    dispatchCanvasShortcut(event({ key: 'c', metaKey: true }), api({ copySelected }))
    expect(copySelected).toHaveBeenCalledOnce()
    dispatchCanvasShortcut(event({ key: 'l', ctrlKey: true }), api({ connectSelected }))
    expect(connectSelected).toHaveBeenCalledOnce()
    dispatchCanvasShortcut(event({ key: 'z', ctrlKey: true }), api({ undo, redo }))
    expect(undo).toHaveBeenCalledOnce()
    dispatchCanvasShortcut(event({ key: 'z', ctrlKey: true, shiftKey: true }), api({ undo, redo }))
    expect(redo).toHaveBeenCalledOnce()
    dispatchCanvasShortcut(event({ key: 'Delete' }), api({ removeSelectedNodes }))
    expect(removeSelectedNodes).toHaveBeenCalledOnce()
    dispatchCanvasShortcut(event({ key: 'v' }), api({ setToolSelect }))
    expect(setToolSelect).toHaveBeenCalledOnce()
    const ev = event({ key: ' ' })
    dispatchCanvasShortcut(ev, api({ beginSpacePan }))
    expect(ev.preventDefault).toHaveBeenCalledOnce()
    expect(beginSpacePan).toHaveBeenCalledOnce()
    dispatchCanvasShortcut(event({ key: ' ', repeat: true }), api({ beginSpacePan }))
    expect(beginSpacePan).toHaveBeenCalledOnce()
  })

  it('Alt 方向键对齐，⇧⌘L 锁定', () => {
    const alignSelection = vi.fn()
    const toggleLockSelected = vi.fn()
    const connectSelected = vi.fn()
    dispatchCanvasShortcut(event({ key: 'ArrowLeft', altKey: true }), api({ alignSelection }))
    expect(alignSelection).toHaveBeenCalledWith('align-left')
    dispatchCanvasShortcut(event({ key: 'h', altKey: true }), api({ alignSelection }))
    expect(alignSelection).toHaveBeenCalledWith('align-center')
    dispatchCanvasShortcut(event({ key: 'h', altKey: true, shiftKey: true }), api({ alignSelection }))
    expect(alignSelection).toHaveBeenCalledWith('distribute-h')
    dispatchCanvasShortcut(event({ key: 'l', ctrlKey: true, shiftKey: true }), api({ toggleLockSelected, connectSelected }))
    expect(toggleLockSelected).toHaveBeenCalledOnce()
    expect(connectSelected).not.toHaveBeenCalled()
  })

  it('F3 连跳查找，方向键微移', () => {
    const findStep = vi.fn()
    const nudgeSelection = vi.fn()
    dispatchCanvasShortcut(event({ key: 'F3' }), api({ findStep }))
    expect(findStep).toHaveBeenCalledWith(1)
    dispatchCanvasShortcut(event({ key: 'F3', shiftKey: true }), api({ findStep }))
    expect(findStep).toHaveBeenCalledWith(-1)
    dispatchCanvasShortcut(event({ key: 'ArrowRight' }), api({ nudgeSelection }))
    expect(nudgeSelection).toHaveBeenCalledWith('ArrowRight', false, false)
    dispatchCanvasShortcut(event({ key: 'ArrowLeft', shiftKey: true, repeat: true }), api({ nudgeSelection }))
    expect(nudgeSelection).toHaveBeenCalledWith('ArrowLeft', true, true)
  })

  it('⌘F 打开查找，Escape 在查找开着时先关查找', () => {
    const openFind = vi.fn()
    const closeFind = vi.fn()
    const dismissChrome = vi.fn()
    dispatchCanvasShortcut(event({ key: 'f', ctrlKey: true }), api({ openFind }))
    expect(openFind).toHaveBeenCalledOnce()
    dispatchCanvasShortcut(event({ key: 'Escape' }), api({ findOpen: true, closeFind, dismissChrome }))
    expect(closeFind).toHaveBeenCalledOnce()
    expect(dismissChrome).not.toHaveBeenCalled()
  })
})
