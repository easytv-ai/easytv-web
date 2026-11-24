/**
 * 画布上的片段重拍、智能续写和超分。
 * 菜单是否可点、弹窗状态和提交都在这里；截取、分割、高清仍留在工作区。
 */
import { computed, nextTick, ref, watch, type ComputedRef, type Ref } from 'vue'
import assetApi from '~/api/asset'
import taskApi from '~/api/task'
import type { ConfirmOptions } from '~/composables/useConfirm'
import type { CanvasOverlayKey } from '~/composables/useCanvasToolOverlays'
import type { Asset, GeneratePayload, GenerationModel, GenerationTask, TaskInput } from '~/types/creative'
import { cameraMovesPrompt, isRetakeInProgress, RETAKE_SEGMENT_COUNT, type CanvasNodeData } from '~/utils/canvas-node-kinds'
import { isContentNode, isNodeLocked, nodeSize, type CanvasFlowNode } from '~/utils/canvas-group'
import { extendSourceWindow, type ExtendStudioPayload, type ExtendStudioRef } from '~/utils/canvas-extend-studio'
import { canvasMergeRunning } from '~/utils/canvas-merge-state'
import { isMediaUrl } from '~/utils/media'
import { shortModelName } from '~/utils/model-name'
import { hasVideoReference } from '~/utils/canvas-viral'

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

  /** 刚从源视频提交重拍时会选中新节点，这次不要把弹窗再打开一次 */
  const suppressRetakeStudio = ref(false)

  /** 片段重拍的结果节点：提交之后才落在源视频右侧，取消弹窗不会留下空节点 */
  function spawnRetakeNode(from: ContentNode) {
    const src = String(from.data.content || '').trim()
    if (!src || !isMediaUrl(src))
      return null
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
    opts.addNodes(sibling)
    opts.addEdges({
      id: `e-${from.id}-${id}-${Date.now()}`,
      source: from.id,
      target: id,
      sourceHandle: 'out',
      targetHandle: 'in',
      ...opts.defaultEdgeOptions,
    })
    suppressRetakeStudio.value = true
    nextTick(() => {
      const created = opts.findNode(id)
      if (created)
        opts.addSelectedNodes([created])
    })
    return sibling
  }

  /** 片段重拍：先在当前视频上圈选，发送后才派生结果节点 */
  function onNodeMenuRetake() {
    opts.nodeMenu.value = null
    const from = opts.selected.value
    if (!from || !isContentNode(from) || isNodeLocked(from, opts.nodes.value))
      return
    if (from.data.kind !== 'video' && from.data.kind !== 'director')
      return
    openExtendStudio('retake')
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
        icon: String(item.icon || ''),
        videoReference: hasVideoReference(item),
      }
    }))

  /** 续写弹窗的默认提示词。在源视频上发起片段重拍时留空，写的是这一段要改成什么 */
  const extendStudioPrompt = computed(() => {
    const node = opts.findNode(extendStudioNodeId.value)
    if (!node || !isContentNode(node))
      return ''
    if (extendStudioVariant.value === 'retake' && !isRetakeInProgress(node.data))
      return ''
    return String(node.data.prompt || '')
  })

  /** 片段重拍弹窗的段数：跟重拍节点的 retakeParams 走 */
  const extendStudioTotal = computed(() => {
    const node = opts.findNode(extendStudioNodeId.value)
    const total = (node?.data as { retakeParams?: { total?: number } } | undefined)?.retakeParams?.total
    return Number(total) || RETAKE_SEGMENT_COUNT
  })

  /** 再次打开重拍节点时，时间轴停在上次圈的那一段 */
  const extendStudioRange = computed(() => {
    if (extendStudioVariant.value !== 'retake')
      return null
    const node = opts.findNode(extendStudioNodeId.value)
    if (!node || !isContentNode(node) || !isRetakeInProgress(node.data) || !node.data.retakeParams)
      return null
    return {
      start: node.data.retakeParams.start,
      end: node.data.retakeParams.end,
    }
  })

  /** 再次选中已有的重拍节点时打开弹窗。刚提交产生的那次选中跳过 */
  watch(opts.showRetakeStrip, (on) => {
    if (!on)
      return
    if (suppressRetakeStudio.value) {
      suppressRetakeStudio.value = false
      return
    }
    openExtendStudio('retake')
  })

  /** 智能续写大弹窗：模型 / 类型 / 风格 / 资产 / 运镜 / 输出规格都在弹窗里选 */
  function openExtendStudio(variant: 'extend' | 'retake' = 'extend') {
    const node = opts.selected.value
    if (!node || !isContentNode(node))
      return
    if (variant === 'retake') {
      if (node.data.kind !== 'video' && node.data.kind !== 'director')
        return
    }
    else if (node.data.kind !== 'video') {
      return
    }
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

  /**
   * 视频延长要交给模型的源视频。
   * 选区贴着整段且已入库时直接用原素材；否则在浏览器裁出选区再上传。
   * 失败时已经提示过，返回 null。
   */
  async function extendReferenceVideoId(node: ContentNode, payload: ExtendStudioPayload) {
    const model = opts.generationModels.value.find(item => item.model === payload.model)
    if (!hasVideoReference(model)) {
      opts.notify(opts.t('这个模型不能接视频，请换一个支持参考视频的模型'), 'error')
      return null
    }
    const assetId = Number(node.data.assetId) || 0
    const clip = extendSourceWindow(payload.range)
    if (!clip && assetId > 0)
      return assetId
    const duration = Number(payload.range.duration) || 0
    const start = clip?.start ?? 0
    const end = clip?.end ?? duration
    if (!(end > start + 0.08)) {
      opts.notify(opts.t('请先把视频保存到资产库'), 'error')
      return null
    }
    const src = extendStudioSrc.value
    if (!src) {
      opts.notify(opts.t('请先生成或添加一段视频'), 'error')
      return null
    }
    if (canvasMergeRunning.value) {
      opts.notify(opts.t('canvas.cut.busy'))
      return null
    }
    canvasMergeRunning.value = true
    try {
      const { trimVideoBlob } = await import('~/utils/canvas-video-merge.ffmpeg')
      const blob = await trimVideoBlob(src, start, end)
      const file = new File([blob], 'extend-source.mp4', { type: 'video/mp4' })
      const uploaded = await assetApi.upload(file)
      if (!uploaded?.success || !uploaded.data?.id) {
        opts.notify(uploaded?.message || opts.t('提交失败'), 'error')
        return null
      }
      return Number(uploaded.data.id)
    }
    catch {
      opts.notify(opts.t('读不到这段视频，请重试'), 'error')
      return null
    }
    finally {
      canvasMergeRunning.value = false
    }
  }

  /** 智能续写弹窗提交：延长和片段重拍都把选中的视频交给模型，首尾帧才用静帧 */
  async function onExtendStudioSubmit(payload: ExtendStudioPayload) {
    const node = opts.findNode(extendStudioNodeId.value)
    if (!node || !isContentNode(node))
      return
    if (extendStudioBusy.value)
      return
    // 视频延长描述的是下一段。空着，或原样带着上一条成片的提示词，都换成承接句，避免重拍同一镜
    let basePrompt = payload.prompt.trim()
    if (payload.type === 'extend') {
      const sourcePrompt = String(node.data.prompt || '').trim()
      if (!basePrompt || basePrompt === sourcePrompt)
        basePrompt = opts.t('承接上一段画面，自然延续镜头与动作')
    }
    // 风格 / 运镜拼进提示词（与对话栏同一形态：风格一行在前，运镜一行在后）
    let finalPrompt = basePrompt
    if (payload.style)
      finalPrompt = `${opts.t('风格：{style}', { style: payload.style })}\n${finalPrompt}`
    const camLine = cameraMovesPrompt(payload.cameras)
    if (camLine)
      finalPrompt = `${finalPrompt}\n${opts.t('运镜：{moves}', { moves: camLine })}`

    if (payload.type === 'retake') {
      if (!payload.model || !hasVideoReference(opts.generationModels.value.find(item => item.model === payload.model))) {
        opts.notify(opts.t(payload.model ? '这个模型不能接视频，请换一个支持参考视频的模型' : '暂无支持参考视频的模型'), 'error')
        return
      }
      // 在源视频上发起时，发送这一刻才把结果节点放到右侧；还在出片的重拍节点则改它自己
      const spawned = isRetakeInProgress(node.data) ? node : spawnRetakeNode(node)
      const params = spawned?.data.retakeParams
      if (!spawned || !params) {
        opts.notify(opts.t('请先生成或添加一段视频'), 'error')
        return
      }
      extendStudioOpen.value = false
      opts.updateNodeData(spawned.id, {
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
      const target = opts.findNode(spawned.id)
      if (target && isContentNode(target))
        await opts.submitRetakeSegment(target, {
          model: payload.model,
          params: {
            duration: payload.seconds,
            resolution: payload.resolution,
            ratio: payload.ratio,
            audio: payload.audio,
          },
          prompt: finalPrompt,
        })
      return
    }

    const needsVideo = payload.type === 'extend' || payload.type === 'reference' || payload.type === 'edit'
    if (!payload.model) {
      opts.notify(opts.t(needsVideo ? '暂无支持参考视频的模型' : '暂无可用的视频模型'), 'error')
      return
    }
    if (needsVideo && !hasVideoReference(opts.generationModels.value.find(item => item.model === payload.model))) {
      opts.notify(opts.t('这个模型不能接视频，请换一个支持参考视频的模型'), 'error')
      return
    }
    // 全能参考 / 视频编辑要源视频已入库。延长按选区裁好再传；首尾帧用浏览器抽出的尾帧
    const assetId = Number(node.data.assetId)
    if ((payload.type === 'reference' || payload.type === 'edit') && !(assetId > 0)) {
      opts.notify(opts.t('请先把视频保存到资产库'), 'error')
      return
    }
    if (payload.type === 'fl2v' && !payload.firstFrameAssetId) {
      opts.notify(opts.t('没能抽出选区尾帧，请重试或换一段视频'), 'error')
      return
    }
    extendStudioBusy.value = true
    try {
      let extendVideoId = 0
      if (payload.type === 'extend') {
        const id = await extendReferenceVideoId(node, payload)
        if (!id)
          return
        extendVideoId = id
      }
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
      if (payload.type === 'extend') {
        inputs.push({ asset_id: extendVideoId, role: 'reference_video' })
        for (const item of payload.refs) {
          const role = item.kind === 'video' ? 'reference_video' : item.kind === 'audio' ? 'reference_audio' : 'reference'
          inputs.push({ asset_id: item.assetId, role })
        }
      }
      else if (payload.type === 'fl2v') {
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
    if (!node || !isContentNode(node) || !isRetakeInProgress(node.data) || !node.data.retakeParams)
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
    extendStudioRange,
    openExtendStudio,
    pickExtendStudioRefs,
    onExtendStudioSubmit,
    onNodeMenuUpscale,
    retakeClip,
  }
}
