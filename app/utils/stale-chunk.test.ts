import { describe, expect, it } from 'vitest'
import { isStaleChunkError } from './stale-chunk'

describe('isStaleChunkError', () => {
  it('认线上那条动态 import 404', () => {
    expect(isStaleChunkError(new TypeError('Failed to fetch dynamically imported module: https://www.easytv.ai/_nuxt/Dl2zpkNW.js'))).toBe(true)
  })

  it('其它错误不当成发版过期', () => {
    expect(isStaleChunkError(new Error('作品加载失败'))).toBe(false)
    expect(isStaleChunkError(null)).toBe(false)
  })
})
