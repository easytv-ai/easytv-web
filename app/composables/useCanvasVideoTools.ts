/**
 * 画布上的片段截取、视频分割、逐帧拉片、视频高清和深度动作捕捉。
 * 重拍、续写、超分在 useCanvasVideoOps。
 */
import { nextTick, watch, type ComputedRef, type Ref } from 'vue'
import assetApi from '~/api/asset'
import type { CanvasOverlayKey } from '~/composables/useCanvasToolOverlays'
import type { CanvasNodeData } from '~/utils/canvas-node-kinds'
import {
  DEPTH_MOTION_DEFAULT_PARAMS,
  FRAME_PULL_DEFAULT_PARAMS,
  FRAME_PULL_STAGE_SIZE,
  HD_DEFAULT_PARAMS,
  isDepthMotionNode,
  isFramePullNode,
  isHdNode,
  pickHdUpscaleModel,
} from '~/utils/canvas-node-kinds'
import { isContentNode, isNodeLocked, nodeSize, type CanvasFlowNode } from '~/utils/canvas-group'
import { rangeToSeconds } from '~/utils/canvas-media-job'
import { estimateSecondDuration } from '~/utils/model-price'
import { formatFrameClock, probeMediaDuration } from '~/utils/canvas-video-frame'
import { isMediaUrl } from '~/utils/media'

type ContentNode = CanvasFlowNode & { data: CanvasNodeData }

