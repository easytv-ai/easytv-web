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

describe('机位对象锁定', () => {
  it('机位对象锁了才算锁：没有对应对象或对象没锁都不算', () => {
    expect(isLinkedCameraLocked([], 'cam-1')).toBe(false)
    expect(isLinkedCameraLocked([{ linkedCameraId: 'cam-1', locked: true }] as never, 'cam-1')).toBe(true)
    expect(isLinkedCameraLocked([{ linkedCameraId: 'cam-1', locked: false }] as never, 'cam-1')).toBe(false)
  })
})
