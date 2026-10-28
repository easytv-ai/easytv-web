import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const cssDir = dirname(fileURLToPath(import.meta.url))

function importedPaths(source: string, fromFile: string) {
  return [...source.matchAll(/@import\s+['"]([^'"]+)['"]/g)]
    .map(match => match[1])
    .filter((path): path is string => Boolean(path))
    .map(path => resolve(dirname(fromFile), path))
}

describe('创作台样式入口', () => {
  it('全站基础不带画布和导演台', () => {
    const basePath = resolve(cssDir, 'studio-base.css')
    const base = readFileSync(basePath, 'utf8')
    const imports = importedPaths(base, basePath)
    expect(imports.map(path => path.replaceAll('\\', '/'))).toEqual([
      resolve(cssDir, 'studio-parts/tokens-auth.css').replaceAll('\\', '/'),
      resolve(cssDir, 'studio-parts/landing.css').replaceAll('\\', '/'),
      resolve(cssDir, 'studio-parts/chrome.css').replaceAll('\\', '/'),
      resolve(cssDir, 'studio-parts/pricing.css').replaceAll('\\', '/'),
    ])
    for (const abs of imports) {
      expect(existsSync(abs), abs).toBe(true)
      expect(dirname(abs)).not.toBe(resolve(cssDir, 'studio'))
    }
    expect(base).not.toContain('canvas.css')
    expect(base).not.toContain('panels.css')
    expect(base).not.toContain('features.css')
    expect(base).not.toContain('director.css')
  })

  it('创作台入口才引入动效令牌、画布、面板、功能和导演台', () => {
    const entryPath = resolve(cssDir, 'studio.css')
    const entry = readFileSync(entryPath, 'utf8')
    const imports = importedPaths(entry, entryPath).map(path => path.replaceAll('\\', '/'))
    // tokens-motion.css 是跟练与浮层共用的动效令牌（设计 §6.3：studio.css 第 1 行导入），随创作台入口一起加载
    expect(imports).toEqual([
      'tokens-motion',
      'canvas',
      'features',
      'director',
    ].map(name => resolve(cssDir, `studio-parts/${name}.css`).replaceAll('\\', '/')))
    for (const abs of imports)
      expect(existsSync(abs), abs).toBe(true)
    expect(readFileSync(resolve(cssDir, 'studio-parts/chrome.css'), 'utf8')).toContain('.canvas-tip {')
    expect(readFileSync(resolve(cssDir, 'studio-parts/pricing.css'), 'utf8')).toContain('.plan-modal {')
    expect(readFileSync(resolve(cssDir, 'studio-parts/canvas.css'), 'utf8')).toContain('.canvas-editor {')
    expect(readFileSync(resolve(cssDir, 'studio-parts/director.css'), 'utf8')).toContain('.cnode.is-panorama')
    expect(readFileSync(resolve(cssDir, 'studio-parts/director.css'), 'utf8')).not.toContain('.section-tabs {')
    expect(readFileSync(resolve(cssDir, 'studio-parts/layout.css'), 'utf8')).toContain('.section-tabs {')
  })

  it('头像菜单和最近项目跟创作台布局走', () => {
    const layout = readFileSync(resolve(cssDir, '../../layouts/studio.vue'), 'utf8')
    const canvasPage = readFileSync(resolve(cssDir, '../../pages/canvas/index.vue'), 'utf8')
    const shell = readFileSync(resolve(cssDir, 'studio-parts/shell.css'), 'utf8')
    expect(layout).toContain('studio-parts/shell.css')
    expect(canvasPage).toContain('studio-parts/shell.css')
    expect(shell).toContain('.user-menu {')
    expect(shell).toContain('.recent {')
    expect(shell).toContain('.inbox-panel {')
    expect(readFileSync(resolve(cssDir, 'studio-parts/director.css'), 'utf8')).not.toContain('.user-menu__trigger')
    expect(readFileSync(resolve(cssDir, 'studio-parts/features.css'), 'utf8')).not.toContain('.recent {')
    expect(readFileSync(resolve(cssDir, 'studio-base.css'), 'utf8')).not.toContain('shell.css')
  })

  it('面板样式按页面加载，不跟创作台布局走', () => {
    const layout = readFileSync(resolve(cssDir, '../../layouts/studio.vue'), 'utf8')
    const shell = readFileSync(resolve(cssDir, 'studio-parts/shell.css'), 'utf8')
    const panels = readFileSync(resolve(cssDir, 'studio-parts/panels.css'), 'utf8')
    const home = readFileSync(resolve(cssDir, '../../pages/studio/index.vue'), 'utf8')
    expect(layout).not.toContain('panels.css')
    expect(home).not.toContain('panels.css')
    expect(shell).toContain('.wallet-panel__body {')
    expect(shell).toContain('.notice-list {')
    expect(shell).toContain('.studio-chip__num {')
    expect(panels).toContain('.settings-layout {')
    expect(panels).not.toContain('.wallet-panel__body {')
    expect(panels).not.toContain('.notice-list {')
    for (const page of ['canvas/index.vue', 'settings/index.vue', 'tasks/index.vue', 'agent/index.vue']) {
      expect(readFileSync(resolve(cssDir, `../../pages/${page}`), 'utf8')).toContain('studio-parts/panels.css')
    }
  })

  it('增长页样式不跟创作台布局走', () => {
    const layout = readFileSync(resolve(cssDir, '../../layouts/studio.vue'), 'utf8')
    const shell = readFileSync(resolve(cssDir, 'studio-parts/growth.css'), 'utf8')
    const pages = readFileSync(resolve(cssDir, 'studio-parts/growth-pages.css'), 'utf8')
    const auth = readFileSync(resolve(cssDir, 'studio-parts/tokens-auth.css'), 'utf8')
    expect(layout).toContain('studio-parts/growth.css')
    expect(layout).not.toContain('growth-pages.css')
    expect(shell).toContain('.growth-tasks {')
    expect(shell).toContain('.studio-promo-banner {')
    expect(shell).toContain('.studio-hot {')
    expect(shell).not.toContain('.create-page {')
    expect(pages).toContain('.create-page {')
    expect(pages).toContain('.subject-grid {')
    expect(pages).not.toContain('.growth-tasks {')
    expect(auth).toContain('.xyq-invite-line {')
    expect(auth).toContain('.welcome-gift {')
    for (const page of ['create/index.vue', 'campaign/index.vue', 'subjects/index.vue', 'invite/[code].vue']) {
      expect(readFileSync(resolve(cssDir, `../../pages/${page}`), 'utf8')).toContain('studio-parts/growth-pages.css')
    }
    expect(readFileSync(resolve(cssDir, '../../pages/studio/index.vue'), 'utf8')).not.toContain('growth-pages.css')
  })

  it('画布聊天窄栏技能卡能收缩，工具条不拆字', () => {
    const css = readFileSync(resolve(cssDir, 'studio-parts/canvas.css'), 'utf8')
    expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
    expect(css).toContain('@container canvas-chat-skills (max-width: 360px)')
    expect(css).toMatch(/button\.canvas-chat__tool \{\s*flex-shrink: 0;/)
  })

  it('技能弹层分类条能在窄栏里横滑而不撑破', () => {
    const css = readFileSync(resolve(cssDir, 'studio-parts/panels.css'), 'utf8')
    expect(css).toMatch(/\.canvas-chat__chips \{\s*display: flex;\s*min-width: 0;/)
    expect(css).toMatch(/\.canvas-chat__pop--wide \{\s*display: flex;\s*min-width: 0;/)
  })
})
