import type { Paged } from '~/types/creative'
import { computed, ref, type Ref } from 'vue'

type PagedResult<T> = Pick<Paged<T>, 'items' | 'total'>

/** 跨页（画布 layout:false 会拆掉 keepalive）把列表快照留下来，回来不先闪骨架 */
export type PagedSnap<T> = {
  items: T[]
  page: number
  total: number
  loaded: boolean
}

/**
 * 本地删过行之后的续翻页码：服务端列表已经整体前移，再按「上一页 + 1」取会漏掉移进上一页的那几项。
 * 改取「第一个还没加载的偏移」所在的那一页，重叠的部分靠按 id 去重消掉。
 */
export function pageForOffset(loadedCount: number, pageSize: number) {
  const size = Math.max(1, Math.floor(pageSize) || 1)
  const count = Math.max(0, Math.floor(loadedCount) || 0)
  return Math.floor(count / size) + 1
}

/**
 * 创作台列表分页：首屏重置、上拉追加、按 id 去重。
 * fetch 在调用时读取最新筛选条件（keyword / type 等）。
 * 首次完成前 busy 为真（骨架屏）；刷新失败保留上一份列表；空列表只在成功且总数为 0 时出现。
 * cacheKey / cache：从画布返回时页面会重挂，用快照先画出上一份列表，后台再刷新。
 */
export function useStudioPaged<T extends { id: number | string }>(options: {
  pageSize?: number
  cacheKey?: string
  cache?: { value: PagedSnap<T> | null }
  fetch: (page: number, pageSize: number) => Promise<PagedResult<T> | null | undefined>
}) {
  const pageSize = options.pageSize ?? 24
  const cache = options.cache ?? (options.cacheKey
    ? useState<PagedSnap<T> | null>(`studio-paged:${options.cacheKey}`, () => null)
    : null)
  const snap = cache?.value
  const items = ref<T[]>(snap?.items?.slice() ?? []) as Ref<T[]>
  const page = ref(snap?.page ?? 1)
  const total = ref(snap?.total ?? 0)
  const loading = ref(false)
  const loadingMore = ref(false)
  const loaded = ref(Boolean(snap?.loaded && (snap.items?.length || snap.total === 0)))
  const failed = ref(false)

  function persist() {
    if (!cache)
      return
    cache.value = {
      items: items.value.slice(),
      page: page.value,
      total: total.value,
      loaded: loaded.value,
    }
  }
  let seq = 0
  /** 上次取数之后本地删过行（removeById），下一次续翻要按偏移重算页码 */
  let removals = 0
  let syncedRemovals = 0

  const hasMore = computed(() => loaded.value && items.value.length < total.value)
  /** 还没成功过、也还没失败过：给列表留出骨架屏，避免先闪「暂无」 */
  const busy = computed(() => !loaded.value && !failed.value && items.value.length === 0)

  async function load(reset: boolean, nextPage?: number) {
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
    const target = reset ? 1 : (nextPage ?? page.value)
    const removalsAtStart = removals
    try {
      const data = await options.fetch(target, pageSize)
      if (current !== seq)
        return false
      if (!data) {
        if (reset) {
          page.value = previous.page
          items.value = previous.items
          total.value = previous.total
        }
        // 还有上一份列表时继续展示它；只有空着的时候才换成失败态，避免写成「暂无」
        failed.value = items.value.length === 0
        return false
      }
      const next = data.items ?? []
      page.value = target
      // 取数途中又删了行的话，这一页仍可能错位，留到下一次续翻再校正
      syncedRemovals = removalsAtStart
      if (reset)
        items.value = next
      else {
        const seen = new Set(items.value.map(item => item.id))
        items.value = [...items.value, ...next.filter(item => !seen.has(item.id))]
      }
      total.value = !reset && !next.length ? items.value.length : data.total
      loaded.value = true
      failed.value = false
      persist()
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
    // 页码只在取数成功后才前进；本地删过行就按偏移重算，避免漏掉前移的那一项
    const shifted = removals !== syncedRemovals
    await load(false, shifted ? pageForOffset(items.value.length, pageSize) : page.value + 1)
  }

  function removeById(id: number | string) {
    const before = items.value.length
    items.value = items.value.filter(item => item.id !== id)
    if (items.value.length < before) {
      total.value = Math.max(0, total.value - 1)
      removals += 1
      persist()
    }
  }

  function prepend(item: T) {
    const existed = items.value.some(row => row.id === item.id)
    items.value = [item, ...items.value.filter(row => row.id !== item.id)]
    if (!existed)
      total.value += 1
    persist()
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
