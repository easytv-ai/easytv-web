import { describe, expect, it } from 'vitest'
import { canvasNodePlainText } from './canvas-node-text'
import type { CanvasFlowNode } from './canvas-group'

function text(content: string): CanvasFlowNode {
  return { id: 't-1', type: 'easytv', position: { x: 0, y: 0 }, data: { kind: 'text', label: '文', content } } as CanvasFlowNode
}

describe('canvasNodePlainText', () => {
  it('纯文本直接 trim', () => {
    expect(canvasNodePlainText(text('  hello  '))).toBe('hello')
  })

  it('非内容节点是空串', () => {
    const group = { id: 'g-1', type: 'group', position: { x: 0, y: 0 }, data: { kind: 'group', label: '组 1' } } as CanvasFlowNode
    expect(canvasNodePlainText(group)).toBe('')
  })
})
