import { describe, expect, it } from 'vitest'
import { pageForOffset, useStudioPaged } from './useStudioPaged'

/** 模拟服务端：按页切当前名单，取关就是从名单里拿掉 */
function fakeServer(count: number) {
  let rows = Array.from({ length: count }, (_, i) => ({ id: i + 1 }))
  const calls: number[] = []
  return {
    calls,
    remove(id: number) {
      rows = rows.filter(row => row.id !== id)
    },
    fail: false,
    async fetch(this: void, page: number, pageSize: number) {
      calls.push(page)
      if (server.fail)
        return null
      return { items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length }
    },
  }
}
let server: ReturnType<typeof fakeServer>

describe('pageForOffset', () => {
  it('取第一个未加载偏移所在的页', () => {
    expect(pageForOffset(20, 20)).toBe(2)
    expect(pageForOffset(19, 20)).toBe(1)
    expect(pageForOffset(39, 20)).toBe(2)
    expect(pageForOffset(0, 20)).toBe(1)
  })
})

describe('useStudioPaged 删行后续翻', () => {
  it('取关一人后翻下一页不漏人', async () => {
    server = fakeServer(7)
    const pager = useStudioPaged<{ id: number }>({ pageSize: 3, fetch: server.fetch })
    await pager.reload()
    server.remove(2)
    pager.removeById(2)
    await pager.loadMore()
    await pager.loadMore()
    await pager.loadMore()
    expect(pager.items.value.map(row => row.id)).toEqual([1, 3, 4, 5, 6, 7])
    expect(pager.hasMore.value).toBe(false)
  })

  it('一页取关多人也能接上', async () => {
    server = fakeServer(9)
    const pager = useStudioPaged<{ id: number }>({ pageSize: 3, fetch: server.fetch })
    await pager.reload()
    for (const id of [1, 2, 3]) {
      server.remove(id)
      pager.removeById(id)
    }
    await pager.loadMore()
    await pager.loadMore()
    expect(pager.items.value.map(row => row.id)).toEqual([4, 5, 6, 7, 8, 9])
  })

  it('没删过行时仍按页码顺序翻', async () => {
    server = fakeServer(7)
    const pager = useStudioPaged<{ id: number }>({ pageSize: 3, fetch: server.fetch })
    await pager.reload()
    await pager.loadMore()
    await pager.loadMore()
    expect(server.calls).toEqual([1, 2, 3])
    expect(pager.items.value).toHaveLength(7)
  })

  it('续翻失败不前进页码，重试取的还是同一页', async () => {
    server = fakeServer(7)
    const pager = useStudioPaged<{ id: number }>({ pageSize: 3, fetch: server.fetch })
    await pager.reload()
    server.fail = true
    await pager.loadMore()
    expect(pager.page.value).toBe(1)
    server.fail = false
    await pager.loadMore()
    expect(server.calls).toEqual([1, 2, 2])
    expect(pager.items.value.map(row => row.id)).toEqual([1, 2, 3, 4, 5, 6])
  })
})
