import { describe, expect, it } from 'vitest'
import { isAllowedMediaHost, isAllowedMediaProtocol, isAllowedMediaUrl } from './media-hosts'

const hosts = new Set(['tv-oss.easyapi.com', 'localhost'])

describe('isAllowedMediaHost', () => {
  it('只放行配置域名，不放行别人的阿里云桶', () => {
    expect(isAllowedMediaHost('tv-oss.easyapi.com', hosts)).toBe(true)
    expect(isAllowedMediaHost('easytv.oss-cn-hangzhou.aliyuncs.com', hosts)).toBe(false)
    expect(isAllowedMediaHost('bkt.oss-cn-beijing.aliyuncs.com', hosts)).toBe(false)
    expect(isAllowedMediaHost('evil.com', hosts)).toBe(false)
  })
})

describe('isAllowedMediaUrl', () => {
  it('https 白名单与本地 http 可通过', () => {
    expect(isAllowedMediaProtocol('https:', 'tv-oss.easyapi.com')).toBe(true)
    expect(isAllowedMediaProtocol('http:', 'localhost')).toBe(true)
    expect(isAllowedMediaUrl(new URL('https://tv-oss.easyapi.com/a.mp4'), hosts)).toBe(true)
    expect(isAllowedMediaUrl(new URL('https://bkt.oss-cn-beijing.aliyuncs.com/a.mp4'), hosts)).toBe(false)
    expect(isAllowedMediaUrl(new URL('http://localhost:8383/upload/a.mp4'), hosts)).toBe(true)
    expect(isAllowedMediaUrl(new URL('https://example.com/a.mp4'), hosts)).toBe(false)
  })
})
