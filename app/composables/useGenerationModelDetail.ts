import taskApi from '~/api/task'
import type { GenerationModelDetail } from '~/types/creative'
import { resolveAcceptLanguageHeader } from '~/utils/acceptLanguage'

type CacheEntry = {
  detail: GenerationModelDetail | null
  /** 请求失败时仍缓存，避免菜单反复打接口 */
  failed: boolean
  at: number
}

/** 图标名几乎不变，成功结果按会话保留；失败仍短缓存，避免菜单反复打接口 */
const OK_TTL = 30 * 60_000
const ERR_TTL = 30_000
const PREFETCH_CONCURRENCY = 4
const ICON_STORE_KEY = 'easytv-model-icons'

function readIconStore(): Record<string, string> {
  if (!import.meta.client)
    return {}
  try {
    const raw = sessionStorage.getItem(ICON_STORE_KEY)
    if (!raw)
      return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object')
      return {}
    const out: Record<string, string> = {}
    for (const [model, icon] of Object.entries(parsed)) {
      const name = String(icon || '').trim()
      if (name)
        out[model] = name
    }
    return out
  }
  catch {
    return {}
  }
}

function persistIcon(model: string, detail: GenerationModelDetail | null) {
  if (!import.meta.client || !detail)
    return
  const icon = String(detail.icon || (detail as any).vendor?.icon || '').trim()
  if (!icon)
    return
  const store = readIconStore()
  if (store[model] === icon)
    return
  store[model] = icon
  try {
    sessionStorage.setItem(ICON_STORE_KEY, JSON.stringify(store))
  }
  catch {
    // 配额满时丢掉即可，下次再写
  }
}

function storedIcon(model: string): string {
  return readIconStore()[model] || ''
}

async function runPool(names: string[], worker: (name: string) => Promise<unknown>) {
  const queue = [...names]
  const size = Math.min(PREFETCH_CONCURRENCY, queue.length)
  await Promise.all(Array.from({ length: size }, async () => {
    while (queue.length) {
      const name = queue.shift()
      if (name)
        await worker(name)
    }
  }))
}

/**
 * 模型详情缓存（GET /generation/models/detail）。
 * 键 = 模型 + Accept-Language；跨组件共享，只在真正要展示图标或打开菜单时按需拉。
 */
export function useGenerationModelDetail() {
  const cache = useState<Record<string, CacheEntry>>('generation-model-detail-cache', () => ({}))
  const inflight = useState<Record<string, Promise<GenerationModelDetail | null>>>('generation-model-detail-inflight', () => ({}))

  function cacheKey(model: string) {
    return `${String(model || '').trim()}|${resolveAcceptLanguageHeader()}`
  }

  function readCache(model: string): GenerationModelDetail | null | undefined {
    const key = cacheKey(model)
    const hit = cache.value[key]
    if (!hit)
      return undefined
    const ttl = hit.failed ? ERR_TTL : OK_TTL
    if (Date.now() - hit.at > ttl) {
      const next = { ...cache.value }
      delete next[key]
      cache.value = next
      return undefined
    }
    return hit.detail
  }

  function writeCache(model: string, detail: GenerationModelDetail | null, failed: boolean) {
    const key = cacheKey(model)
    cache.value = {
      ...cache.value,
      [key]: { detail, failed, at: Date.now() },
    }
    if (!failed)
      persistIcon(model, detail)
  }

  async function load(model: string): Promise<GenerationModelDetail | null> {
    const name = String(model || '').trim()
    if (!name)
      return null
    const cached = readCache(name)
    if (cached !== undefined)
      return cached

    const key = cacheKey(name)
    const pending = inflight.value[key]
    if (pending)
      return pending

    const job = (async () => {
      try {
        const res = await taskApi.modelDetail(name)
        if (res?.success && res.data) {
          writeCache(name, res.data as GenerationModelDetail, false)
          return res.data as GenerationModelDetail
        }
        writeCache(name, null, true)
        return null
      }
      catch {
        writeCache(name, null, true)
        return null
      }
      finally {
        const next = { ...inflight.value }
        delete next[key]
        inflight.value = next
      }
    })()

    inflight.value = { ...inflight.value, [key]: job }
    return job
  }

  /** 限并发预取（菜单打开时用），已缓存的跳过 */
  async function prefetch(models: string[]) {
    const names = [...new Set(models.map(m => String(m || '').trim()).filter(Boolean))]
    await runPool(names, name => load(name))
  }

  function peek(model: string): GenerationModelDetail | null {
    const hit = readCache(model)
    if (hit !== undefined)
      return hit
    const icon = storedIcon(model)
    return icon ? { icon } as GenerationModelDetail : null
  }

  return { load, prefetch, peek, readCache }
}
