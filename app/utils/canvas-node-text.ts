import { isContentNode, type CanvasFlowNode } from '~/utils/canvas-group'

/** 文本节点可见字：HTML 剥标签，纯文本直接 trim */
export function canvasNodePlainText(node: CanvasFlowNode) {
  if (!isContentNode(node))
    return ''
  const raw = node.data.content || ''
  if (!/<[a-z][\s\S]*>/i.test(raw))
    return raw.trim()
  const box = document.createElement('div')
  box.innerHTML = raw
  return (box.textContent || '').replace(/\u00a0/g, ' ').trim()
}
