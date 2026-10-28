/**
 * 画布上的片段重拍、智能续写和超分。
 * 菜单是否可点、弹窗状态和提交都在这里；截取、分割、高清仍留在工作区。
 */
import { computed, nextTick, ref, watch, type ComputedRef, type Ref } from 'vue'
import taskApi from '~/api/task'
import type { ConfirmOptions } from '~/composables/useConfirm'
import type { CanvasOverlayKey } from '~/composables/useCanvasToolOverlays'
import type { Asset, GeneratePayload, GenerationModel, GenerationTask, TaskInput } from '~/types/creative'
import { cameraMovesPrompt, isRetakeNode, RETAKE_SEGMENT_COUNT, type CanvasNodeData } from '~/utils/canvas-node-kinds'
import { isContentNode, isNodeLocked, nodeSize, type CanvasFlowNode } from '~/utils/canvas-group'
import { expandPromptTokens } from '~/utils/canvas-mark'
import type { ExtendStudioPayload, ExtendStudioRef } from '~/utils/canvas-extend-studio'
import { isMediaUrl } from '~/utils/media'
import { shortModelName } from '~/utils/model-name'

type ContentNode = CanvasFlowNode & { data: CanvasNodeData }

export function useCanvasVideoOps(opts: {
  selected: ComputedRef<CanvasFlowNode | null>
  canvasLocked: Ref<boolean>
  nodeMenu: Ref<any>
  nodes: Ref<CanvasFlowNode[]>
  counts: { video: number }
  ensureMediaAction: (name: string) => boolean
  notify: (title: string, color?: 'neutral' | 'error') => void
  t: (key: string, params?: Record<string, unknown>) => string
  addNodes: (node: CanvasFlowNode) => void
  addEdges: (edge: Record<string, unknown>) => void
  defaultEdgeOptions: Record<string, unknown>
  pushHistory: () => void
  findNode: (id: string) => CanvasFlowNode | undefined
  addSelectedNodes: (nodes: CanvasFlowNode[]) => void
  showRetakeStrip: ComputedRef<boolean>
  closeOverlays: (keys: CanvasOverlayKey[]) => void
  currentImageSrc: (node?: CanvasFlowNode | null) => string
  loadStripDuration: (node: ContentNode) => void | Promise<void>
  openAssetPicker: (picker: { mode: 'attach', chatPick: (assets: Asset[]) => void }) => void
  generationModels: Ref<GenerationModel[]>
  updateNodeData: (id: string, patch: Partial<CanvasNodeData>) => void
  submitRetakeSegment: (node: ContentNode, payload?: GeneratePayload) => Promise<void>
  addNode: (kind: 'video', x: number, y: number, parentId?: string | null) => string | null
  submitDerivedTask: (node: CanvasFlowNode, label: string, body: {
    type: 'video'
    model: string
    prompt: string
    params: Record<string, unknown>
    inputs: TaskInput[]
  }) => Promise<unknown>
  applyTaskToNode: (id: string, task: GenerationTask) => void
  refreshWallet: () => void
  pollTask: (nodeId: string, taskId: number) => void
  confirm: (options: ConfirmOptions) => Promise<boolean>
  removeNodes: (ids: string[]) => void
  extendStripOpen: Ref<boolean>
  canvasId: () => number
}) {
  const extendOpen = ref(false)
  const extendBusy = ref(false)
  /** 打开续写弹窗时锁定源节点，弹窗期间选中项变了也不跑偏 */
  const extendSource = ref<{ nodeId: string, taskId: number, assetId?: number, prompt: string } | null>(null)

  /** 超分 / 续写要「已完成的视频」：有来源任务或已入库资产都行（上传 / 处理得到的视频没有任务）；重拍另要求来源任务 */
  const videoOpsNode = computed(() => {
    const node = opts.selected.value
    if (!node || !isContentNode(node))
      return null
    if (node.data.kind !== 'video' && node.data.kind !== 'director')
      return null
    if (!(Number(node.data.assetId) > 0) && !(Number(node.data.taskId) > 0))
      return null
    if (node.data.taskStatus === 'pending' || node.data.taskStatus === 'running')
      return null
    return node
  })
  const canVideoOps = computed(() =>
    Boolean(videoOpsNode.value) && !opts.canvasLocked.value && !isNodeLocked(videoOpsNode.value, opts.nodes.value))
  /** 整段重拍是同参数重跑原任务，必须有来源任务 */
  const canRetake = computed(() => canVideoOps.value && Number(videoOpsNode.value?.data.taskId) > 0)

  function videoOpsTarget() {
    const node = videoOpsNode.value
    if (!node)
      return null
    const taskId = Number(node.data.taskId) > 0 ? Number(node.data.taskId) : 0
    const assetId = Number(node.data.assetId) > 0 ? Number(node.data.assetId) : 0
    return { node, taskId, assetId }
  }

  /** 片段重拍：在源视频右侧派生节点，用胶片条圈选要重拍的片段；点「生成」走 retake_segment（API.md 23.8） */
  function onNodeMenuRetake() {
    opts.nodeMenu.value = null
    const from = opts.selected.value
    if (!from || !isContentNode(from) || isNodeLocked(from, opts.nodes.value))
      return
    if (!opts.ensureMediaAction('retake_segment'))
      return
    if (from.data.kind !== 'video' && from.data.kind !== 'director')
      return
    const src = String(from.data.content || '').trim()
    if (!src || !isMediaUrl(src)) {
      opts.notify(opts.t('请先生成或添加一段视频'), 'error')
      return
    }
    const sourceLabel = from.data.label || opts.t('视频节点')
    const size = nodeSize(from)
    opts.counts.video += 1
    const id = `video-${opts.counts.video}`
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
        label: `${sourceLabel}-${opts.t('片段重拍')}`,
        tag: '片段重拍',
        content: src,
        assetId: from.data.assetId,
        prompt: '',
        mode: 'idle',
        retakeParams: {
          sourceId: from.id,
          sourceLabel,
          start: 0,
          end: 1,
          total: RETAKE_SEGMENT_COUNT,
        },
      },
    }
    if (from.parentNode) {
      sibling.parentNode = from.parentNode
      sibling.extent = 'parent'
      sibling.expandParent = true
    }
    for (const node of opts.nodes.value)
      node.selected = false
    sibling.selected = true
    opts.addNodes(sibling)
    opts.addEdges({
      id: `e-${from.id}-${id}-${Date.now()}`,
      source: from.id,
      target: id,
      sourceHandle: 'out',
      targetHandle: 'in',
      ...opts.defaultEdgeOptions,
    })
    opts.pushHistory()
    nextTick(() => {
      const created = opts.findNode(id)
      if (created)
        opts.addSelectedNodes([created])
    })
  }

  function onNodeMenuExtend() {
    opts.nodeMenu.value = null
    const target = videoOpsTarget()
    if (!target || isNodeLocked(target.node, opts.nodes.value))
      return
    openExtendStudio('extend')
  }

  const extendStudioOpen = ref(false)
  const extendStudioRef = ref<any>(null)
  const extendStudioVariant = ref<'extend' | 'retake'>('extend')
  const extendStudioNodeId = ref('')
  const extendStudioSrc = ref('')
  const extendStudioRefs = ref<ExtendStudioRef[]>([])
  const extendStudioBusy = ref(false)
  /** 视频模型清单：弹窗底栏的模型选择（只有已定价的能提交） */
  const extendStudioModels = computed(() => opts.generationModels.value
    .filter(item => item.type === 'video')
    .map((item) => {
      const name = shortModelName(item)
      const label = String(item.label || '').trim()
      return {
        id: item.model,
        name,
        desc: label && label !== name ? label : String(item.provider || ''),
        priced: Boolean(item.priced),
      }
    }))

  /** 续写弹窗的默认提示词：源节点的提示词（组节点没有 prompt，取空串） */
  const extendStudioPrompt = computed(() => {
    const node = opts.findNode(extendStudioNodeId.value)
    return node && isContentNode(node) ? String(node.data.prompt || '') : ''
  })

  /** 片段重拍弹窗的段数：跟重拍节点的 retakeParams 走 */
  const extendStudioTotal = computed(() => {
    const node = opts.findNode(extendStudioNodeId.value)
    const total = (node?.data as { retakeParams?: { total?: number } } | undefined)?.retakeParams?.total
    return Number(total) || RETAKE_SEGMENT_COUNT
  })

  /** 选中片段重拍节点（新建或再次选中）自动打开弹窗，替代旧胶片条 */
  watch(opts.showRetakeStrip, (on) => {
    if (on)
      openExtendStudio('retake')
  })

  /** 智能续写大弹窗：模型 / 类型 / 风格 / 资产 / 运镜 / 输出规格都在弹窗里选 */
  function openExtendStudio(variant: 'extend' | 'retake' = 'extend') {
    const node = opts.selected.value
    if (!node || !isContentNode(node) || node.data.kind !== 'video')
      return
    const src = opts.currentImageSrc(node)
    if (!src) {
      opts.notify(opts.t('请先生成或添加一段视频'), 'error')
      return
    }
    opts.closeOverlays(['smartEdit', 'depth', 'light', 'angle', 'crop', 'erase', 'outpaint', 'flip', 'mark', 'clipStrip', 'splitStrip', 'matting', 'viral'])
    extendStudioVariant.value = variant
    extendStudioNodeId.value = node.id
    extendStudioSrc.value = src
    extendStudioRefs.value = []
    extendStudioOpen.value = true
    // 浏览器抽不到帧（OSS 无 CORS）时，资产库时长兜底弹窗的时间线
    void opts.loadStripDuration(node)
  }

  /** 续写弹窗挑参考素材：走资产选择器的对话附件模式，回调把素材挂到弹窗 */
  function pickExtendStudioRefs() {
    opts.openAssetPicker({
      mode: 'attach',
      chatPick: (assets) => {
        const existing = new Set(extendStudioRefs.value.map(item => item.assetId))
        for (const asset of assets) {
          const kind = asset.type === 'video' ? 'video' : asset.type === 'audio' ? 'audio' : 'image'
          if (!existing.has(Number(asset.id)))
            extendStudioRefs.value.push({ assetId: Number(asset.id), kind, url: String(asset.url || ''), name: asset.name })
        }
      },
    })
  }

  /** 智能续写弹窗提交：延长走源任务/资产续写接口，片段重拍走 retake_segment 媒体作业，其余类型按视频生成（POST /user/task）提交 */
  async function onExtendStudioSubmit(payload: ExtendStudioPayload) {
    const node = opts.findNode(extendStudioNodeId.value)
    if (!node || !isContentNode(node))
      return
    if (extendStudioBusy.value)
      return
    // 风格 / 运镜拼进提示词（与对话栏同一形态：风格一行在前，运镜一行在后）
    let finalPrompt = payload.prompt
    if (payload.style)
      finalPrompt = `${opts.t('风格：{style}', { style: payload.style })}\n${finalPrompt}`
    const camLine = cameraMovesPrompt(payload.cameras)
    if (camLine)
      finalPrompt = `${finalPrompt}\n${opts.t('运镜：{moves}', { moves: camLine })}`

    if (payload.type === 'retake') {
      // 片段重拍：把选区写回 retakeParams，交回现有的 retake_segment 提交链路
      const params = node.data.retakeParams
      if (!params) {
        opts.notify(opts.t('请重新发起片段重拍'), 'error')
        return
      }
      extendStudioOpen.value = false
      opts.updateNodeData(node.id, {
        retakeParams: {
          ...params,
          start: payload.range.start,
          end: payload.range.end,
          duration: payload.range.duration || params.duration,
          total: payload.total || params.total,
        },
        prompt: finalPrompt,
      })
      opts.pushHistory()
      await opts.submitRetakeSegment(node, { model: payload.model, params: {}, prompt: finalPrompt })
      return
    }

    if (payload.type === 'extend') {
      const taskId = Number(node.data.taskId)
      const assetId = Number(node.data.assetId)
      // 上传 / 处理得到的视频没有来源任务：按资产续写（API.md 30）；两者都没有时先入库
      if (!(taskId > 0) && !(assetId > 0)) {
        opts.notify(opts.t('请先把视频保存到资产库'), 'error')
        return
      }
      extendSource.value = {
        nodeId: node.id,
        taskId: taskId > 0 ? taskId : 0,
        assetId: taskId > 0 ? undefined : assetId,
        prompt: String(node.data.prompt || '').trim(),
      }
      extendStudioOpen.value = false
      await onExtendSubmit({ prompt: finalPrompt || extendSource.value.prompt, seconds: Math.max(1, Math.round(payload.seconds)), model: payload.model })
      return
    }

    // 全能参考 / 首尾帧 / 视频编辑：源视频入库后按视频生成提交
    const assetId = Number(node.data.assetId)
    if (payload.type !== 'fl2v' && !(assetId > 0)) {
      opts.notify(opts.t('请先把视频保存到资产库'), 'error')
      return
    }
    if (payload.type === 'fl2v' && !payload.firstFrameAssetId) {
      opts.notify(opts.t('没能抽出选区尾帧，请重试或换一段视频'), 'error')
      return
    }
    extendStudioBusy.value = true
    try {
      const from = node
      const box = nodeSize(from)
      const newId = opts.addNode('video', from.position.x + box.w + 80, from.position.y, from.parentNode ?? null)
      if (!newId) {
        opts.notify(opts.t('提交失败'), 'error')
        return
      }
      opts.addEdges({
        id: `e-${from.id}-${newId}-${Date.now()}`,
        source: from.id,
        target: newId,
        sourceHandle: 'out',
        targetHandle: 'in',
        ...opts.defaultEdgeOptions,
      })
      opts.updateNodeData(newId, { prompt: finalPrompt })
      const inputs: TaskInput[] = []
      if (payload.type === 'fl2v') {
        if (payload.firstFrameAssetId)
          inputs.push({ asset_id: payload.firstFrameAssetId, role: 'first_frame' })
        const lastImage = payload.refs.find(item => item.kind === 'image')
        if (lastImage)
          inputs.push({ asset_id: lastImage.assetId, role: 'last_frame' })
      }
      else {
        inputs.push({ asset_id: assetId, role: 'reference_video' })
        for (const item of payload.refs) {
          const role = item.kind === 'video' ? 'reference_video' : item.kind === 'audio' ? 'reference_audio' : 'reference'
          inputs.push({ asset_id: item.assetId, role })
        }
      }
      const params: Record<string, unknown> = {
        mode: payload.type === 'fl2v' ? 'fl2v' : 'reference',
        resolution: payload.resolution,
        duration: payload.seconds,
        audio: payload.audio,
        count: payload.count,
        video_format: payload.videoFormat,
      }
      if (payload.ratio !== '智能')
        params.ratio = payload.ratio
      const created = opts.findNode(newId)
      if (!created)
        return
      const res = await opts.submitDerivedTask(created, '智能续写', {
        type: 'video',
        model: payload.model,
        prompt: finalPrompt,
        params,
        inputs,
      })
      extendStudioOpen.value = !res
    }
    finally {
      extendStudioBusy.value = false
    }
  }

  /** 续写：结果落在源节点右侧的新视频节点上，并从源节点连一条线过去 */
  async function onExtendSubmit(payload: { prompt: string, seconds: number, model?: string }) {
    const source = extendSource.value
    if (!source || extendBusy.value)
      return
    extendBusy.value = true
    try {
      // 先建节点再提交，这样能把新节点 id 一起发给后端（任务归属正确）；失败则回滚节点
      const from = opts.findNode(source.nodeId)
      if (!from) {
        opts.notify(opts.t('源节点已不存在'), 'error')
        return
      }
      const box = nodeSize(from)
      const newId = opts.addNode('video', from.position.x + box.w + 80, from.position.y, from.parentNode ?? null)
      if (!newId) {
        opts.notify(opts.t('提交失败'), 'error')
        return
      }
      opts.addEdges({
        id: `e-${from.id}-${newId}-${Date.now()}`,
        source: from.id,
        target: newId,
        sourceHandle: 'out',
        targetHandle: 'in',
        ...opts.defaultEdgeOptions,
      })
      opts.updateNodeData(newId, { prompt: payload.prompt || source.prompt })
      const body: { prompt?: string, seconds?: number, node_id?: string, model?: string } = { node_id: newId }
      if (payload.model)
        body.model = payload.model
      if (payload.prompt)
        body.prompt = expandPromptTokens(payload.prompt, isContentNode(from) ? from.data.markElements : null)
      if (payload.seconds > 0)
        body.seconds = payload.seconds
      const res = source.taskId > 0
        ? await taskApi.extend(source.taskId, body)
        : await taskApi.extendAsset(Number(source.assetId), { ...body, canvas_id: opts.canvasId() || undefined })
      if (!res?.success || !res.data) {
        opts.removeNodes([newId])
        opts.notify(res?.message || opts.t('提交失败'), 'error')
        return
      }
      extendOpen.value = false
      opts.extendStripOpen.value = false
      opts.applyTaskToNode(newId, res.data)
      opts.pushHistory()
      void opts.refreshWallet()
      if (res.data.status === 'pending' || res.data.status === 'running') {
        opts.notify(opts.t('已提交续写任务'))
        opts.pollTask(newId, res.data.id)
      }
      else if (res.data.status === 'failed') {
        opts.notify(res.data.error_msg || opts.t('生成失败'), 'error')
      }
    }
    finally {
      extendBusy.value = false
    }
  }

  /** 超分：绑在同一个节点上，成功前保留原有产物；没有已定价的超分模型时只提示不建节点 */
  async function onNodeMenuUpscale() {
    opts.nodeMenu.value = null
    const target = videoOpsTarget()
    if (!target || isNodeLocked(target.node, opts.nodes.value))
      return
    const ok = await opts.confirm({
      title: opts.t('超分'),
      message: opts.t('将对这段视频做超分重建，会再次消耗积分，成功后替换当前节点内容。'),
      confirmText: opts.t('开始超分'),
    })
    if (!ok)
      return
    const res = target.taskId > 0 ? await taskApi.upscale(target.taskId) : await taskApi.upscaleAsset(target.assetId)
    if (!res?.success || !res.data) {
      opts.notify(res?.message || opts.t('暂无可用的超分模型'), 'error')
      return
    }
    opts.applyTaskToNode(target.node.id, res.data)
    opts.pushHistory()
    void opts.refreshWallet()
    if (res.data.status === 'pending' || res.data.status === 'running') {
      opts.notify(opts.t('已提交超分任务'))
      opts.pollTask(target.node.id, res.data.id)
    }
    else if (res.data.status === 'failed') {
      opts.notify(res.data.error_msg || opts.t('生成失败'), 'error')
    }
  }

  function formatClock(seconds: number) {
    const total = Math.max(0, Math.floor(seconds || 0))
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
  }

  const retakeClip = computed(() => {
    const node = opts.selected.value
    if (!node || !isContentNode(node) || !isRetakeNode(node.data) || !node.data.retakeParams)
      return null
    const params = node.data.retakeParams
    const duration = params.duration || 5
    const start = params.start * duration
    const end = params.end * duration
    const span = Math.max(0, end - start)
    return {
      label: params.sourceLabel || opts.t('视频'),
      range: `${formatClock(start)}-${formatClock(end)}`,
      seconds: `${span.toFixed(1)}s`,
    }
  })

  return {
    extendOpen,
    extendBusy,
    extendSource,
    canVideoOps,
    canRetake,
    onNodeMenuRetake,
    onNodeMenuExtend,
    extendStudioOpen,
    extendStudioRef,
    extendStudioVariant,
    extendStudioSrc,
    extendStudioPrompt,
    extendStudioModels,
    extendStudioRefs,
    extendStudioBusy,
    extendStudioTotal,
    openExtendStudio,
    pickExtendStudioRefs,
    onExtendStudioSubmit,
    onExtendSubmit,
    onNodeMenuUpscale,
    retakeClip,
  }
}
