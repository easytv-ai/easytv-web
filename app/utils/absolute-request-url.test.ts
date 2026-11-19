import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const plugin = readFileSync('server/plugins/absolute-request-url.ts', 'utf8')
const config = readFileSync('nuxt.config.ts', 'utf8')

describe('开发时图标接口 Invalid URL', () => {
  it('请求钩子把相对路径补成绝对地址，避免 h3 getQuery 抛 Invalid URL', () => {
    expect(plugin).toContain("nitro.hooks.hook('request'")
    expect(plugin).toContain('new URL(raw, `${proto}://${host}`)')
    expect(plugin).toContain('Object.defineProperty(req, \'url\'')
    expect(plugin).toContain('queueMicrotask')
    expect(plugin).toContain('hooks.unshift(absoluteRequestUrl)')
    expect(plugin).toContain('/api/_nuxt_icon')
  })

  it('扫描 Lucide 打进客户端包，少打图标接口', () => {
    expect(config).toContain('clientBundle')
    expect(config).toContain('scan: true')
  })
})
