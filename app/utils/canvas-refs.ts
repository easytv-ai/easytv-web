import { isContentNode, type CanvasFlowNode } from '~/utils/canvas-group'
import type { CanvasNodeKind } from '~/utils/canvas-node-kinds'
import { isMediaUrl } from '~/utils/media'

export type CanvasAttachKey = 'ref' | 'first' | 'style' | 'voice' | 'cast' | 'set' | 'last'

export const CANVAS_ATTACH_FIELD: Record<CanvasAttachKey, { id: string, url: string, role: string }> = {
  ref: { id: 'refAssetId', url: 'refUrl', role: 'reference' },
  first: { id: 'refAssetId', url: 'refUrl', role: 'first_frame' },
  style: { id: 'styleAssetId', url: 'styleUrl', role: 'style' },
  voice: { id: 'voiceAssetId', url: 'voiceUrl', role: 'voice' },
  cast: { id: 'castAssetId', url: 'castUrl', role: 'character' },
  set: { id: 'setAssetId', url: 'setUrl', role: 'scene' },
  last: { id: 'lastAssetId', url: 'lastUrl', role: 'last_frame' },
}

export function canvasAttachThumbKind(key: CanvasAttachKey, url: string): 'image' | 'video' | 'audio' {
  if (key === 'voice')
    return 'audio'
  if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(url))
    return 'video'
  if (/\.(mp3|wav|m4a|aac|ogg)(\?|$)/i.test(url))
    return 'audio'
  return 'image'
}

export function canvasNodeImageUrl(node: CanvasFlowNode) {
  if (!isContentNode(node) || node.data.kind !== 'image')
    return ''
  const url = String(node.data.content || '').trim()
  return url && isMediaUrl(url) ? url : ''
}

export function canvasNodeMediaUrl(node: CanvasFlowNode) {
  if (!isContentNode(node))
    return ''
  if (node.data.kind === 'image')
    return canvasNodeImageUrl(node)
  const url = String(node.data.content || '').trim()
  return url && isMediaUrl(url) ? url : ''
}

/** 参考素材可选类型：视频节点（全能参考）收图片 / 视频 / 音频，音频节点收音频，其余只收图片 */
export function canvasRefAcceptFor(kind?: string): Array<'image' | 'video' | 'audio'> {
  if (kind === 'audio')
    return ['audio']
  if (kind === 'video' || kind === 'director')
    return ['image', 'video', 'audio']
  return ['image']
}

/** 按扩展名判断参考素材是图片 / 视频 / 音频（refItems 只存了地址） */
export function canvasMediaKindOfUrl(url: string): 'image' | 'video' | 'audio' {
  const path = String(url || '').split(/[?#]/)[0]!.toLowerCase()
  if (/\.(mp4|mov|webm|m4v|mkv)$/.test(path))
    return 'video'
  if (/\.(mp3|wav|m4a|aac|ogg|flac)$/.test(path))
    return 'audio'
  return 'image'
}

export function canvasUploadedRefList(data: any): Array<{ assetId?: number, url: string, name?: string }> {
  if (!data)
    return []
  if (Array.isArray(data.refItems) && data.refItems.length) {
    return data.refItems
      // name 是选入时记的资产名（智能引用的标签文案），老数据没有就留空
      .map((item: any) => ({ assetId: item?.assetId, url: String(item?.url || '').trim(), name: item?.name ? String(item.name).trim() : undefined }))
      .filter((item: { url: string }) => item.url)
  }
  const url = String(data.refUrl || '').trim()
  if (url)
    return [{ assetId: data.refAssetId, url }]
  return []
}

export function canvasSyncRefFields(items: Array<{ assetId?: number, url: string, name?: string }>) {
  return {
    refItems: items,
    refUrl: items[0]?.url || '',
    refAssetId: items[0]?.assetId,
  }
}

export type CanvasRefPeer = {
  id: string
  kind?: string
  assetId?: number
  url?: string
}

export type CanvasConnectedRef = {
  id: string
  edgeId: string
  url: string
  kind: 'image' | 'video' | 'audio'
  assetId?: number
}

/**
 * 连进当前节点的参考。只算上游 → 当前节点；从当前节点连出去的下游图不是参考。
 * 图片连线一直算（首帧 / 参考图）；
 * 视频、音频只在目标节点收这类素材时算，例如视频全能参考连着原片。
 */
export function canvasConnectedRefs(
  nodeId: string,
  targetKind: string | undefined,
  edges: Array<{ id?: string, source: string, target: string }>,
  peer: (id: string) => CanvasRefPeer | null,
): CanvasConnectedRef[] {
  const accept = canvasRefAcceptFor(targetKind)
  const items: CanvasConnectedRef[] = []
  const seen = new Set<string>()
  for (const edge of edges) {
    if (edge.target !== nodeId)
      continue
    const otherId = edge.source
    if (!otherId || otherId === nodeId || seen.has(otherId))
      continue
    const other = peer(otherId)
    if (!other)
      continue
    const kind = other.kind
    if (kind !== 'image' && kind !== 'video' && kind !== 'audio')
      continue
    if (kind !== 'image' && !accept.includes(kind))
      continue
    const url = String(other.url || '').trim()
    if (!url)
      continue
    seen.add(otherId)
    items.push({
      id: other.id,
      edgeId: edge.id || `${edge.source}-${edge.target}`,
      url,
      kind,
      assetId: other.assetId,
    })
  }
  return items
}

export function canvasAssetNodeKind(asset: { type?: string }): CanvasNodeKind | null {
  if (asset.type === 'image')
    return 'image'
  if (asset.type === 'video')
    return 'video'
  if (asset.type === 'audio')
    return 'audio'
  return null
}
