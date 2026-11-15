/**
 * 榜单取数的两件事（纯逻辑，页面与测试共用）：
 * 1. 按「榜 + 周期」分别缓存行数据，周 / 月互不覆盖；过期后重新取，页面 keepalive 也不会一直是旧榜。
 * 2. 只认最后一次切换：快速切换时，先发出的请求晚回来也不能盖住当前这一档。
 */
export const RANK_CACHE_TTL_MS = 10 * 60 * 1000

export function rankCacheKey(tab: string, period: string) {
  return `${tab}-${period}`
}

export function createRankCache<T>(ttlMs = RANK_CACHE_TTL_MS) {
  const store = new Map<string, { rows: T, at: number }>()
  return {
    get(key: string, now = Date.now()): T | undefined {
      const hit = store.get(key)
      if (!hit)
        return undefined
      if (now - hit.at >= ttlMs) {
        store.delete(key)
        return undefined
      }
      return hit.rows
    },
    set(key: string, rows: T, now = Date.now()) {
      store.set(key, { rows, at: now })
    },
  }
}

export function createLatestGuard() {
  let seq = 0
  return {
    /** 开始一次新的切换，之前发出的请求全部作废 */
    begin() {
      return ++seq
    },
    isCurrent(token: number) {
      return token === seq
    },
  }
}
