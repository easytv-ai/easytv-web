import { absPosition, isContentNode, isGroupNode, nodeSize, type CanvasFlowNode, type CanvasGroupData } from '~/utils/canvas-group'
import { canvasGenerateTaskType, planCanvasGenerate } from '~/utils/canvas-generate-plan'
import { nodeGeneratePatch } from '~/utils/canvas-node-params'
import { canvasNodeTitle, isRetakeNode, type CanvasNodeData, type CanvasNodeKind } from '~/utils/canvas-node-kinds'
import { canvasConnectedRefs, canvasNodeMediaUrl } from '~/utils/canvas-refs'
import { buildCanvasTaskInputs, countUnlinkedCanvasRefs, pushCanvasRefImage, type CanvasRefImage } from '~/utils/canvas-task-inputs'
import { syncViralPromptRefs, viralExtraRefCount } from '~/utils/canvas-viral'
import { makeInputSnapshot, type InputSnapshot } from '~/utils/canvas-upstream'
import type { GeneratePayload, GenerationModel, GenerationTask, TaskInput, TaskType } from '~/types/creative'
import taskApi from '~/api/task'
import type { Ref } from 'vue'

/** 本会话已提醒过「近期失败多」的模型，切画布也不重复提醒 */
const warnedModels = new Set<string>()

type ContentNode = CanvasFlowNode & { data: CanvasNodeData }

type TaskRequest = {
  type: TaskType
  model: string
  prompt: string
  params: Record<string, unknown>
  inputs: TaskInput[]
  subjectIds: number[]
  subjectVersions?: Record<string, number>
  lang?: string
  voice?: string
}

/**
 * 画布生成：拼 inputs、提交任务、批量出图。
 */
