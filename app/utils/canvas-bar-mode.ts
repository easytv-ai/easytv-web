import { isContentNode, isGroupNode, type CanvasFlowNode } from '~/utils/canvas-group'
import { isDepthMotionNode, isFramePullNode } from '~/utils/canvas-node-kinds'
import { isMediaUrl } from '~/utils/media'

export type CanvasBarMode = 'pick' | 'group' | 'text' | 'image' | 'video' | 'audio'

/**
 * 选中工具条的模式。组优先；多选是框选条；单节点按类型，没媒体地址时不显示。
 */
export function canvasBarMode(
  selectedNodes: CanvasFlowNode[],
  selectedGroup: CanvasFlowNode | null | undefined,
): CanvasBarMode | null {
  if (selectedGroup && isGroupNode(selectedGroup)) {
    const extra = selectedNodes.filter(node => node.parentNode !== selectedGroup.id)
    if (!extra.length)
      return 'group'
  }
  if (selectedNodes.length >= 2)
    return 'pick'
  const node = selectedNodes[0]
  if (!node || !isContentNode(node))
    return null
  if (node.data.kind === 'text')
    return 'text'
  const src = node.data.content?.trim() || ''
  if (!src || !isMediaUrl(src))
    return null
  if (node.data.kind === 'image')
    return 'image'
  if (node.data.kind === 'video') {
    if (isFramePullNode(node.data) || isDepthMotionNode(node.data))
      return null
    return 'video'
  }
  if (node.data.kind === 'audio')
    return 'audio'
  return null
}
