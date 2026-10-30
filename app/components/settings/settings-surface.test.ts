import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('设置弹窗产品面', () => {
  it('我的作品按标题搜索，走 GET /user/work keyword', () => {
    const src = readFileSync('app/components/settings/settings-works.vue', 'utf8')
    expect(src).toContain('account.work.searchTitle')
    expect(src).toContain('keyword: q || undefined')
  })

  it('不开放自备密钥 Tab，也不引用 BYOK 常量', () => {
    const src = readFileSync('app/components/studio/StudioSettingsModal.vue', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const tabs = readFileSync('app/composables/useSettingsModal.ts', 'utf8')
    expect(src).not.toContain("id: 'byok'")
    expect(src).not.toContain('byokProviders')
    expect(src).not.toContain('settings-byok')
    expect(tabs).toContain("export type SettingsTab = 'profile'")
  })

  it('站内不再跳 /settings 页面，统一打开设置弹窗', () => {
    for (const file of [
      'app/components/studio/StudioUserMenu.vue',
      'app/components/studio/StudioWalletPanel.vue',
      'app/components/studio/StudioInbox.vue',
      'app/components/studio/StudioGrowthTasks.vue',
      'app/components/studio/StudioPublishModal.vue',
      'app/pages/author/[id].vue',
    ]) {
      const src = readFileSync(file, 'utf8')
      expect(src, file).not.toMatch(/path: '\/settings'|'\/settings\?|go\('\/settings'/)
      expect(src, file).toContain('openSettings(')
    }
  })
})