export function useCanvasVideoTools(ctx: {
  selected: ComputedRef<CanvasFlowNode | null>
  nodeMenu: Ref<any>
  nodes: Ref<CanvasFlowNode[]>
  counts: { video: number }
  ensureMediaAction: (name: string) => boolean
  notify: (title: string, color?: 'neutral' | 'error') => void
  t: (key: string, params?: Record<string, unknown>) => string
  closeOverlays: (keys: CanvasOverlayKey[]) => void
  currentImageSrc: (node?: CanvasFlowNode | null) => string
  clipStripOpen: Ref<boolean>
  clipStripNodeId: Ref<string>
  clipStripSrc: Ref<string>
  splitStripOpen: Ref<boolean>
  splitStripNodeId: Ref<string>
  splitStripSrc: Ref<string>
  splitBusy: Ref<boolean>
  stripAssetDuration: Ref<number>
  /** 高清面板报价用的源视频时长（秒）；读到后再用来提交 duration */
  hdSourceSeconds: Ref<number>
  findNode: (id: string) => CanvasFlowNode | undefined
  mediaSourceOf: (node: ContentNode) => { asset_id?: number, task_id?: number } | null
  mediaSourceNode: (node: ContentNode, sourceId?: string) => ContentNode
  spawnMediaNode: (
    from: ContentNode,
    kind: 'video',
    tag: string,
    label: string,
    layout?: { at?: { x: number, y: number }, data?: Partial<CanvasNodeData>, select?: boolean },
  ) => ContentNode
  submitMediaJob: (
    node: ContentNode,
    action: string,
    source: { asset_id?: number, task_id?: number },
    params: Record<string, unknown>,
    jobOpts: { label: string, model?: string, dropOnFail?: string[], linkedId?: string },
  ) => Promise<unknown>
  mediaActions: Ref<Array<{ action: string, models?: string[] }>>
  addNodes: (node: CanvasFlowNode) => void
  addEdges: (edge: Record<string, unknown>) => void
  defaultEdgeOptions: Record<string, unknown>
  pushHistory: () => void
  addSelectedNodes: (nodes: CanvasFlowNode[]) => void
  updateNodeData: (id: string, patch: Partial<CanvasNodeData>) => void
  notifyChange: () => void
}) {
  const {
    selected,
    nodeMenu,
    nodes,
    counts,
    ensureMediaAction,
    notify,
    t,
    closeOverlays,
    currentImageSrc,
    clipStripOpen,
    clipStripNodeId,
    clipStripSrc,
    splitStripOpen,
    splitStripNodeId,
    splitStripSrc,
    splitBusy,
    stripAssetDuration,
    hdSourceSeconds,
    findNode,
    mediaSourceOf,
    mediaSourceNode,
    spawnMediaNode,
    submitMediaJob,
    mediaActions,
    addNodes,
    addEdges,
    defaultEdgeOptions,
    pushHistory,
    addSelectedNodes,
    updateNodeData,
    notifyChange,
  } = ctx

  function nodeFrozen(node: CanvasFlowNode | undefined | null) {
    return isNodeLocked(node, nodes.value)
  }

  function openClipStrip() {
    const node = selected.value
    if (!node || !isContentNode(node) || node.data.kind !== 'video' || nodeFrozen(node))
      return
    if (isFramePullNode(node.data))
      return
    const src = currentImageSrc(node)
    if (!src) {
      notify(t('请先生成或添加一段视频'), 'error')
      return
    }
    closeOverlays(['smartEdit', 'depth', 'light', 'angle', 'crop', 'erase', 'outpaint', 'flip', 'mark', 'extendStrip', 'matting', 'viral'])
    clipStripNodeId.value = node.id
    clipStripSrc.value = src
    clipStripOpen.value = true
    void loadStripDuration(node)
  }

  /** 胶片条兜底时长：从资产库读源视频的 duration（媒体作业跑过一次后就有） */
  async function loadStripDuration(node: ContentNode) {
    stripAssetDuration.value = 0
    const assetId = Number(node.data.assetId)
    if (!(assetId > 0))
      return
    const res = await assetApi.get(assetId)
    if (res?.success && res.data)
      stripAssetDuration.value = Number(res.data.duration) || 0
  }

  function openSplitStrip() {
    const node = selected.value
    if (!node || !isContentNode(node) || node.data.kind !== 'video' || nodeFrozen(node))
      return
    if (!ensureMediaAction('split'))
      return
    const src = currentImageSrc(node)
    if (!src) {
      notify(t('请先生成或添加一段视频'), 'error')
      return
    }
    closeOverlays(['smartEdit', 'depth', 'light', 'angle', 'crop', 'erase', 'outpaint', 'flip', 'mark', 'extendStrip', 'clipStrip', 'matting', 'viral'])
    splitStripNodeId.value = node.id
    splitStripSrc.value = src
    splitStripOpen.value = true
    void loadStripDuration(node)
  }

  /** 视频分割：在分割点切成两段，前段落到源节点右侧、后段落在它下方，一个作业两份产物（API.md 30） */
  async function onSplitStripSubmit(payload: { seconds: number, start: number, end: number, duration: number }) {
    const node = findNode(splitStripNodeId.value)
    if (!node || !isContentNode(node) || node.data.kind !== 'video' || splitBusy.value || nodeFrozen(node))
      return
    const duration = payload.duration > 0 ? payload.duration : stripAssetDuration.value
    if (!(duration > 0)) {
      notify(t('还没读到视频时长，请稍后再试'), 'error')
      return
    }
    const at = Math.round(Math.min(1, Math.max(0, payload.start)) * duration * 100) / 100
    if (at < 0.3 || at > duration - 0.3) {
      notify(t('分割点太靠近首尾，请重新选择'), 'error')
      return
    }
    const source = mediaSourceOf(node)
    if (!source)
      return
    splitStripOpen.value = false
    const sourceLabel = node.data.label || t('视频节点')
    const size = nodeSize(node)
    const first = spawnMediaNode(node, 'video', '分割', `${sourceLabel}_${t('分割')} 1 · 0-${formatFrameClock(at)}`, {
      data: { prompt: String(node.data.prompt || '') },
      select: true,
    })
    const second = spawnMediaNode(node, 'video', '分割', `${sourceLabel}_${t('分割')} 2 · ${formatFrameClock(at)}-${formatFrameClock(duration)}`, {
      at: { x: node.position.x + size.w + 80, y: node.position.y + size.h + 48 },
      data: { prompt: String(node.data.prompt || ''), taskStatus: 'running', taskProgress: 0 },
    })
    splitBusy.value = true
    try {
      await submitMediaJob(first, 'split', source, { at }, { label: '视频分割', dropOnFail: [first.id, second.id], linkedId: second.id })
    }
    finally {
      splitBusy.value = false
    }
  }

  /** 逐帧拉片：在源视频右侧派生可拖动节点 */
  function onNodeMenuFramePull() {
    nodeMenu.value = null
    const from = selected.value
    if (!from || !isContentNode(from) || from.data.kind !== 'video' || nodeFrozen(from))
      return
    if (isFramePullNode(from.data))
      return
    const src = String(from.data.content || '').trim()
    if (!src || !isMediaUrl(src)) {
      notify(t('请先生成或添加一段视频'), 'error')
      return
    }
    const sourceLabel = from.data.label || t('视频节点')
    const size = FRAME_PULL_STAGE_SIZE
    counts.video += 1
    const id = `video-${counts.video}`
    const sibling: CanvasFlowNode = {
      id,
      type: 'easytv',
      position: { x: from.position.x + nodeSize(from).w + 80, y: from.position.y },
      width: size.w,
      height: size.h,
      style: {
        width: `${size.w}px`,
        height: `${size.h}px`,
      },
      data: {
        kind: 'video',
        label: `${sourceLabel}-${t('逐帧拉片')}`,
        tag: '逐帧拉片',
        content: src,
        assetId: from.data.assetId,
        prompt: '',
        mode: 'idle',
        frameParams: {
          sourceId: from.id,
          sourceLabel,
          ...FRAME_PULL_DEFAULT_PARAMS,
        },
      },
    }
    if (from.parentNode) {
      sibling.parentNode = from.parentNode
      sibling.extent = 'parent'
      sibling.expandParent = true
    }
    for (const node of nodes.value)
      node.selected = false
    sibling.selected = true
    addNodes(sibling)
    addEdges({
      id: `e-${from.id}-${id}-${Date.now()}`,
      source: from.id,
      target: id,
      sourceHandle: 'out',
      targetHandle: 'in',
      ...defaultEdgeOptions,
    })
    pushHistory()
    nextTick(() => {
      const created = findNode(id)
      if (created)
        addSelectedNodes([created])
    })
  }

  /** 片段截取：本地动作 trim，胶片条给的是 0~1 比例，乘探测到的时长换算成秒 */
  async function onClipStripSubmit(payload: { seconds: number, start: number, end: number, duration: number }) {
    const node = findNode(clipStripNodeId.value)
    if (!node || !isContentNode(node) || node.data.kind !== 'video' || nodeFrozen(node))
      return
    if (!ensureMediaAction('trim'))
      return
    const range = rangeToSeconds({ start: payload.start, end: payload.end }, payload.duration, 0.1)
    if (!range) {
      notify(!(payload.duration > 0) ? t('还没读到视频时长，请稍后再试') : t('截取区间太短，请重新圈选'), 'error')
      return
    }
    const source = mediaSourceOf(node)
    if (!source)
      return
    clipStripOpen.value = false
    splitStripOpen.value = false
    const sourceLabel = node.data.label || t('视频节点')
    const sibling = spawnMediaNode(node, 'video', '片段截取', `${sourceLabel}_${t('片段截取')} ${formatFrameClock(range.start)}-${formatFrameClock(range.end)}`, {
      data: { prompt: String(node.data.prompt || '') },
      select: true,
    })
    await submitMediaJob(sibling, 'trim', source, { start: range.start, end: range.end, accurate: true }, { label: '片段截取', dropOnFail: [sibling.id] })
  }

  /** 高清报价 / 提交共用的源时长：节点参数 → 资产库 → 浏览器探测 */
  async function loadHdSourceSeconds() {
    const node = selected.value
    if (!node || !isContentNode(node) || !isHdNode(node.data)) {
      hdSourceSeconds.value = 0
      return
    }
    const from = mediaSourceNode(node)
    const known = Number(from.data.params?.duration) || 0
    if (known > 0) {
      hdSourceSeconds.value = known
      return
    }
    const assetId = Number(from.data.assetId)
    if (assetId > 0) {
      const res = await assetApi.get(assetId)
      const duration = Number(res?.data?.duration) || 0
      if (selected.value?.id === node.id && duration > 0) {
        hdSourceSeconds.value = duration
        return
      }
    }
    const src = currentImageSrc(from) || String(from.data.content || '').trim()
    if (!src || !isMediaUrl(src)) {
      if (selected.value?.id === node.id)
        hdSourceSeconds.value = 0
      return
    }
    const probed = await probeMediaDuration(src)
    if (selected.value?.id === node.id)
      hdSourceSeconds.value = probed > 0 ? probed : 0
  }

  watch(
    () => {
      const node = selected.value
      if (!node || !isContentNode(node) || !isHdNode(node.data))
        return ''
      const from = mediaSourceNode(node)
      return `${node.id}:${from.id}:${from.data.assetId || 0}:${from.data.params?.duration || 0}`
    },
    () => {
      void loadHdSourceSeconds()
    },
    { immediate: true },
  )

  /** 高清：在源视频右侧派生节点并连线。点生成走 onHdSubmit 的 upscale，只提交分辨率。 */
  function onNodeMenuHd() {
    const from = selected.value
    if (!from || !isContentNode(from) || nodeFrozen(from))
      return
    if (from.data.kind !== 'video' && from.data.kind !== 'director')
      return
    const size = nodeSize(from)
    counts.video += 1
    const id = `video-${counts.video}`
    const sibling: CanvasFlowNode = {
      id,
      type: 'easytv',
      position: { x: from.position.x + size.w + 80, y: from.position.y },
      width: size.w,
      height: size.h,
      style: {
        ...(typeof from.style === 'object' && from.style ? from.style : {}),
        width: `${size.w}px`,
        height: `${size.h}px`,
      },
      data: {
        kind: 'video',
        label: t('高清'),
        tag: '高清',
        content: '',
        prompt: String(from.data.prompt || ''),
        mode: 'idle',
        hdParams: { ...HD_DEFAULT_PARAMS },
      },
    }
    if (from.parentNode) {
      sibling.parentNode = from.parentNode
      sibling.extent = 'parent'
      sibling.expandParent = true
    }
    for (const node of nodes.value)
      node.selected = false
    sibling.selected = true
    addNodes(sibling)
    addEdges({
      id: `e-${from.id}-${id}-${Date.now()}`,
      source: from.id,
      target: id,
      sourceHandle: 'out',
      targetHandle: 'in',
      ...defaultEdgeOptions,
    })
    pushHistory()
    nextTick(() => {
      const created = findNode(id)
      if (created)
        addSelectedNodes([created])
    })
  }

  function onHdParamsUpdate(params: NonNullable<CanvasNodeData['hdParams']>) {
    const node = selected.value
    if (!node || !isContentNode(node) || !isHdNode(node.data) || nodeFrozen(node))
      return
    updateNodeData(node.id, { hdParams: params })
    notifyChange()
  }

  /** 视频高清：模型动作 upscale，params={resolution}；源是连进来的上游视频。图片高清仍走 runUpscale */
  async function onHdSubmit() {
    const node = selected.value
    if (!node || !isContentNode(node) || !isHdNode(node.data) || nodeFrozen(node))
      return
    if (node.data.taskStatus === 'pending' || node.data.taskStatus === 'running') {
      notify(t('该节点正在生成中'))
      return
    }
    if (!ensureMediaAction('upscale'))
      return
    const from = mediaSourceNode(node)
    if (from.id === node.id && !node.data.assetId) {
      notify(t('请先把高清节点连到一段视频上'), 'error')
      return
    }
    const source = mediaSourceOf(from)
    if (!source)
      return
    const params = { ...HD_DEFAULT_PARAMS, ...(node.data.hdParams || {}) }
    const models = mediaActions.value.find(item => item.action === 'upscale')?.models || []
    const model = pickHdUpscaleModel(params, models)
    const jobParams: Record<string, unknown> = { resolution: params.resolution }
    if (hdSourceSeconds.value > 0)
      jobParams.duration = estimateSecondDuration(hdSourceSeconds.value)
    await submitMediaJob(node, 'upscale', source, jobParams, { label: '视频高清', model })
  }

  /** 深度动作捕捉：源视频右侧派生节点，选中后底部面板选清晰度 */
  function onNodeMenuDepthMotion() {
    nodeMenu.value = null
    const from = selected.value
    if (!from || !isContentNode(from) || from.data.kind !== 'video' || nodeFrozen(from))
      return
    if (isDepthMotionNode(from.data) || isFramePullNode(from.data))
      return
    const src = String(from.data.content || '').trim()
    if (!src || !isMediaUrl(src)) {
      notify(t('请先生成或添加一段视频'), 'error')
      return
    }
    const sourceLabel = from.data.label || t('视频节点')
    const size = nodeSize(from)
    counts.video += 1
    const id = `video-${counts.video}`
    const sibling: CanvasFlowNode = {
      id,
      type: 'easytv',
      position: { x: from.position.x + size.w + 80, y: from.position.y },
      width: size.w,
      height: size.h,
      style: {
        ...(typeof from.style === 'object' && from.style ? from.style : {}),
        width: `${size.w}px`,
        height: `${size.h}px`,
      },
      data: {
        kind: 'video',
        label: `${t('深度动作捕捉')}-${sourceLabel}`,
        tag: '深度动作捕捉',
        content: src,
        assetId: from.data.assetId,
        prompt: '',
        mode: 'idle',
        depthMotionParams: {
          sourceId: from.id,
          sourceLabel,
          resolution: DEPTH_MOTION_DEFAULT_PARAMS.resolution,
        },
      },
    }
    if (from.parentNode) {
      sibling.parentNode = from.parentNode
      sibling.extent = 'parent'
      sibling.expandParent = true
    }
    for (const node of nodes.value)
      node.selected = false
    sibling.selected = true
    addNodes(sibling)
    addEdges({
      id: `e-${from.id}-${id}-${Date.now()}`,
      source: from.id,
      target: id,
      sourceHandle: 'out',
      targetHandle: 'in',
      ...defaultEdgeOptions,
    })
    pushHistory()
    nextTick(() => {
      const created = findNode(id)
      if (created)
        addSelectedNodes([created])
    })
  }

  function onDepthMotionParamsUpdate(params: NonNullable<CanvasNodeData['depthMotionParams']>) {
    const node = selected.value
    if (!node || !isContentNode(node) || !isDepthMotionNode(node.data) || nodeFrozen(node))
      return
    updateNodeData(node.id, { depthMotionParams: params })
    notifyChange()
  }

  /** 深度动作捕捉：模型动作 motion_capture，params={resolution}，产物写回本节点 */
  async function onDepthMotionSubmit() {
    const node = selected.value
    if (!node || !isContentNode(node) || !isDepthMotionNode(node.data) || nodeFrozen(node))
      return
    if (node.data.taskStatus === 'pending' || node.data.taskStatus === 'running') {
      notify(t('该节点正在生成中'))
      return
    }
    if (!ensureMediaAction('motion_capture'))
      return
    const resolution = node.data.depthMotionParams?.resolution || DEPTH_MOTION_DEFAULT_PARAMS.resolution
    const source = mediaSourceOf(mediaSourceNode(node, node.data.depthMotionParams?.sourceId))
    if (!source)
      return
    await submitMediaJob(node, 'motion_capture', source, { resolution }, { label: '深度动作捕捉' })
  }

  return {
    openClipStrip,
    loadStripDuration,
    openSplitStrip,
    onSplitStripSubmit,
    onNodeMenuFramePull,
    onClipStripSubmit,
    onNodeMenuHd,
    onHdParamsUpdate,
    onHdSubmit,
    onNodeMenuDepthMotion,
    onDepthMotionParamsUpdate,
    onDepthMotionSubmit,
  }
}
