import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('设置页产品面', () => {
  it('我的作品按标题搜索，走 GET /user/work keyword', () => {
    const src = readFileSync('app/pages/settings/components/settings-works.vue', 'utf8')
    expect(src).toContain('account.work.searchTitle')
    expect(src).toContain('keyword: q || undefined')
  })

  it('不开放自备密钥 Tab，也不引用 BYOK 常量', () => {
    const src = readFileSync('app/pages/settings/index.vue', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(src).not.toContain("id: 'byok'")
    expect(src).not.toContain('byokProviders')
    expect(src).not.toContain('settings-byok')
    expect(src).toContain("type Tab = 'profile'")
  })
})
