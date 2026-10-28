import type { Connection } from '@vue-flow/core'
import { nextTick, type Ref } from 'vue'
import { isContentNode, isNodeLocked, type CanvasFlowNode } from '~/utils/canvas-group'
import type { CanvasNodeData } from '~/utils/canvas-node-kinds'

/** false = 软同步，true = 强制覆盖，'append' = 追加到用户提示词末尾 */
export type CanvasConnectSyncMode = boolean | 'append'
export type CanvasConnectSyncResult = 'replaced' | 'appended' | null

export function canvasIsAutoConnectedPrompt(text: string) {
  return /^@图片\d/.test(text) || /@图片节点/.test(text) || /^@文本\d/.test(text)
}

/**
 * 连线后同步提示词 / 参考图，以及把选中节点按顺序串起来。
 */
export function useCanvasConnect(opts: {
  nodes: Ref<CanvasFlowNode[]>
  edges: Ref<Array<{ source: string, target: string }>>
  findNode: (id: string) => CanvasFlowNode | undefined
  updateNodeData: (id: string, patch: Record<string, unknown>) => void
  addEdges: (edge: any) => void
  defaultEdgeOptions: { type: string, animated: boolean }
  pushHistory: () => void
  nodePlainText: (node: CanvasFlowNode) => string
  /** 连线把上游文本追加进了提示词（连接选中等无自己提示入口的路径用）：提示可撤销 */
  onPromptAppended?: () => void
}) {
  function neighborIds(id: string) {
    const ids: string[] = []
    for (const edge of opts.edges.value) {
      if (edge.target === id)
        ids.push(edge.source)
      else if (edge.source === id)
        ids.push(edge.target)
    }
    return ids
  }

  function connectedImageNodes(mediaId: string) {
    const images: Array<CanvasFlowNode & { data: CanvasNodeData }> = []
    const seen = new Set<string>()
    for (const otherId of neighborIds(mediaId)) {
      if (seen.has(otherId))
        continue
      const other = opts.findNode(otherId)
      if (!other || !isContentNode(other) || other.data.kind !== 'image')
        continue
      seen.add(otherId)
      images.push(other)
    }
    return images.sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
  }

  /** 上游各文本节点的纯文本（按邻接顺序），追加模式按段去重要用到 */
  function connectedTextParts(mediaId: string) {
    const parts: string[] = []
    const seen = new Set<string>()
    for (const otherId of neighborIds(mediaId)) {
      if (seen.has(otherId))
        continue
      const other = opts.findNode(otherId)
      if (!other || !isContentNode(other) || other.data.kind !== 'text')
        continue
      seen.add(otherId)
      const copy = opts.nodePlainText(other)
      if (copy)
        parts.push(copy)
    }
    return parts
  }

  function connectedTextPrompt(mediaId: string) {
    return connectedTextParts(mediaId).join('\n\n')
  }

  function isAutoConnectedPrompt(text: string) {
    return canvasIsAutoConnectedPrompt(text)
  }

  function attachConnectedImages(mediaId: string, force = false) {
    const media = opts.findNode(mediaId)
    if (!media || !isContentNode(media))
      return
    if (media.data.kind !== 'video' && media.data.kind !== 'director')
      return
    const images = connectedImageNodes(mediaId).filter(node => node.data.assetId && node.data.content?.trim())
    if (!images.length)
      return
    const first = images[0]
    const last = images.length > 1 ? images[images.length - 1] : null
    const patch: Record<string, unknown> = {}
    if (first && (force || !media.data.refAssetId)) {
      patch.refAssetId = first.data.assetId
      patch.refUrl = first.data.content
    }
    if (last && last.id !== first?.id && (force || !media.data.lastAssetId)) {
      patch.lastAssetId = last.data.assetId
      patch.lastUrl = last.data.content
    }
    if (Object.keys(patch).length)
      opts.updateNodeData(mediaId, patch)
  }

  function mediaMatches(peer: CanvasNodeData, assetId?: number, url?: string) {
    const stored = String(url || '').trim()
    const content = String(peer.content || '').trim()
    const id = Number(assetId) || 0
    const peerId = Number(peer.assetId) || 0
    if (id > 0 && peerId > 0 && id === peerId)
      return true
    return Boolean(stored && content && stored === content)
  }

  /**
   * 连线时会把上游图片抄进接收节点的参考 / 尾帧。
   * 剪断那条线时清掉这份抄来的字段；节点上自己上传的参考（refItems）留着。
   */
  function detachCopiedRef(mediaId: string, peerId: string) {
    const media = opts.findNode(mediaId)
    const peer = opts.findNode(peerId)
    if (!media || !isContentNode(media) || !peer || !isContentNode(peer))
      return
    if ((media.data.kind !== 'video' && media.data.kind !== 'director') || peer.data.kind !== 'image')
      return
    const uploads = Array.isArray(media.data.refItems) ? media.data.refItems : []
    const uploaded = uploads.some(item => mediaMatches(peer.data, item.assetId, item.url))
    const patch: Record<string, unknown> = {}
    if (!uploaded && mediaMatches(peer.data, media.data.refAssetId, media.data.refUrl)) {
      patch.refAssetId = undefined
      patch.refUrl = ''
    }
    if (mediaMatches(peer.data, media.data.lastAssetId, media.data.lastUrl)) {
      patch.lastAssetId = undefined
      patch.lastUrl = ''
    }
    if (Object.keys(patch).length)
      opts.updateNodeData(mediaId, patch)
  }

  /** 剪断一条线：接收端如果抄了这条线的图片，参考和尾帧一起去掉 */
  function detachLinkedRef(edge: { source: string, target: string }) {
    detachCopiedRef(edge.target, edge.source)
    detachCopiedRef(edge.source, edge.target)
  }

  /**
   * 同步模式：
   * - false（软同步）：下游提示词为空或本来就是自动写入的才填；
   * - true（强制）：上游文本直接盖掉下游提示词（程序化自动连线用）；
   * - 'append'（手拖连线）：用户写过的提示词不盖，把还没出现在里面的上游文本追加到末尾。
   */
  function syncConnectedPrompt(mediaId: string, mode: CanvasConnectSyncMode = false): CanvasConnectSyncResult {
    const media = opts.findNode(mediaId)
    if (!media || !isContentNode(media))
      return null
    const kind = media.data.kind
    if (kind !== 'image' && kind !== 'video' && kind !== 'director')
      return null
    const force = mode === true
    const parts = connectedTextParts(mediaId)
    const next = parts.join('\n\n')
    const raw = String(media.data.prompt || '')
    const current = raw.trim()
    let result: CanvasConnectSyncResult = null
    if (next) {
      if (!current || isAutoConnectedPrompt(current)) {
        if (current !== next) {
          opts.updateNodeData(mediaId, { prompt: next })
          result = 'replaced'
        }
      }
      else if (mode === 'append') {
        const missing = parts.filter(part => !current.includes(part))
        if (missing.length) {
          opts.updateNodeData(mediaId, { prompt: `${raw.trimEnd()}\n\n${missing.join('\n\n')}` })
          result = 'appended'
        }
      }
      else if (force && current !== next) {
        opts.updateNodeData(mediaId, { prompt: next })
        result = 'replaced'
      }
    }
    else if (current && isAutoConnectedPrompt(current)) {
      opts.updateNodeData(mediaId, { prompt: '' })
      result = 'replaced'
    }
    if (kind === 'video' || kind === 'director')
      attachConnectedImages(mediaId, force)
    return result
  }

  /**
   * 连一条线并同步两端提示词。缺省 force（程序化自动连线：上游文本直接盖下游提示词）；
   * 手拖连线等用户手势传 `{ mode: 'append' }`，用户写过的提示词只追加不盖；
   * 「从画布添加参考」这类只是补一条参考线的入口传 `{ force: false }`，只在下游提示词为空或本来就是自动同步的时才填。
   * 返回两端里最"重"的同步结果：有一端追加了就是 'appended'，方便调用方提示可撤销。
   */
  function linkNodes(connection: Connection, linkOpts: { force?: boolean, mode?: 'append', onLater?: (result: CanvasConnectSyncResult) => void } = {}): CanvasConnectSyncResult {
    const mode: CanvasConnectSyncMode = linkOpts.mode === 'append' ? 'append' : (linkOpts.force ?? true)
    opts.addEdges({
      ...connection,
      id: `e-${connection.source}-${connection.target}-${Date.now()}`,
      ...opts.defaultEdgeOptions,
    })
    const ends = [connection.target, connection.source].filter((id): id is string => Boolean(id))
    const strongest = (results: CanvasConnectSyncResult[]): CanvasConnectSyncResult =>
      results.includes('appended') ? 'appended' : results.includes('replaced') ? 'replaced' : null
    const now = strongest(ends.map(id => syncConnectedPrompt(id, mode)))
    // vue-flow 的 addEdges 走变更队列，这一刻 edges 里往往还没有这条线（同步那次什么都没做）：
    // 下一拍再同步一次，结果交给 onLater（追加成功要提示可撤销）
    nextTick(() => {
      const later = strongest(ends.map(id => syncConnectedPrompt(id, mode)))
      if (later || now)
        linkOpts.onLater?.(later || now)
    })
    return now
  }

  function connectionLocked(sourceId?: string | null, targetId?: string | null) {
    const list = opts.nodes.value
    return isNodeLocked(opts.findNode(sourceId || ''), list) || isNodeLocked(opts.findNode(targetId || ''), list)
  }

  function isValidConnection(connection: Connection) {
    if (!connection.source || !connection.target || connection.source === connection.target)
      return false
    // 只有右侧出口 → 左侧入口。左侧对左侧会把拖动起点当成接收端，参考记反
    if (connection.sourceHandle !== 'out' || connection.targetHandle !== 'in')
      return false
    return !connectionLocked(connection.source, connection.target)
  }

  function connectSelected() {
    const picked = opts.nodes.value.filter(node => (node as { selected?: boolean }).selected)
    if (picked.length < 2)
      return
    let linked = false
    for (let i = 0; i < picked.length - 1; i++) {
      const source = picked[i]
      const target = picked[i + 1]
      if (!source || !target || source.id === target.id)
        continue
      if (connectionLocked(source.id, target.id))
        continue
      if (opts.edges.value.some(edge => edge.source === source.id && edge.target === target.id))
        continue
      linked = true
      linkNodes({
        source: source.id,
        target: target.id,
        sourceHandle: 'out',
        targetHandle: 'in',
      }, {
        mode: 'append',
        onLater: (result) => {
          if (result !== 'appended')
            return
          opts.pushHistory()
          opts.onPromptAppended?.()
        },
      })
    }
    if (linked)
      opts.pushHistory()
  }

  return {
    neighborIds,
    connectedImageNodes,
    connectedTextParts,
    connectedTextPrompt,
    isAutoConnectedPrompt,
    attachConnectedImages,
    detachLinkedRef,
    syncConnectedPrompt,
    linkNodes,
    isValidConnection,
    connectSelected,
  }
}
