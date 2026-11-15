import { describe, expect, it } from 'vitest'
import { createLatestGuard, createRankCache, rankCacheKey } from './rank-cache'

describe('榜单缓存', () => {
  it('周 → 月 → 周：同一个榜的两个周期各存各的，切回周拿到的还是周榜', () => {
    const cache = createRankCache<string[]>()
    cache.set(rankCacheKey('works', 'week'), ['周榜第一'], 0)
    cache.set(rankCacheKey('works', 'month'), ['月榜第一'], 0)
    expect(cache.get(rankCacheKey('works', 'week'), 1)).toEqual(['周榜第一'])
    expect(cache.get(rankCacheKey('works', 'month'), 1)).toEqual(['月榜第一'])
    expect(cache.get(rankCacheKey('authors', 'week'), 1)).toBeUndefined()
  })

  it('过期后不再命中，回到页面会重新取数', () => {
    const cache = createRankCache<string[]>(1000)
    cache.set('works-week', ['a'], 0)
    expect(cache.get('works-week', 999)).toEqual(['a'])
    expect(cache.get('works-week', 1000)).toBeUndefined()
  })
})

describe('榜单切换竞态', () => {
  it('快速切换时只有最后一次的结果算数', () => {
    const guard = createLatestGuard()
    const week = guard.begin()
    const month = guard.begin()
    expect(guard.isCurrent(week)).toBe(false)
    expect(guard.isCurrent(month)).toBe(true)
  })

  it('周请求晚于月请求返回：结果进周的缓存，但不盖住正在看的月榜', async () => {
    const cache = createRankCache<string[]>()
    const guard = createLatestGuard()
    let shown: string[] = []
    const pending: Record<string, (rows: string[]) => void> = {}
    async function load(period: string) {
      const key = rankCacheKey('works', period)
      const token = guard.begin()
      const rows = await new Promise<string[]>((resolve) => {
        pending[period] = resolve
      })
      cache.set(key, rows)
      if (guard.isCurrent(token))
        shown = rows
    }
    const a = load('week')
    const b = load('month')
    pending.month!(['月榜'])
    pending.week!(['周榜'])
    await Promise.all([a, b])
    expect(shown).toEqual(['月榜'])
    expect(cache.get('works-week')).toEqual(['周榜'])
  })
})
