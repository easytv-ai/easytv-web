import { nextTick, type Ref } from 'vue'
import { isContentNode, nodeSize, nodesBounds, type CanvasFlowNode } from '~/utils/canvas-group'
import { canvasNextInsertOrigin } from '~/utils/canvas-viewport'
import {
  CANVAS_NODE_ITEMS,
  canvasFitMediaSize,
  canvasMediaSizeClose,
  canvasNodeTitle,
  canvasStageSize,
  type CanvasEmptyStart,
  type CanvasNodeData,
  type CanvasNodeKind,
} from '~/utils/canvas-node-kinds'
import { audioKindParams, audioKindTag } from '~/utils/canvas-audio'
import { defaultStoryboardShots } from '~/utils/canvas-storyboard'
import { canvasAssetNodeKind } from '~/utils/canvas-refs'
import type { Asset } from '~/types/creative'

const IMAGE_RATIOS = new Set(['21:9', '16:9', '9:16', '4:3', '3:4', '1:1'])

function frameRatioOf(ratio?: string) {
  return ratio && IMAGE_RATIOS.has(ratio) ? ratio : '4:3'
}

/**
 * 新建节点 / 空画布起步 / 对话栏插入。落点由调用方给。
 */
export function useCanvasAddNode(opts: {
  nodes: Ref<CanvasFlowNode[]>
  counts: Record<CanvasNodeKind, number>
  menu: Ref<unknown>
  addInto: Ref<string | null>
  canvasLocked: Ref<boolean>
  readonly: () => boolean
  /** 跟练只读：与 readonly / canvasLocked 分开的一档（跟练保留平移缩放，只有写入要停） */
  practiceLocked: () => boolean
  t: (key: string) => string
  addNodes: (node: CanvasFlowNode) => void
  findNode: (id: string) => CanvasFlowNode | undefined
  addSelectedNodes: (nodes: any[]) => void
  updateNode: (id: string, patch: Record<string, unknown>) => void
  updateNodeData: (id: string, patch: Record<string, unknown>) => void
  updateNodeInternals: (ids: string[]) => void
  pushHistory: () => void
  centerFlowPoint: () => { x: number, y: number }
}) {
  /**
   * 自增计数并返回 `${kind}-${n}`。addNode 与 apply_graph 落图（placeWorkflowGraph 的 newId）共用，
   * 保证两条路生成的 id 不会撞。
   */
  function nextId(kind: string) {
    const key = kind as CanvasNodeKind
    const n = (opts.counts[key] || 0) + 1
    opts.counts[key] = n
    return `${kind}-${n}`
  }

  function addNode(kind: CanvasNodeKind, x: number, y: number, parentId?: string | null, patch?: Partial<CanvasNodeData>) {
    const meta = CANVAS_NODE_ITEMS.find(item => item.kind === kind)
    if (!meta)
      return null
    const id = nextId(kind)
    const stage = canvasStageSize(kind)
    const node: CanvasFlowNode = {
      id,
      type: 'easytv',
      position: { x, y },
      data: {
        label: patch?.label || canvasNodeTitle(kind, opts.counts[kind], opts.t),
        content: '',
        prompt: '',
        mode: 'idle',
        ...patch,
        kind,
      },
      ...(stage
        ? { width: stage.w, height: stage.h, style: { width: `${stage.w}px`, height: `${stage.h}px` } }
        : {}),
    }
    if (kind === 'storyboard') {
      // 上面刚构造的 data 一定是内容节点数据，这里收窄一下类型
      const data = node.data as CanvasNodeData
      if (!data.storyboardShots)
        data.storyboardShots = defaultStoryboardShots()
    }
    if (parentId) {
      const kids = opts.nodes.value.filter(item => item.parentNode === parentId)
      let nextX = 28
      let nextY = 28
      for (const kid of kids) {
        const box = nodeSize(kid)
        nextX = Math.max(nextX, kid.position.x + box.w + 16)
        nextY = kid.position.y
      }
      node.position = { x: nextX, y: nextY }
      node.parentNode = parentId
      node.extent = 'parent'
      node.expandParent = true
    }
    opts.addNodes(node)
    opts.menu.value = null
    opts.addInto.value = null
    opts.pushHistory()
    nextTick(() => {
      const created = opts.findNode(id)
      if (created)
        opts.addSelectedNodes([created])
    })
    return id
  }

  function addNodeAtCenter(kind: CanvasNodeKind, patch?: Partial<CanvasNodeData>) {
    const center = opts.centerFlowPoint()
    const id = addNode(kind, center.x, center.y, opts.addInto.value, patch)
    if (id) {
      const created = opts.findNode(id)
      if (created)
        opts.addSelectedNodes([created])
      opts.pushHistory()
    }
    return id
  }

  function addEmptyStart(item: CanvasEmptyStart) {
    // 空画布起步卡在跟练里会露出来（选场景卡 / welcome 步没有 prepare，画布确实是空的），
    // 闸放在这一层：卡片换任何入口都落不下节点；跟练自己布节点走 addNode / addNodeAtCenter，不受影响。
    if (opts.readonly() || opts.canvasLocked.value || opts.practiceLocked())
      return
    const patch: Partial<CanvasNodeData> = { label: opts.t(item.label) }
    if ('prompt' in item && item.prompt)
      patch.prompt = item.prompt
    if ('videoMode' in item)
      patch.videoMode = item.videoMode
    if ('audioKind' in item && item.audioKind) {
      patch.params = audioKindParams(item.audioKind)
      patch.tag = audioKindTag(item.audioKind)
    }
    addNodeAtCenter(item.kind, patch)
  }

  function nextInsertOrigin() {
    const fallback = opts.centerFlowPoint()
    const all = opts.nodes.value
    const bounds = nodesBounds(all.filter(isContentNode), all)
    return canvasNextInsertOrigin(bounds, fallback)
  }

  function insertTextNode(text: string, label?: string) {
    const origin = nextInsertOrigin()
    const id = addNode('text', origin.x, origin.y, null)
    if (!id)
      return null
    opts.updateNodeData(id, { content: text, ...(label ? { label } : {}) })
    opts.pushHistory()
    return id
  }

  /** 角色或分镜图。有 fromId 时从该文本右侧单列排开，方便连线 */
  function insertImageNodes(items: { label: string, prompt: string, ratio?: string, group?: string, tag?: string }[], fromId?: string) {
    const list = items.filter(item => item.label.trim() && item.prompt.trim()).slice(0, 28)
    if (!list.length)
      return []
    const stage = canvasStageSize('image') || { w: 320, h: 220 }
    const from = fromId ? opts.findNode(fromId) : undefined
    const fromBox = from ? nodeSize(from) : null
    const gap = 24
    const origin = from && fromBox
      ? { x: from.position.x + fromBox.w + gap, y: from.position.y }
      : nextInsertOrigin()
    const cols = from ? 1 : Math.min(3, list.length)
    const ids: string[] = []
    list.forEach((item, index) => {
      const col = index % cols
      const row = Math.floor(index / cols)
      const id = addNode(
        'image',
        origin.x + col * (stage.w + gap),
        origin.y + row * (stage.h + gap),
        null,
        {
          label: item.label.trim(),
          prompt: item.prompt.trim(),
          tag: (item.tag || item.label).trim(),
          params: { ratio: frameRatioOf(item.ratio) },
        },
      )
      if (id)
        ids.push(id)
    })
    return ids
  }

  /** 音色锚点：落在文本下方，不和右侧分镜图叠在一起 */
  function insertAudioNodes(items: { label: string, prompt: string, group?: string, tag?: string }[], fromId?: string) {
    const list = items.filter(item => item.label.trim() && item.prompt.trim()).slice(0, 8)
    if (!list.length)
      return []
    const stage = canvasStageSize('audio') || { w: 280, h: 118 }
    const from = fromId ? opts.findNode(fromId) : undefined
    const fromBox = from ? nodeSize(from) : null
    const gap = 24
    const origin = from && fromBox
      ? { x: from.position.x, y: from.position.y + fromBox.h + gap }
      : nextInsertOrigin()
    const ids: string[] = []
    list.forEach((item, index) => {
      const id = addNode(
        'audio',
        origin.x,
        origin.y + index * (stage.h + gap),
        null,
        {
          label: item.label.trim(),
          prompt: item.prompt.trim(),
          params: audioKindParams('narration'),
          tag: (item.tag || item.label || audioKindTag('narration')).trim(),
        },
      )
      if (id)
        ids.push(id)
    })
    return ids
  }

  /** 逐镜视频。有 fromId 时从该静帧右侧排开，方便图生视频连线 */
  function insertVideoNodes(items: { label: string, prompt: string, ratio?: string, seconds?: number, group?: string }[], fromId?: string) {
    const list = items.filter(item => item.label.trim() && item.prompt.trim()).slice(0, 16)
    if (!list.length)
      return []
    const stage = canvasStageSize('video') || { w: 320, h: 220 }
    const from = fromId ? opts.findNode(fromId) : undefined
    const fromBox = from ? nodeSize(from) : null
    const gap = 24
    const origin = from && fromBox
      ? { x: from.position.x + fromBox.w + gap, y: from.position.y }
      : nextInsertOrigin()
    const ids: string[] = []
    list.forEach((item, index) => {
      const seconds = Math.min(20, Math.max(1, Math.round(Number(item.seconds) || 4)))
      const id = addNode(
        'video',
        origin.x,
        origin.y + index * (stage.h + gap),
        null,
        {
          label: item.label.trim(),
          prompt: item.prompt.trim(),
          tag: item.label.trim(),
          videoMode: 'i2v',
          params: { ratio: frameRatioOf(item.ratio), duration: seconds },
        },
      )
      if (id)
        ids.push(id)
    })
    return ids
  }

  function applyMediaNodeSize(nodeId: string, width?: number, height?: number) {
    if (!width || !height)
      return
    const node = opts.findNode(nodeId)
    if (!node || !isContentNode(node) || (node.data.kind !== 'image' && node.data.kind !== 'video'))
      return
    const next = canvasFitMediaSize(width, height)
    const cur = nodeSize(node)
    if (canvasMediaSizeClose(next, cur))
      return
    opts.updateNode(nodeId, {
      width: next.w,
      height: next.h,
      style: {
        ...(typeof node.style === 'object' && node.style ? node.style : {}),
        width: `${next.w}px`,
        height: `${next.h}px`,
      },
    })
    nextTick(() => opts.updateNodeInternals([nodeId]))
  }

  function addAssetNodeAt(asset: Asset, x: number, y: number) {
    const kind = canvasAssetNodeKind(asset)
    if (!kind)
      return null
    const stage = canvasStageSize(kind)
    const id = addNode(kind, x - (stage?.w ?? 0) / 2, y - (stage?.h ?? 0) / 2)
    if (!id)
      return null
    applyMediaNodeSize(id, asset.width, asset.height)
    opts.updateNodeData(id, { content: asset.url, assetId: asset.id, label: asset.name })
    opts.pushHistory()
    return id
  }

  function addAssetNodeAtCenter(asset: Asset) {
    const center = opts.centerFlowPoint()
    return addAssetNodeAt(asset, center.x, center.y)
  }

  return {
    nextId,
    addNode,
    addNodeAtCenter,
    addEmptyStart,
    insertTextNode,
    insertImageNodes,
    insertAudioNodes,
    insertVideoNodes,
    applyMediaNodeSize,
    addAssetNodeAt,
    addAssetNodeAtCenter,
  }
}
