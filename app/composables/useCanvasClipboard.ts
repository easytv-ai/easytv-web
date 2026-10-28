import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import assetApi from '~/api/asset'
import { absPosition, duplicateNodeLabel, isContentNode, isNodeLocked, nodesBounds, nodeSize, type CanvasFlowNode } from '~/utils/canvas-group'
import {
  CLIP_STORAGE_KEY,
  collectClipAssetIds,
  encodeClipEnvelope,
  newestEnvelope,
  parseClipEnvelope,
  remapClipAssetIds,
  type CanvasClipEnvelope,
} from '~/utils/canvas-clip-envelope'
import { canvasStageSize, cloneContentNodeData, type CanvasNodeData, type CanvasNodeKind } from '~/utils/canvas-node-kinds'

export type CanvasClipItem = {
  id: string
  kind: CanvasNodeKind
  x: number
  y: number
  width?: number
  height?: number
  data: CanvasNodeData
}

export type CanvasClipEdge = {
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

type FlowEdgeLite = CanvasClipEdge

/** 系统剪贴板 readText 的等待上限；权限弹窗 / 挂起的读取不该卡住粘贴 */
const CLIPBOARD_READ_TIMEOUT_MS = 800
/** 同一份信封（同 at）在这个窗口内只贴一次：原生 paste 事件与 Ctrl+V keydown 都会触发 */
const PASTE_DEDUPE_MS = 300

function readStorageEnvelope(): CanvasClipEnvelope | null {
  try {
    return parseClipEnvelope(localStorage.getItem(CLIP_STORAGE_KEY))
  }
  catch {
    return null
  }
}

async function readSystemClipboardEnvelope(): Promise<CanvasClipEnvelope | null> {
  if (typeof navigator === 'undefined' || typeof navigator.clipboard?.readText !== 'function')
    return null
  try {
    const text = await Promise.race<string | null>([
      navigator.clipboard.readText(),
      new Promise<null>(resolve => setTimeout(() => resolve(null), CLIPBOARD_READ_TIMEOUT_MS)),
    ])
    return parseClipEnvelope(text)
  }
  catch {
    // 权限被拒 / 非安全上下文 / 焦点不在文档：静默退回本机存储与页面内存
    return null
  }
}

/**
 * 画布复制 / 粘贴 / 副本。选中范围内的连线照搬；没一起复制的上游图，连到副本上。
 * 复制同时写系统剪贴板与 localStorage（API.md 36），粘贴按「剪贴板 → 本机存储 → 页面内存」取最新；
 * 贴到别的画布 / 空间时把素材引入当前空间（POST /user/asset/import）。
 */
export function useCanvasClipboard(opts: {
  nodes: Ref<CanvasFlowNode[]>
  edges: Ref<Array<{ source: string, target: string, sourceHandle?: string | null, targetHandle?: string | null }>>
  counts: Record<CanvasNodeKind, number>
  addNodes: (nodes: CanvasFlowNode[]) => void
  addEdges: (edge: any) => void
  defaultEdgeOptions: { type: string, animated: boolean }
  pushHistory: () => void
  paneMenu: Ref<{ flowX: number, flowY: number } | null>
  canvasId?: () => number
  teamId?: () => number
  updateNodeData?: (id: string, patch: Record<string, unknown>) => void
  notify?: (title: string, color?: 'neutral' | 'error') => void
  t?: (key: string, params?: Record<string, unknown>) => string
}) {
  const clip = ref<CanvasClipEnvelope | null>(null)
  /** localStorage 里有别的标签页复制的信封：右键菜单也要显示「粘贴」 */
  const storageHasClip = ref(false)
  const canPaste = computed(() => Boolean(clip.value?.items.length) || storageHasClip.value)
  const currentCanvasId = () => Number(opts.canvasId?.() ?? 0) || 0
  const currentTeamId = () => Number(opts.teamId?.() ?? 0) || 0
  const tr = (key: string, params?: Record<string, unknown>) => opts.t ? opts.t(key, params) : key
  let lastPastedAt = 0
  let lastPastedTick = 0

  function refreshStorageFlag() {
    storageHasClip.value = Boolean(readStorageEnvelope())
  }

  function onStorage(event: StorageEvent) {
    if (!event.key || event.key === CLIP_STORAGE_KEY)
      refreshStorageFlag()
  }

  onMounted(() => {
    refreshStorageFlag()
    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', refreshStorageFlag)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener('focus', refreshStorageFlag)
  })

  function relinkCopiedNodes(
    idMap: Map<string, string>,
    pickedIds: Set<string>,
    between = opts.edges.value.filter(edge => pickedIds.has(edge.source) && pickedIds.has(edge.target)),
    incoming = opts.edges.value.filter(edge => pickedIds.has(edge.target) && !pickedIds.has(edge.source)),
  ) {
    let n = 0
    const connect = (source: string, target: string, edge: FlowEdgeLite) => {
      opts.addEdges({
        ...opts.defaultEdgeOptions,
        id: `e-${source}-${target}-${Date.now()}-${n++}`,
        source,
        target,
        sourceHandle: edge.sourceHandle || 'out',
        targetHandle: edge.targetHandle || 'in',
      })
    }
    for (const edge of between) {
      const source = idMap.get(edge.source)
      const target = idMap.get(edge.target)
      if (source && target)
        connect(source, target, edge)
    }
    for (const edge of incoming) {
      const target = idMap.get(edge.target)
      if (!target || idMap.has(edge.source))
        continue
      if (!opts.nodes.value.some(node => node.id === edge.source))
        continue
      connect(edge.source, target, edge)
    }
  }

  function duplicateSelected() {
    const picked = opts.nodes.value.filter(node => node.selected && isContentNode(node) && !isNodeLocked(node, opts.nodes.value))
    if (!picked.length) {
      if (opts.nodes.value.some(node => node.selected && isContentNode(node) && isNodeLocked(node, opts.nodes.value)))
        opts.notify?.(tr('canvas.lock.lock'))
      return
    }
    const box = nodesBounds(picked, opts.nodes.value)
    const offsetY = (box?.h || 140) + 48
    const idMap = new Map<string, string>()
    const created: CanvasFlowNode[] = []
    const pickedIds = new Set(picked.map(node => node.id))
    for (const node of picked) {
      if (!isContentNode(node))
        continue
      const data = node.data
      opts.counts[data.kind] += 1
      const id = `${data.kind}-${opts.counts[data.kind]}`
      const abs = absPosition(node, opts.nodes.value)
      idMap.set(node.id, id)
      const size = nodeSize(node)
      created.push({
        id,
        type: 'easytv',
        position: { x: abs.x, y: abs.y + offsetY },
        selected: true,
        width: size.w,
        height: size.h,
        style: {
          ...(typeof node.style === 'object' && node.style ? node.style : {}),
          width: `${size.w}px`,
          height: `${size.h}px`,
        },
        draggable: true,
        data: cloneContentNodeData(data, { label: duplicateNodeLabel(data.label), locked: false }),
      })
    }
    for (const node of opts.nodes.value)
      node.selected = false
    opts.addNodes(created)
    relinkCopiedNodes(idMap, pickedIds)
    opts.pushHistory()
  }

  function copySelected() {
    const picked = opts.nodes.value.filter(node => node.selected && isContentNode(node))
    if (!picked.length)
      return
    const ids = new Set(picked.map(node => node.id))
    const allEdges = opts.edges.value
    const pack = {
      items: picked.filter(isContentNode).map((node) => {
        const abs = absPosition(node, opts.nodes.value)
        return {
          id: node.id,
          kind: node.data.kind,
          x: abs.x,
          y: abs.y,
          width: nodeSize(node).w,
          height: nodeSize(node).h,
          data: cloneContentNodeData(node.data),
        }
      }),
      edges: allEdges
        .filter(edge => ids.has(edge.source) && ids.has(edge.target))
        .map(edge => ({
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle || 'out',
          targetHandle: edge.targetHandle || 'in',
        })),
      incoming: allEdges
        .filter(edge => ids.has(edge.target) && !ids.has(edge.source))
        .map(edge => ({
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle || 'out',
          targetHandle: edge.targetHandle || 'in',
        })),
    }
    const text = encodeClipEnvelope({ canvasId: currentCanvasId(), teamId: currentTeamId(), ...pack })
    const envelope = parseClipEnvelope(text)
    clip.value = envelope
    try {
      localStorage.setItem(CLIP_STORAGE_KEY, text)
      storageHasClip.value = true
    }
    catch {
      // 隐私模式 / 配额满：只留页面内存
    }
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function')
        void navigator.clipboard.writeText(text).catch(() => {})
    }
    catch {
      // 非安全上下文
    }
  }

  /** 贴到别的画布 / 空间：把节点引用的素材引入当前空间并改写 id（API.md 36.1） */
  async function importPastedAssets(pack: CanvasClipEnvelope, created: CanvasFlowNode[]) {
    if (!opts.updateNodeData)
      return
    const ids = collectClipAssetIds(created.map(node => ({ data: node.data })))
    if (!ids.length)
      return
    let result: Awaited<ReturnType<typeof assetApi.importAssets>> | null = null
    try {
      result = await assetApi.importAssets(ids)
    }
    catch {
      result = null
    }
    if (!result?.success || !result.data) {
      opts.notify?.(result?.message || tr('素材引入失败，粘贴的节点可能无法生成'), 'error')
      return
    }
    const map = new Map<number, number>()
    const missing = new Set<number>()
    for (const item of result.data.items || []) {
      if (item.status === 'missing' || !item.to)
        missing.add(item.from)
      else if (item.to !== item.from)
        map.set(item.from, item.to)
    }
    if (map.size || missing.size) {
      for (const node of created) {
        const live = opts.nodes.value.find(entry => entry.id === node.id)
        if (!live)
          continue
        const before = live.data as Record<string, unknown>
        const after = remapClipAssetIds(before, map, missing) as Record<string, unknown>
        // Vue Flow 的 updateNodeData 是浅合并：被删掉的 id 键要显式置 undefined 才会消失
        const patch: Record<string, unknown> = { ...after }
        for (const key of Object.keys(before)) {
          if (!(key in after))
            patch[key] = undefined
        }
        opts.updateNodeData(node.id, patch)
      }
      opts.pushHistory()
    }
    const copied = Number(result.data.copied) || 0
    const lost = Number(result.data.missing) || 0
    if (copied > 0)
      opts.notify?.(tr('已把 {n} 个素材引入当前空间', { n: copied }))
    if (lost > 0)
      opts.notify?.(tr('{n} 个素材没有权限，已改为仅保留地址', { n: lost }), 'error')
  }

  /**
   * 粘贴指定信封。同一份信封（同 at）300 ms 内只贴一次：原生 paste 事件与 Ctrl+V keydown 会先后到达。
   * 返回是否真的贴了。
   */
  async function pasteEnvelope(pack: CanvasClipEnvelope | null, at?: { x: number, y: number }): Promise<boolean> {
    if (!pack?.items.length)
      return false
    const now = Date.now()
    if (pack.at && pack.at === lastPastedAt && now - lastPastedTick < PASTE_DEDUPE_MS)
      return false
    lastPastedAt = pack.at
    lastPastedTick = now
    const sameCanvas = pack.canvas_id > 0 && pack.canvas_id === currentCanvasId()
    const sameTeam = pack.team_id === currentTeamId()
    const minX = Math.min(...pack.items.map(item => item.x))
    const minY = Math.min(...pack.items.map(item => item.y))
    const origin = at ?? (opts.paneMenu.value
      ? { x: opts.paneMenu.value.flowX, y: opts.paneMenu.value.flowY }
      : { x: minX + 48, y: minY + 48 })
    const dx = origin.x - minX
    const dy = origin.y - minY
    const idMap = new Map<string, string>()
    const created: CanvasFlowNode[] = []
    for (const item of pack.items) {
      opts.counts[item.kind] += 1
      const id = `${item.kind}-${opts.counts[item.kind]}`
      idMap.set(item.id, id)
      const stage = canvasStageSize(item.kind)
      const size = stage
        ? {
            width: item.width || stage.w,
            height: item.height || stage.h,
            style: {
              width: `${item.width || stage.w}px`,
              height: `${item.height || stage.h}px`,
            },
          }
        : {}
      created.push({
        id,
        type: 'easytv',
        position: { x: item.x + dx, y: item.y + dy },
        selected: true,
        ...size,
        draggable: true,
        data: cloneContentNodeData(item.data, { label: duplicateNodeLabel(item.data.label), locked: false }),
      })
    }
    for (const node of opts.nodes.value)
      node.selected = false
    opts.addNodes(created)
    // 别的画布里同名节点 id 指的不是同一个东西：只有贴回同一张画布才接回未复制的上游
    relinkCopiedNodes(idMap, new Set(pack.items.map(item => item.id)), pack.edges, sameCanvas ? pack.incoming : [])
    opts.paneMenu.value = null
    opts.pushHistory()
    if (!sameCanvas || !sameTeam)
      await importPastedAssets(pack, created)
    return true
  }

  /** 粘贴：系统剪贴板 / localStorage / 页面内存三处取最新的一份 */
  async function pasteClip(at?: { x: number, y: number }) {
    const pack = newestEnvelope([
      await readSystemClipboardEnvelope(),
      readStorageEnvelope(),
      clip.value,
    ])
    if (!pack)
      return
    await pasteEnvelope(pack, at)
  }

  return {
    clip,
    canPaste,
    duplicateSelected,
    copySelected,
    pasteClip,
    pasteEnvelope,
    relinkCopiedNodes,
  }
}