export function useCanvasGenerate(opts: {
  selected: Ref<CanvasFlowNode | null>
  inspectorRef: Ref<{ generatePayload?: () => GeneratePayload, videoMode?: string } | null>
  canvasId: () => number
  findNode: (id: string) => CanvasFlowNode | undefined
  nodes: Ref<CanvasFlowNode[]>
  edges: Ref<Array<{ source: string, target: string }>>
  counts: Record<CanvasNodeKind, number>
  addNodes: (node: CanvasFlowNode) => void
  addEdges: (edge: any) => void
  defaultEdgeOptions: { type: string, animated: boolean }
  applyMediaNodeSize: (id: string, w?: number, h?: number) => void
  applyTaskToNode: (id: string, task: GenerationTask) => void
  /** 盖输入快照（canvas-upstream）：任务提交成功时调用，失败不盖 */
  stampInputSnapshot: (id: string, snapshot: InputSnapshot) => void
  /** 跟练回放（useCanvasPractice）：返回 true 表示这次提交已被跟练接住 */
  replaySubmit?: (node: CanvasFlowNode, req: TaskRequest) => boolean
  pollTask: (id: string, taskId: number) => void
  /** 提交后等这条跑完再放下一条，画布只能同时跑一条 */
  waitTask?: (nodeId: string, taskId: number, timeoutMs?: number) => Promise<unknown>
  /** 提交前补分镜参考线，角色图才能进 inputs */
  beforeGenerate?: (node: CanvasFlowNode) => void
  pushHistory: () => void
  notify: (title: string, color?: 'neutral' | 'error') => void
  t: (key: string, params?: Record<string, unknown>) => string
  track: (event: string, props?: Record<string, unknown>) => void
  gateSpend: (points: number) => Promise<boolean>
  estimateSpend: (model: string, params?: Record<string, unknown>, count?: number) => number
  /** 查所选模型的清单行（API.md 37 recent_warn）；没有就不提醒 */
  modelInfo?: (model: string) => GenerationModel | undefined
  refreshWallet: () => void
  submitRetakeSegment: (node: ContentNode, payload?: GeneratePayload) => Promise<void>
  connectedTextPrompt: (id: string) => string
  nodePlainText: (node: CanvasFlowNode) => string
  groupNodeList: (ids: string[]) => void
  joinGroup: (group: CanvasFlowNode & { data: CanvasGroupData }, ids: string[]) => void
  linkedImageOf: (edge: { source: string, target: string }, nodeId: string) => ContentNode | null
  nodeImageUrl: (node: CanvasFlowNode) => string
  uploadedRefList: (data: CanvasNodeData) => Array<{ assetId?: number, url: string, name?: string }>
  mediaKindOfUrl: (url: string) => 'image' | 'video' | 'audio'
  dropNode: (id: string) => void
}) {
  function collectRefImages(node: ContentNode) {
    const items: CanvasRefImage[] = []
    const seenId = new Set<number>()
    const seenUrl = new Set<string>()
    const linked = new Set<string>()
    for (const edge of opts.edges.value) {
      const src = opts.linkedImageOf(edge, node.id)
      if (!src || linked.has(src.id))
        continue
      linked.add(src.id)
      pushCanvasRefImage(items, seenId, seenUrl, src.data.assetId, opts.nodeImageUrl(src))
    }
    for (const item of opts.uploadedRefList(node.data)) {
      if (opts.mediaKindOfUrl(item.url) === 'image')
        pushCanvasRefImage(items, seenId, seenUrl, item.assetId, item.url)
    }
    return items
  }

  /** 连进来的视频 / 音频。图片仍走 collectRefImages，避免和首帧角色混在一起 */
  function connectedMediaRefs(node: ContentNode) {
    return canvasConnectedRefs(node.id, node.data.kind, opts.edges.value, (id) => {
      const other = opts.findNode(id)
      if (!other || !isContentNode(other))
        return null
      return {
        id: other.id,
        kind: other.data.kind,
        assetId: other.data.assetId,
        url: canvasNodeMediaUrl(other),
      }
    })
      .filter(item => item.kind === 'video' || item.kind === 'audio')
      .map(item => ({ assetId: item.assetId, url: item.url, kind: item.kind }))
  }

  function buildTaskInputs(node: ContentNode, mode = '') {
    const extra = [
      ...connectedMediaRefs(node),
      ...opts.uploadedRefList(node.data).map(item => ({
        assetId: item.assetId,
        url: item.url,
        kind: opts.mediaKindOfUrl(item.url),
      })),
    ]
    return buildCanvasTaskInputs(node, mode, collectRefImages(node), extra)
  }

  function countUnlinkedRefs(node: ContentNode) {
    return countUnlinkedCanvasRefs(node, collectRefImages(node))
  }

  /** 一次生成从点击到提交返回都算进行中，挡住连点和 ⌘/Ctrl+Enter */
  const submitting = ref(false)

  function spawnBatchSibling(node: ContentNode, index: number) {
    const size = nodeSize(node)
    const abs = absPosition(node, opts.nodes.value)
    opts.counts[node.data.kind] += 1
    const sibling: CanvasFlowNode = {
      id: `${node.data.kind}-${opts.counts[node.data.kind]}`,
      type: 'easytv',
      position: { x: abs.x + index * (size.w + 24), y: abs.y },
      width: size.w,
      height: size.h,
      style: {
        ...(typeof node.style === 'object' && node.style ? node.style : {}),
        width: `${size.w}px`,
        height: `${size.h}px`,
      },
      data: {
        ...node.data,
        refItems: node.data.refItems?.map(item => ({ ...item })),
        subjectIds: node.data.subjectIds ? [...node.data.subjectIds] : undefined,
        subjectVersions: node.data.subjectVersions ? { ...node.data.subjectVersions } : undefined,
        camera: node.data.camera ? { ...node.data.camera } : undefined,
        label: canvasNodeTitle(node.data.kind, opts.counts[node.data.kind], opts.t),
        content: '',
        assetId: undefined,
        taskId: undefined,
        taskStatus: '',
        taskProgress: 0,
        taskError: '',
      },
    }
    opts.addNodes(sibling)
    const incoming = opts.edges.value.filter(edge => edge.target === node.id)
    incoming.forEach((edge, i) => {
      opts.addEdges({
        ...opts.defaultEdgeOptions,
        id: `e-${edge.source}-${sibling.id}-${Date.now()}-${i}`,
        source: edge.source,
        target: sibling.id,
        sourceHandle: 'out',
        targetHandle: 'in',
      })
    })
    return sibling
  }

  async function submitNodeTask(node: CanvasFlowNode, req: TaskRequest) {
    // 跟练回放：跟练期间所有提交都被它接住，返回 true 就不再真调接口（不花点数、不写库）
    if (opts.replaySubmit?.(node, req))
      return true
    const res = await taskApi.create({
      type: req.type,
      model: req.model,
      prompt: req.prompt,
      params: req.params,
      inputs: req.inputs,
      canvas_id: opts.canvasId() || undefined,
      node_id: node.id,
      subject_ids: req.subjectIds.length ? req.subjectIds : undefined,
      subject_versions: req.subjectIds.length && req.subjectVersions && Object.keys(req.subjectVersions).length ? req.subjectVersions : undefined,
      lang: req.type === 'audio' ? req.lang || undefined : undefined,
      voice: req.type === 'audio' ? req.voice || undefined : undefined,
    })
    if (!res?.success || !res.data) {
      opts.notify(res?.message || opts.t('提交失败'), 'error')
      return false
    }
    // 记下这次生成用的输入（模型 / 节点提示词原文 / 各上游产物签名）：之后上游或参数一变，
    // 这个节点的结果就能被标成「已过期」，用户按一下按当前输入重跑，不必整条链从头再来。
    opts.stampInputSnapshot(node.id, makeInputSnapshot({
      model: req.model,
      prompt: String((node.data as { prompt?: string } | undefined)?.prompt || ''),
      upstream: opts.edges.value
        .filter(edge => edge.target === node.id)
        .map(edge => opts.findNode(edge.source))
        .filter((item): item is CanvasFlowNode => Boolean(item))
        .map(item => ({ id: item.id, data: item.data })),
    }))
    opts.applyTaskToNode(node.id, res.data)
    if (res.data.status === 'pending' || res.data.status === 'running')
      opts.pollTask(node.id, res.data.id)
    else if (res.data.status === 'failed')
      opts.notify(res.data.error_msg || opts.t('生成失败'), 'error')
    return true
  }

  let generateTail = Promise.resolve()
  let generateQueued = 0

  function generateWaitMs(node: CanvasFlowNode) {
    if (!isContentNode(node))
      return 180_000
    if (node.data.kind === 'video')
      return 600_000
    if (node.data.kind === 'audio')
      return 360_000
    return 180_000
  }

  async function onGenerate(payload?: GeneratePayload, target?: CanvasFlowNode) {
    const node = target ?? opts.selected.value
    if (!node || !isContentNode(node)) {
      opts.notify(opts.t('请先选择节点'))
      return
    }
    if (node.data.taskStatus === 'pending' || node.data.taskStatus === 'running') {
      opts.notify(opts.t('该节点正在生成中'))
      return
    }
    generateQueued++
    if (generateQueued > 1)
      opts.notify(opts.t('已排队，上一条完成后开始'))
    const job = generateTail.then(() => runQueuedGenerate(payload, node), () => runQueuedGenerate(payload, node))
    generateTail = job.then(() => undefined, () => undefined)
    try {
      await job
    }
    finally {
      generateQueued--
    }
  }

  async function runQueuedGenerate(payload?: GeneratePayload, node?: CanvasFlowNode) {
    if (!node || !isContentNode(node))
      return
    if (node.data.taskStatus === 'pending' || node.data.taskStatus === 'running') {
      opts.notify(opts.t('该节点正在生成中'))
      return
    }
    const before = Number(node.data.taskId) || 0
    submitting.value = true
    try {
      await runGenerate(payload, node)
    }
    catch (error) {
      opts.notify(error instanceof Error && error.message ? error.message : opts.t('提交失败'), 'error')
    }
    finally {
      submitting.value = false
    }
    const taskId = Number(node.data.taskId) || 0
    const status = String(node.data.taskStatus || '')
    if (!opts.waitTask || taskId <= 0 || taskId === before)
      return
    if (status !== 'pending' && status !== 'running')
      return
    await opts.waitTask(node.id, taskId, generateWaitMs(node))
  }

  async function runGenerate(payload?: GeneratePayload, target?: CanvasFlowNode) {
    const node = target ?? opts.selected.value
    if (!node || !isContentNode(node)) {
      opts.notify(opts.t('请先选择节点'))
      return
    }
    opts.beforeGenerate?.(node)
    const type = canvasGenerateTaskType(node.data.kind)
    if (!type) {
      opts.notify(opts.t('请先选择节点'))
      return
    }
    // 跟练回放要挡在扣点确认之前：失败演练和普通回放都不该弹出真实消耗
    if (opts.replaySubmit?.(node, { type } as TaskRequest))
      return
    payload = payload || opts.inspectorRef.value?.generatePayload?.()
    if (isRetakeNode(node.data)) {
      await opts.submitRetakeSegment(node, payload)
      return
    }
    const draftParams = payload?.params
    const mode = typeof draftParams?.mode === 'string' ? draftParams.mode : (opts.inspectorRef.value?.videoMode || '')
    const inputs = buildTaskInputs(node, mode)
    // 爆款复刻的提示词把参考数写死了。再点生成时按当次 inputs 改那一句，其它提示词不动
    const syncedPrompt = syncViralPromptRefs(
      String(node.data.prompt || ''),
      viralExtraRefCount(inputs, Number(node.data.viralSourceAssetId) || 0),
    )
    if (syncedPrompt !== (node.data.prompt || ''))
      node.data.prompt = syncedPrompt
    const plan = planCanvasGenerate({
      node,
      payload,
      connectedText: opts.connectedTextPrompt(node.id),
      plainText: opts.nodePlainText(node),
      inputs,
      unlinkedRefs: countUnlinkedRefs(node),
      canvasId: opts.canvasId(),
      translate: key => opts.t(key),
      alreadyWarned: Boolean(payload?.model && warnedModels.has(payload.model)),
      recentWarn: payload?.model ? opts.modelInfo?.(payload.model) : undefined,
    })
    if (!plan.ok) {
      opts.notify(opts.t(plan.messageKey))
      return
    }
    for (const notice of plan.notices) {
      if (notice.track)
        opts.track(notice.track.event, notice.track.props)
      if (notice.warnModel)
        warnedModels.add(notice.warnModel)
      opts.notify(opts.t(notice.key, notice.params))
    }
    if (!await opts.gateSpend(opts.estimateSpend(plan.model, plan.params, plan.wanted)))
      return
    const req: TaskRequest = {
      type: plan.type,
      model: plan.model,
      prompt: plan.prompt,
      params: plan.params,
      inputs: plan.inputs,
      subjectIds: plan.subjectIds,
      subjectVersions: plan.subjectVersions,
      lang: plan.lang,
      voice: plan.voice,
    }
    // 把这次用的模型与档位记回节点（L21）：之后再点开还是这套，批量的副本也一起带上，不是空节点
    Object.assign(node.data, nodeGeneratePatch(plan.model, plan.params))

    if (plan.ratio) {
      const [aw, ah] = plan.ratio.split(':').map(Number)
      if (aw && ah)
        opts.applyMediaNodeSize(node.id, aw, ah)
    }

    if (!await submitNodeTask(node, req)) {
      void opts.refreshWallet()
      return
    }
    const batch: string[] = [node.id]
    for (let i = 1; i < plan.wanted; i++) {
      const sibling = spawnBatchSibling(node, i)
      if (!await submitNodeTask(sibling, req)) {
        opts.dropNode(sibling.id)
        break
      }
      batch.push(sibling.id)
    }
    if (batch.length > 1) {
      const parent = node.parentNode ? opts.nodes.value.find(item => item.id === node.parentNode) : null
      if (isGroupNode(parent))
        opts.joinGroup(parent, batch.slice(1))
      else
        opts.groupNodeList(batch)
      opts.notify(opts.t('已提交 {label}，共 {n} 张', { label: node.data.label, n: batch.length }))
    }
    else {
      opts.notify(opts.t('已提交 {label}', { label: node.data.label }))
      opts.pushHistory()
    }
    void opts.refreshWallet()
  }

  return {
    collectRefImages,
    buildTaskInputs,
    countUnlinkedRefs,
    spawnBatchSibling,
    submitNodeTask,
    submitting,
    onGenerate,
  }
}
