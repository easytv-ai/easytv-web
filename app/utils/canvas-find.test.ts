import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { filterFindableNodes, findKindLabel, stepFindableIndex, type CanvasFindItem } from './canvas-find'

const items: CanvasFindItem[] = [
  { id: 'video-1', label: '开场镜头', kind: 'video', prompt: '黄昏公路' },
  { id: 'image-2', label: '角色定妆', kind: 'image', prompt: '红衣女子' },
  { id: 'text-3', label: '旁白', kind: 'text', prompt: '' },
]

describe('filterFindableNodes', () => {
  it('空查询返回前 20 条', () => {
    expect(filterFindableNodes(items, '  ').map(item => item.id)).toEqual(['video-1', 'image-2', 'text-3'])
  })

  it('按名称 / 类型 / 提示词 / id 过滤', () => {
    expect(filterFindableNodes(items, '定妆').map(item => item.id)).toEqual(['image-2'])
    expect(filterFindableNodes(items, 'VIDEO').map(item => item.id)).toEqual(['video-1'])
    expect(filterFindableNodes(items, '公路').map(item => item.id)).toEqual(['video-1'])
    expect(filterFindableNodes(items, 'text-3').map(item => item.id)).toEqual(['text-3'])
  })

  it('工作区接了查找面板和 ⌘0 适应选中', () => {
    const ws = readFileSync('app/components/canvas/CanvasWorkspace.vue', 'utf8')
    expect(ws).toContain('<CanvasFind')
    expect(ws).toContain('fitBoxZoom')
    expect(ws).toContain('openFind')
    expect(ws).toContain('findStep')
    expect(ws).toMatch(/function onFindPick\(id: string\) \{\s*locateNode\(id\)\s*\}/)
    const find = readFileSync('app/components/canvas/CanvasFind.vue', 'utf8')
    expect(find).toContain('ArrowDown')
    expect(find).toContain('F3')
    expect(find).toContain('activeIndex')
  })

  it('F3 在命中列表里绕圈', () => {
    expect(stepFindableIndex(items, 'video-1', 1)).toBe(1)
    expect(stepFindableIndex(items, 'text-3', 1)).toBe(0)
    expect(stepFindableIndex(items, 'video-1', -1)).toBe(2)
    expect(stepFindableIndex(items, 'missing', 1)).toBe(0)
  })

  it('类型文案跟节点菜单同一套，可翻译', () => {
    expect(findKindLabel('image')).toBe('图片')
    expect(findKindLabel('video')).toBe('视频')
    expect(findKindLabel('group')).toBe('组')
    expect(findKindLabel('image', key => key === '图片' ? 'Image' : key)).toBe('Image')
    expect(findKindLabel('unknown')).toBe('unknown')
    expect(filterFindableNodes([{ ...items[1]!, kindLabel: '图片' }], '图片').map(item => item.id)).toEqual(['image-2'])
  })

  it('查找浮层挡住画布，点空白关闭，列表用 kindLabel', () => {
    const find = readFileSync('app/components/canvas/CanvasFind.vue', 'utf8')
    expect(find).toContain('canvas-find-layer')
    expect(find).toContain('@pointerdown.self="emit(\'close\')"')
    expect(find).toContain('item.kindLabel || item.kind')
    const css = readFileSync('app/assets/css/studio-parts/canvas.css', 'utf8')
    expect(css).toMatch(/\.canvas-find-layer\s*\{[^}]*pointer-events:\s*auto/)
    expect(css).toMatch(/\.canvas-find\s*\{[^}]*pointer-events:\s*auto/)
    const ws = readFileSync('app/components/canvas/CanvasWorkspace.vue', 'utf8')
    expect(ws).toContain('kindLabel: findKindLabel(kind, t)')
  })
})
