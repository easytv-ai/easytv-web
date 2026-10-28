import { describe, expect, it, vi } from 'vitest'
import { startPointerDrag, type PointerDragTarget } from './pointer-drag'

function makeTarget(options: { captureThrows?: boolean } = {}) {
  const listeners = new Map<string, ((event: PointerEvent) => void)[]>()

  const target: PointerDragTarget & {
    listenerCount: () => number
    emit: (type: string) => void
  } = {
    setPointerCapture: options.captureThrows
      ? () => {
          throw new Error('No active pointer with the given id is found.')
        }
      : vi.fn(),
    addEventListener: (type, listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener])
    },
    removeEventListener: (type, listener) => {
      listeners.set(type, (listeners.get(type) ?? []).filter(item => item !== listener))
    },
    listenerCount: () => [...listeners.values()].reduce((sum, list) => sum + list.length, 0),
    emit: (type) => {
      for (const listener of [...(listeners.get(type) ?? [])])
        listener({} as PointerEvent)
    },
  }

  return target
}

describe('startPointerDrag', () => {
  it('捕获成功时监听挂在元素上', () => {
    const target = makeTarget()
    const fallback = makeTarget()
    startPointerDrag({ target, pointerId: 1, fallback, handlers: { onMove: () => {} } })

    expect(target.listenerCount()).toBe(3)
    expect(fallback.listenerCount()).toBe(0)
  })

  it('捕获抛异常时退回 fallback，拖动照样能用 —— 不能把后面的注册一起带走', () => {
    const target = makeTarget({ captureThrows: true })
    const fallback = makeTarget()
    const onMove = vi.fn()
    startPointerDrag({ target, pointerId: 1, fallback, handlers: { onMove } })

    expect(fallback.listenerCount()).toBe(3)
    fallback.emit('pointermove')
    expect(onMove).toHaveBeenCalledTimes(1)
  })

  it('抬起后监听全摘干净', () => {
    const target = makeTarget()
    startPointerDrag({ target, pointerId: 1, fallback: makeTarget(), handlers: { onMove: () => {} } })
    target.emit('pointerup')
    expect(target.listenerCount()).toBe(0)
  })

  it('pointerup 和 pointercancel 都来时 onEnd 只跑一次 —— 它常常是 endBatch', () => {
    const target = makeTarget()
    const onEnd = vi.fn()
    startPointerDrag({ target, pointerId: 1, fallback: makeTarget(), handlers: { onMove: () => {}, onEnd } })

    target.emit('pointerup')
    target.emit('pointercancel')
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('返回的函数可以提前收尾，重复调也只收一次', () => {
    const target = makeTarget()
    const onEnd = vi.fn()
    const finish = startPointerDrag({ target, pointerId: 1, fallback: makeTarget(), handlers: { onMove: () => {}, onEnd } })

    finish()
    finish()
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(target.listenerCount()).toBe(0)
  })

  it('元素没有 setPointerCapture 时也能拖', () => {
    const target = makeTarget()
    delete (target as { setPointerCapture?: unknown }).setPointerCapture
    startPointerDrag({ target, pointerId: 1, fallback: makeTarget(), handlers: { onMove: () => {} } })
    expect(target.listenerCount()).toBe(3)
  })
})
