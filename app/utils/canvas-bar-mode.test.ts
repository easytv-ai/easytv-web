import { describe, expect, it } from 'vitest'
import { canvasBarMode } from './canvas-bar-mode'
import type { CanvasFlowNode } from './canvas-group'

function node(id: string, kind: string, extra: Record<string, unknown> = {}): CanvasFlowNode {
  return {
    id,
    type: 'easytv',
    position: { x: 0, y: 0 },
    data: { kind, label: id, content: extra.content ?? '', ...extra },
  } as CanvasFlowNode
}

describe('canvasBarMode', () => {
  it('只选中组时是 group', () => {
    const group = {
      id: 'group-1',
      type: 'group',
      position: { x: 0, y: 0 },
      data: { kind: 'group', label: '组 1', color: '#eee', layout: 'row' },
    } as CanvasFlowNode
    const kid = { ...node('image-1', 'image', { content: 'https://a.png' }), parentNode: 'group-1' }
    expect(canvasBarMode([kid], group)).toBe('group')
  })

  it('多选内容节点是 pick', () => {
    expect(canvasBarMode([
      node('a', 'image', { content: 'https://a.png' }),
      node('b', 'image', { content: 'https://b.png' }),
    ], null)).toBe('pick')
  })

  it('单文本是 text；图片要有媒体地址', () => {
    expect(canvasBarMode([node('t', 'text')], null)).toBe('text')
    expect(canvasBarMode([node('i', 'image')], null)).toBeNull()
    expect(canvasBarMode([node('i', 'image', { content: 'https://a.png' })], null)).toBe('image')
  })

  it('拉片 / 深度动作节点不显示视频条', () => {
    expect(canvasBarMode([node('v', 'video', { content: 'https://a.mp4', tag: '逐帧拉片' })], null)).toBeNull()
  })
})
