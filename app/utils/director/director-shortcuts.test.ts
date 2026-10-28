import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { dispatchDirectorShortcut } from './director-shortcuts'
import { isLinkedCameraLocked } from './object-focus'

function key(partial: Partial<KeyboardEvent> & { key: string }) {
  return {
    defaultPrevented: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    target: null,
    preventDefault: vi.fn(),
    ...partial,
  } as unknown as KeyboardEvent
}

describe('dispatchDirectorShortcut', () => {
  it('Ctrl+Z 撤销，Ctrl+Shift+Z / Ctrl+Y 重做', () => {
    const undo = vi.fn()
    const redo = vi.fn()
    expect(dispatchDirectorShortcut(key({ key: 'z', ctrlKey: true }), { undo, redo })).toBe(true)
    expect(undo).toHaveBeenCalledOnce()
    expect(dispatchDirectorShortcut(key({ key: 'z', ctrlKey: true, shiftKey: true }), { undo, redo })).toBe(true)
    expect(redo).toHaveBeenCalledOnce()
    expect(dispatchDirectorShortcut(key({ key: 'y', metaKey: true }), { undo, redo })).toBe(true)
    expect(redo).toHaveBeenCalledTimes(2)
  })

  it('输入框里不抢快捷键', () => {
    const undo = vi.fn()
    const input = { isContentEditable: false, tagName: 'TEXTAREA' } as unknown as HTMLElement
    expect(dispatchDirectorShortcut(key({ key: 'z', ctrlKey: true, target: input }), { undo, redo: vi.fn() })).toBe(false)
    expect(undo).not.toHaveBeenCalled()
  })

  it('Ctrl+C / Ctrl+V 复制粘贴对象', () => {
    const copy = vi.fn()
    const paste = vi.fn()
    expect(dispatchDirectorShortcut(key({ key: 'c', ctrlKey: true }), { undo: vi.fn(), redo: vi.fn(), copy, paste })).toBe(true)
    expect(copy).toHaveBeenCalledOnce()
    expect(dispatchDirectorShortcut(key({ key: 'v', metaKey: true }), { undo: vi.fn(), redo: vi.fn(), copy, paste })).toBe(true)
    expect(paste).toHaveBeenCalledOnce()
  })

  it('没接线时不抢浏览器默认复制粘贴', () => {
    expect(dispatchDirectorShortcut(key({ key: 'c', ctrlKey: true }), { undo: vi.fn(), redo: vi.fn() })).toBe(false)
    expect(dispatchDirectorShortcut(key({ key: 'v', ctrlKey: true }), { undo: vi.fn(), redo: vi.fn() })).toBe(false)
  })
})

describe('导演台撤销重做 / 路径拖拽接线', () => {
  it('工具条有重做按钮并监听 Ctrl+Z / C / V', () => {
    const src = readFileSync('app/components/canvas/director/DirectorViewportToolbar.vue', 'utf8')
    expect(src).toContain('dispatchDirectorShortcut')
    expect(src).toContain('store.redo()')
    expect(src).toContain('store.copySelectedObjects()')
    expect(src).toContain('store.pasteClipboardObjects()')
    expect(src).toContain("t('重做')")
  })

  it('运镜路径点和贝塞尔柄可拖，一次拖拽进撤销批', () => {
    const src = readFileSync('app/components/canvas/director/DirectorCameraPath.vue', 'utf8')
    expect(src).toContain('@pointerdown.stop="onNodeDown($event, node.id)"')
    expect(src).toContain('store.beginBatch()')
    expect(src).toContain('store.updateCameraNode')
    expect(src).toContain('store.updateCameraSegment')
    expect(src).toContain('store.readonly.value')
    expect(src).toContain('isLinkedCameraLocked')
  })

  it('机位对象锁了：属性 / 时间线 / 路径不能改，切换机位还能点', () => {
    expect(isLinkedCameraLocked([], 'cam-1')).toBe(false)
    expect(isLinkedCameraLocked([{ linkedCameraId: 'cam-1', locked: true }] as never, 'cam-1')).toBe(true)
    expect(isLinkedCameraLocked([{ linkedCameraId: 'cam-1', locked: false }] as never, 'cam-1')).toBe(false)

    const camera = readFileSync('app/components/canvas/director/panels/DirectorCameraPanel.vue', 'utf8')
    expect(camera).toContain('isLinkedCameraLocked')
    expect(camera).toContain('writeBlocked')
    expect(camera).toContain("t('切换机位')")
    expect(camera).toContain("class=\"director-camera-edits\"")

    const timeline = readFileSync('app/components/canvas/director/timeline/DirectorTimeline.vue', 'utf8')
    expect(timeline).toContain('isLinkedCameraLocked')
    expect(timeline).toContain(':write-blocked="writeBlocked"')

    const inspector = readFileSync('app/components/canvas/director/timeline/DirectorTimelineInspector.vue', 'utf8')
    expect(inspector).toContain('writeBlocked?: boolean')
    expect(inspector).toContain("if (props.writeBlocked || !current || !segment)")
  })

  it('会话把页面只读传进 store', () => {
    const src = readFileSync('app/components/canvas/CanvasDirectorSession.vue', 'utf8')
    expect(src).toContain('createDirectorStore(undefined, { readonly: props.readonly })')
  })
})
