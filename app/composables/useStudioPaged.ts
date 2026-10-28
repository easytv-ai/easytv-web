import type { Paged } from '~/types/creative'
import { computed, ref, type Ref } from 'vue'

type PagedResult<T> = Pick<Paged<T>, 'items' | 'total'>

/**
 * 创作台列表分页：首屏重置、上拉追加、按 id 去重。
 * fetch 在调用时读取最新筛选条件（keyword / type 等）。
 * 首次完成前 busy 为真（骨架屏）；刷新失败保留上一份列表；空列表只在成功且总数为 0 时出现。
 */
export function useStudioPaged<T extends { id: number | string }>(options: {
  pageSize?: number
  fetch: (page: number, pageSize: number) => Promise<PagedResult<T> | null | undefined>
}) {
  const pageSize = options.pageSize ?? 24
  const items = ref<T[]>([]) as Ref<T[]>
  const page = ref(1)
  const total = ref(0)
  const loading = ref(false)
  const loadingMore = ref(false)
  const loaded = ref(false)
  const failed = ref(false)
  let seq = 0

  const hasMore = computed(() => loaded.value && items.value.length < total.value)
  /** 还没成功过、也还没失败过：给列表留出骨架屏，避免先闪「暂无」 */
  const busy = computed(() => !loaded.value && !failed.value && items.value.length === 0)

  async function load(reset: boolean) {
    if (!reset && (loading.value || loadingMore.value))
      return false
    const previous = {
      page: page.value,
      items: items.value.slice(),
      total: total.value,
    }
    if (reset) {
      page.value = 1
      loading.value = true
      loadingMore.value = false
    }
    else {
      loadingMore.value = true
    }
    const current = ++seq
    try {
      const data = await options.fetch(page.value, pageSize)
      if (current !== seq)
        return false
      if (!data) {
        if (reset) {
          page.value = previous.page
          items.value = previous.items
          total.value = previous.total
        }
        else {
          page.value = Math.max(1, page.value - 1)
        }
        // 还有上一份列表时继续展示它；只有空着的时候才换成失败态，避免写成「暂无」
        failed.value = items.value.length === 0
        return false
      }
      const next = data.items ?? []
      if (reset)
        items.value = next
      else {
        const seen = new Set(items.value.map(item => item.id))
        items.value = [...items.value, ...next.filter(item => !seen.has(item.id))]
      }
      total.value = !reset && !next.length ? items.value.length : data.total
      loaded.value = true
      failed.value = false
      return true
    }
    finally {
      if (current === seq) {
        loading.value = false
        loadingMore.value = false
      }
    }
  }

  async function reload() {
    return load(true)
  }

  async function loadMore() {
    if (!loaded.value || loading.value || loadingMore.value)
      return
    if (items.value.length >= total.value)
      return
    page.value += 1
    await load(false)
  }

  function removeById(id: number | string) {
    const before = items.value.length
    items.value = items.value.filter(item => item.id !== id)
    if (items.value.length < before)
      total.value = Math.max(0, total.value - 1)
  }

  function prepend(item: T) {
    const existed = items.value.some(row => row.id === item.id)
    items.value = [item, ...items.value.filter(row => row.id !== item.id)]
    if (!existed)
      total.value += 1
  }

  return {
    items,
    page,
    total,
    loading,
    loadingMore,
    loaded,
    failed,
    hasMore,
    busy,
    pageSize,
    reload,
    loadMore,
    removeById,
    prepend,
  }
}
