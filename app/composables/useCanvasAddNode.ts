import { nextTick, type Ref } from 'vue'
import { isContentNode, nodeSize, nodesBounds, type CanvasFlowNode } from '~/utils/canvas-group'
import {
  canvasInsertPositions,
  canvasNextInsertOrigin,
  canvasSlotRightOf,
  INSERT_GROUP_GAP,
  ORGANIZE_GAP_X,
  ORGANIZE_GAP_Y,
} from '~/utils/canvas-viewport'
import {
  CANVAS_NODE_ITEMS,
  canvasFitMediaSize,
  canvasMediaSizeClose,
  canvasNodeTitle,
  canvasRatioSize,
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

  function contentBoxes(exceptId?: string) {
    return opts.nodes.value
      .filter(node => isContentNode(node) && node.id !== exceptId)
      .map((node) => {
        const box = nodeSize(node)
        return { x: node.position.x, y: node.position.y, w: box.w, h: box.h }
      })
  }

  /** 角色 / 场景 / 道具 / 分镜按栏排开，并用画幅预留高度，避免生成后挤成一坨 */
  function insertImageNodes(items: { label: string, prompt: string, ratio?: string, group?: string, tag?: string }[], fromId?: string) {
    const list = items.filter(item => item.label.trim() && item.prompt.trim()).slice(0, 28)
    if (!list.length)
      return []
    const from = fromId ? opts.findNode(fromId) : undefined
    const fromBox = from ? nodeSize(from) : null
    const origin = from && fromBox
      ? canvasSlotRightOf(
          { x: from.position.x, y: from.position.y, w: fromBox.w, h: fromBox.h },
          contentBoxes(from.id),
          INSERT_GROUP_GAP,
        )
      : nextInsertOrigin()
    const slots = canvasInsertPositions(
      list.map((item, index) => ({
        index,
        group: item.group,
        ...canvasRatioSize(frameRatioOf(item.ratio)),
      })),
      origin,
    )
    const ids: string[] = []
    for (const slot of slots) {
      const item = list[slot.index]
      if (!item)
        continue
      const ratio = frameRatioOf(item.ratio)
      const id = addNode(
        'image',
        slot.x,
        slot.y,
        null,
        {
          label: item.label.trim(),
          prompt: item.prompt.trim(),
          tag: (item.tag || item.label).trim(),
          params: { ratio },
        },
      )
      if (!id)
        continue
      const size = canvasRatioSize(ratio)
      applyMediaNodeSize(id, size.w, size.h)
      ids.push(id)
    }
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
    const origin = from && fromBox
      ? { x: from.position.x, y: from.position.y + fromBox.h + ORGANIZE_GAP_Y }
      : nextInsertOrigin()
    const ids: string[] = []
    list.forEach((item, index) => {
      const id = addNode(
        'audio',
        origin.x,
        origin.y + index * (stage.h + ORGANIZE_GAP_Y),
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

  /** 逐镜视频。有 fromId 时放到该静帧右侧空位，避免压住同一行的下一镜 */
  function insertVideoNodes(items: { label: string, prompt: string, ratio?: string, seconds?: number, group?: string }[], fromId?: string) {
    const list = items.filter(item => item.label.trim() && item.prompt.trim()).slice(0, 16)
    if (!list.length)
      return []
    const from = fromId ? opts.findNode(fromId) : undefined
    const fromBox = from ? nodeSize(from) : null
    const origin = from && fromBox
      ? canvasSlotRightOf(
          { x: from.position.x, y: from.position.y, w: fromBox.w, h: fromBox.h },
          contentBoxes(from.id),
          ORGANIZE_GAP_X,
        )
      : nextInsertOrigin()
    const slots = from
      ? list.map((_, index) => {
          const size = canvasRatioSize(frameRatioOf(list[index]?.ratio))
          return { index, x: origin.x, y: origin.y + index * (size.h + ORGANIZE_GAP_Y) }
        })
      : canvasInsertPositions(
          list.map((item, index) => ({
            index,
            group: item.group || 'video',
            ...canvasRatioSize(frameRatioOf(item.ratio)),
          })),
          origin,
        )
    const ids: string[] = []
    for (const slot of slots) {
      const item = list[slot.index]
      if (!item)
        continue
      const ratio = frameRatioOf(item.ratio)
      const seconds = Math.min(20, Math.max(1, Math.round(Number(item.seconds) || 4)))
      const id = addNode(
        'video',
        slot.x,
        slot.y,
        null,
        {
          label: item.label.trim(),
          prompt: item.prompt.trim(),
          tag: item.label.trim(),
          videoMode: 'i2v',
          params: { ratio, duration: seconds },
        },
      )
      if (!id)
        continue
      const size = canvasRatioSize(ratio)
      applyMediaNodeSize(id, size.w, size.h)
      ids.push(id)
    }
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
