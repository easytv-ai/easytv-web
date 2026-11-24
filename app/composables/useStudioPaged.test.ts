import { describe, expect, it } from 'vitest'
import { useStudioPaged } from './useStudioPaged'

describe('useStudioPaged', () => {
  it('第一次请求完成前保持骨架态，成功的空列表才结束加载', async () => {
    let resolveFetch: (value: { items: { id: number }[], total: number } | null) => void = () => {}
    const pager = useStudioPaged<{ id: number }>({
      fetch: () => new Promise((resolve) => {
        resolveFetch = resolve
      }),
    })
    expect(pager.busy.value).toBe(true)
    expect(pager.failed.value).toBe(false)
    const pending = pager.reload()
    resolveFetch({ items: [], total: 0 })
    await pending
    expect(pager.busy.value).toBe(false)
    expect(pager.loaded.value).toBe(true)
    expect(pager.failed.value).toBe(false)
    expect(pager.items.value).toEqual([])
  })

  it('刷新失败时保留上一份列表', async () => {
    let fail = false
    const pager = useStudioPaged<{ id: number }>({
      fetch: async () => fail ? null : { items: [{ id: 1 }], total: 1 },
    })
    await pager.reload()
    fail = true
    expect(await pager.reload()).toBe(false)
    expect(pager.items.value).toEqual([{ id: 1 }])
    expect(pager.total.value).toBe(1)
    expect(pager.failed.value).toBe(false)
    expect(pager.loaded.value).toBe(true)
  })

  it('首次失败不当成空列表', async () => {
    const pager = useStudioPaged<{ id: number }>({
      fetch: async () => null,
    })
    expect(await pager.reload()).toBe(false)
    expect(pager.loaded.value).toBe(false)
    expect(pager.failed.value).toBe(true)
    expect(pager.busy.value).toBe(false)
    expect(pager.items.value).toEqual([])
  })

  it('有快照时重挂不进骨架，后台刷新也不先清空列表', async () => {
    const cache = { value: null as { items: { id: number }[], page: number, total: number, loaded: boolean } | null }
    const first = useStudioPaged<{ id: number }>({
      cache,
      fetch: async () => ({ items: [{ id: 1 }, { id: 2 }], total: 2 }),
    })
    expect(first.busy.value).toBe(true)
    await first.reload()
    expect(cache.value?.items).toEqual([{ id: 1 }, { id: 2 }])

    let resolveFetch: (value: { items: { id: number }[], total: number }) => void = () => {}
    const second = useStudioPaged<{ id: number }>({
      cache,
      fetch: () => new Promise((resolve) => {
        resolveFetch = resolve
      }),
    })
    expect(second.busy.value).toBe(false)
    expect(second.items.value).toEqual([{ id: 1 }, { id: 2 }])
    const pending = second.reload()
    expect(second.busy.value).toBe(false)
    expect(second.items.value).toEqual([{ id: 1 }, { id: 2 }])
    resolveFetch({ items: [{ id: 3 }], total: 1 })
    await pending
    expect(second.items.value).toEqual([{ id: 3 }])
  })
})
