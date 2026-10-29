import { onScopeDispose, ref, type Ref } from 'vue'
import { batchApi } from '~/api/batch'
import canvasApi from '~/api/canvas'
import { batchActive, batchNodePatches } from '~/utils/create-batch'
import { matrixBatchItems, matrixLatestUnsubmitted, matrixNextOrigin, matrixNodeIds, matrixPlaceGraph, matrixPlanFromDerived, matrixPoints, MATRIX_BATCH_LAYER, type MatrixPlan, type MatrixSource } from '~/utils/canvas-matrix'
import { startHiddenAwarePoll } from '~/utils/hidden-poll'
import { absPosition, isGroupNode, type CanvasFlowNode } from '~/utils/canvas-group'
import type { CanvasNodeData, CanvasNodeKind } from '~/utils/canvas-node-kinds'
import type { BatchAction, CanvasGraph, GenerationBatch } from '~/types/creative'

/** 批次轮询间隔：与服务端批量编排的节奏一致（成片向导用同一个值） */
export const MATRIX_POLL_MS = 3000
/** 落图后等画布落库的节奏：服务端建批次要求 node_id 已在保存过的 graph 里（service/batch.go 的「画布里没有节点 %s」） */
export const MATRIX_SAVE_WAIT_MS = 500
export const MATRIX_SAVE_TRIES = 12

export type MatrixRunState = {
  /** 这次派生的批次标记：派生节点上带的 matrix.batchId */
  batchId: string
  sourceLabel: string
  /** 落图的派生节点 id（回滚用） */
  nodeIds: string[]
  /** 打组后的组 id（回滚时连组一起收） */
  groupId: string
  /** 确认过的预计点数，也是交给服务端的预算上限 */
  points: number
  /** 服务端批次（含条目）：面板按它显示排队 / 生成中 / 失败 / 暂停原因 */
  batch: GenerationBatch | null
  /** 落图或提交失败的原因（余额不足 / 模型未定价 / 参数被拒…）：不静默失败 */
  error: string
  /** 正在落图 + 保存复核 + 提交：整段都占着，别只包住落图 */
  busy: boolean
  /** 这次确认过的 plan：关面板再开还能重试提交（不跟面板一起卸载） */
  plan: MatrixPlan | null
  /** 派生节点 id → 标题：刷新恢复时按节点 data.label 填，不靠 plan 下标 */
  labels: Record<string, string>
}

/**
 * 一稿多版矩阵的落图与生成驱动：把面板算好的 plan 落到画布（复用 applyWorkflowGraph 的
 * place + toFlow 那条路径与既有打组能力），再把派生节点交给服务端批量（create-batch），
 * 用 utils/create-batch 的 batchNodePatches 把任务挂回节点、交给画布既有的任务轮询取结果。
 *
 * 只做画布与批次这两件事；规格组合 / 估价 / 多语言翻译都在面板与 utils/canvas-matrix 里。
 */
export function useCanvasMatrix(opts: {
  canvasId: () => number
  nodes: Ref<CanvasFlowNode[]>
  counts: Record<CanvasNodeKind, number>
  addNodes: (nodes: CanvasFlowNode[]) => void
  addEdges: (edge: any) => void
  defaultEdgeOptions: { type: string, animated: boolean }
  findNode: (id: string) => CanvasFlowNode | undefined
  updateNodeData: (id: string, patch: Record<string, unknown>) => void
  removeNodes: (ids: string[]) => void
  /** 既有的打组（useCanvasGenerate 的批量副本也走它） */
  groupNodeList: (ids: string[]) => void
  /** 画布既有的任务轮询：挂上新任务后取结果 */
  pollTask: (nodeId: string, taskId: number) => void
  /** 页面保存画布（会顺手把新画布建出来）；服务端建批次要求节点已落库，提交前要先存一次 */
  saveCanvas?: () => Promise<unknown>
  pushHistory: () => void
  notify: (title: string, color?: 'neutral' | 'error') => void
  t: (key: string, params?: Record<string, unknown>) => string
  track: (event: string, props?: Record<string, unknown>) => void
  refreshWallet: () => void
  /** 按节点 id 还原源视图（刷新后重试提交要用连线上游的首帧 / 参考图） */
  sourceOf?: (id: string) => MatrixSource | null
  /** 与面板同口径的估价：刷新后还原未提交 plan 时补上预算 */
  estimate?: (model: string, params: Record<string, unknown>) => number
}) {
  const run = ref<MatrixRunState | null>(null)

  let stopBatchPoll = () => {}
  let batchPollOn = false
  let polling = false

  function nextId(kind: string) {
    const key = kind as CanvasNodeKind
    const n = (opts.counts[key] || 0) + 1
    opts.counts[key] = n
    return `${kind}-${n}`
  }

  function patchState(patch: Partial<MatrixRunState>) {
    if (run.value)
      run.value = { ...run.value, ...patch }
  }

  /** 派生节点的 data 拷一份，别把面板里的模板对象直接挂到画布节点上 */
  function cloneData(data: Record<string, any>) {
    return JSON.parse(JSON.stringify(data)) as Record<string, any>
  }

  /** 派生节点标题：优先节点自己的 label（落图 / 恢复都能读到），缺了才回落 id */
  function nodeLabels(ids: string[]) {
    const map: Record<string, string> = {}
    for (const id of ids) {
      const data = opts.findNode(id)?.data as { label?: string } | undefined
      map[id] = String(data?.label || '').trim() || id
    }
    return map
  }

  /** 打组前的组 id 集合：打组用既有 groupNodeList，组 id 只能从差集里认（它不返回 id） */
  function groupIds() {
    return new Set(opts.nodes.value.filter(isGroupNode).map(node => node.id))
  }

  function notifyBatch(color: 'neutral' | 'error' = 'neutral') {
    const batch = run.value?.batch
    if (!batch)
      return
    if (batch.status === 'cancelled') {
      opts.notify(opts.t('已取消这次一稿多版生成'), color)
      return
    }
    if (batch.status === 'paused')
      return
    opts.notify(batch.failed
      ? opts.t('一稿多版生成完成：成功 {ok} 个，失败 {failed} 个', { ok: batch.succeeded, failed: batch.failed })
      : opts.t('一稿多版生成完成：{n} 个版本都出片了', { n: batch.succeeded }))
  }

  function applyBatch() {
    const items = run.value?.batch?.items ?? []
    const patches = batchNodePatches(items, id => Number((opts.findNode(id)?.data as { taskId?: number } | undefined)?.taskId) || 0)
    for (const { nodeId, patch } of patches) {
      opts.updateNodeData(nodeId, patch)
      const taskId = Number(patch.taskId) || 0
      if (taskId > 0)
        opts.pollTask(nodeId, taskId)
    }
  }

  async function loadBatch() {
    const canvasId = opts.canvasId()
    if (!canvasId)
      return
    const res = await batchApi.latest(canvasId)
    if (!res?.success || !run.value)
      return
    patchState({ batch: res.data ?? null })
    applyBatch()
    if (!batchActive(res.data)) {
      stopBatchPolling()
      opts.refreshWallet()
      notifyBatch()
    }
  }

  function ensureBatchPolling() {
    if (batchPollOn || !batchActive(run.value?.batch))
      return
    batchPollOn = true
    stopBatchPoll = startHiddenAwarePoll(() => pollOnce(), MATRIX_POLL_MS)
  }

  async function pollOnce() {
    if (polling)
      return
    polling = true
    try {
      await loadBatch()
    }
    finally {
      polling = false
    }
  }

  function stopBatchPolling() {
    stopBatchPoll()
    stopBatchPoll = () => {}
    batchPollOn = false
  }

  // 画布组件卸载（换页）时别再打批次接口；服务端批次自己会跑完
  onScopeDispose(stopBatchPolling)

  function wait(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * 落图后先确保画布存过：服务端建批次时按库里的画布 graph 校验每个条目 node_id
   * （easytv-api/service/batch.go：「画布里没有节点 %s」），不存就会首次提交必被拒。
   * 先请页面存一次（新画布也在这里被建出来），再用 GET 复核节点确实已经在库里的 graph 上——
   * 页面保存是串行的，可能排在自动保存后面，所以按节奏等一小会儿。
   */
  async function ensurePersisted(nodeIds: string[]): Promise<boolean> {
    if (!nodeIds.length)
      return false
    try {
      await opts.saveCanvas?.()
    }
    catch {
      // 保存失败的提示由页面给（它知道是冲突还是网络），这里只看复核结果
    }
    for (let i = 0; i < MATRIX_SAVE_TRIES; i += 1) {
      const canvasId = opts.canvasId()
      if (canvasId) {
        const res = await canvasApi.get(canvasId)
        const saved = new Set<string>()
        const graph = (res?.data?.graph ?? null) as CanvasGraph | null
        for (const node of graph?.nodes ?? [])
          saved.add(String((node as { id?: unknown })?.id ?? ''))
        if (nodeIds.every(id => saved.has(id)))
          return true
      }
      await wait(MATRIX_SAVE_WAIT_MS)
    }
    return false
  }

  function sourceView(id: string, fallbackLabel = ''): MatrixSource | null {
    const fromWorkspace = opts.sourceOf?.(id)
    if (fromWorkspace)
      return fromWorkspace
    const node = opts.findNode(id)
    if (!node)
      return null
    const data = node.data as CanvasNodeData | undefined
    return {
      id,
      kind: String(data?.kind || 'image'),
      label: String(data?.label || fallbackLabel || id),
      prompt: String(data?.prompt || ''),
      model: String(data?.model || ''),
      params: data?.params,
      data: data as unknown as Record<string, unknown>,
      assetId: Number(data?.assetId) || 0,
      content: String(data?.content || ''),
      talking: (data as { talking?: MatrixSource['talking'] } | undefined)?.talking,
    }
  }

  function restoreUnsubmitted() {
    const pending = matrixLatestUnsubmitted(opts.nodes.value)
    if (!pending)
      return
    const source = sourceView(pending.sourceId, pending.sourceLabel)
    if (!source)
      return
    const plan = matrixPlanFromDerived(source, pending.nodes, pending.batchId)
    if (!plan)
      return
    const first = pending.nodes[0]
    run.value = {
      batchId: pending.batchId,
      sourceLabel: pending.sourceLabel || source.label,
      nodeIds: pending.nodes.map(node => node.id),
      groupId: String(first?.parentNode || ''),
      points: opts.estimate ? matrixPoints(plan, opts.estimate).total : 0,
      batch: null,
      error: opts.t('这次派生还没提交生成：节点已在画布上，可重试提交'),
      busy: false,
      plan,
      labels: nodeLabels(pending.nodes.map(node => node.id)),
    }
  }

  /** 恢复：进画布时把服务端还在跑（或还有任务没挂回节点）的矩阵批次接上，刷新 / 换页后结果照样收得回 */
  async function restore() {
    if (run.value)
      return
    const canvasId = opts.canvasId()
    if (canvasId) {
      const res = await batchApi.latest(canvasId)
      const batch = res?.success ? res.data : null
      if (batch?.items?.some(item => item.layer === MATRIX_BATCH_LAYER)) {
        const items = batch.items.filter(item => item.layer === MATRIX_BATCH_LAYER)
        const nodeIds = items.map(item => item.node_id)
        // 没有活要接就不打扰：批次结束、任务也早挂到节点上了
        const needsAttach = items.some(item => item.task_id > 0
          && Number((opts.findNode(item.node_id)?.data as { taskId?: number } | undefined)?.taskId) !== item.task_id)
        if (batchActive(batch) || needsAttach) {
          const first = opts.findNode(nodeIds[0] || '')
          const marker = (first?.data as CanvasNodeData | undefined)?.matrix
          run.value = {
            batchId: marker?.batchId || `mx-restored-${batch.id}`,
            sourceLabel: String(marker?.sourceLabel || ''),
            nodeIds,
            groupId: '',
            points: Number(batch.estimate_points) || 0,
            batch,
            error: '',
            busy: false,
            plan: null,
            labels: nodeLabels(nodeIds),
          }
          applyBatch()
          ensureBatchPolling()
          return
        }
      }
    }
    restoreUnsubmitted()
  }

  /**
   * 落图 + 提交服务端批量。
   * 落图失败 / 提交失败都把原因写进 run.error（并提示一句），派生节点留在画布上可重试或回滚。
   */
  async function derive(plan: MatrixPlan, points: number) {
    if (run.value?.busy)
      return
    const t = opts.t
    if (batchActive(run.value?.batch)) {
      opts.notify(t('批次还在生成中，先取消或等它结束再派生'), 'error')
      return
    }
    if (run.value?.nodeIds.length && (run.value.error || !run.value.batch)) {
      opts.notify(t('这次派生的节点还在画布上，先回滚或重试提交'), 'error')
      return
    }
    const source = opts.findNode(plan.sourceId)
    if (!source) {
      opts.notify(t('源节点不在了，派生取消'), 'error')
      return
    }
    run.value = {
      batchId: plan.batchId,
      sourceLabel: String((source.data as { label?: string })?.label || ''),
      nodeIds: [],
      groupId: '',
      points,
      batch: null,
      error: '',
      busy: true,
      plan,
      labels: {},
    }
    try {
      // 落图：锚点（源节点 / 首帧图）复用既有 id，派生节点用新 id；边由 matrixPlaceGraph 走
      // placeWorkflowGraph + workflowNodesToFlow 生成，这里只负责塞进画布
      const origin = matrixNextOrigin(absPosition(source, opts.nodes.value), opts.nodes.value as any)
      const placed = matrixPlaceGraph(plan, origin, kind => nextId(kind))
      if (!placed.nodes.length) {
        patchState({ error: t('没有可以落图（派生）的版本') })
        opts.notify(t('没有可以派生的版本'), 'error')
        return
      }
      const before = groupIds()
      for (const node of opts.nodes.value)
        node.selected = false
      opts.addNodes(placed.nodes.map(node => ({
        ...node,
        selected: true,
        data: cloneData(node.data) as unknown as CanvasNodeData,
      })))
      let seq = 0
      for (const edge of placed.edges) {
        opts.addEdges({
          ...opts.defaultEdgeOptions,
          id: `e-${edge.source}-${edge.target}-${Date.now()}-${seq++}`,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle || 'out',
          targetHandle: edge.targetHandle || 'in',
        })
      }
      if (placed.derived.length > 1)
        opts.groupNodeList(placed.derived)
      opts.pushHistory()
      const group = opts.nodes.value.find(node => isGroupNode(node) && !before.has(node.id))
      patchState({
        nodeIds: placed.derived,
        groupId: group?.id || '',
        labels: nodeLabels(placed.derived),
      })

      // 服务端建批次要求条目 node_id 已在保存过的画布 graph 上：先存一次再复核
      // （新画布也会在这一步被建出来，所以要在读 canvasId 之前做）
      const persisted = await ensurePersisted(run.value?.nodeIds ?? [])
      const canvasId = opts.canvasId()
      if (!persisted || !canvasId) {
        patchState({ error: t('画布还没保存，派生节点已在画布上：保存画布后在节点上点生成') })
        opts.notify(t('画布还没保存，这次只落了节点、没有提交生成'), 'error')
        opts.track('canvas_matrix_derive', { canvas_id: canvasId, versions: plan.versions.length, submitted: false })
        return
      }
      // 同一画布同时只能有一个进行中的批次（API.md 13）
      const latest = await batchApi.latest(canvasId)
      if (latest?.success && batchActive(latest.data)) {
        patchState({ error: t('这张画布上还有一个批次没跑完：先在队列里等它结束或取消，再重试提交') })
        opts.notify(t('这张画布上还有一个批次没跑完，派生节点先留在画布上'), 'error')
        return
      }
      const items = matrixBatchItems(plan, run.value?.nodeIds ?? [])
      const res = await batchApi.create(canvasId, {
        items,
        budget_points: Math.max(0, Math.floor(points) || 0),
      })
      if (!res?.success || !res.data) {
        patchState({ error: res?.message || t('提交失败') })
        opts.notify(res?.message || t('提交失败'), 'error')
        opts.track('canvas_matrix_derive', { canvas_id: canvasId, versions: plan.versions.length, submitted: false })
        return
      }
      patchState({ batch: res.data })
      applyBatch()
      ensureBatchPolling()
      opts.track('canvas_matrix_derive', {
        canvas_id: canvasId,
        versions: plan.versions.length,
        submitted: true,
        estimate: res.data.estimate_points,
      })
      opts.notify(t('已派生 {n} 个版本并交给服务端生成，预计 {p} 积分，关掉页面也会继续', { n: items.length, p: res.data.estimate_points }))
      opts.refreshWallet()
    }
    finally {
      patchState({ busy: false })
    }
  }

  /** 重试提交：落图失败的批次条目重来一次（派生节点还在画布上，不重复落图） */
  async function resubmit(plan?: MatrixPlan) {
    const used = plan || run.value?.plan
    if (!run.value || run.value.busy || !used)
      return
    patchState({ busy: true, error: '', plan: used })
    try {
      // 上次失败常见原因就是「画布没存过」：重试前再存一次并复核（新画布也会在这里被建出来）
      if (!await ensurePersisted(run.value.nodeIds)) {
        const message = opts.t('画布还没保存，派生节点已在画布上：保存画布后在节点上点生成')
        patchState({ error: message })
        opts.notify(message, 'error')
        return
      }
      const canvasId = opts.canvasId()
      if (!canvasId) {
        const message = opts.t('画布还没保存，派生节点已在画布上：保存画布后在节点上点生成')
        patchState({ error: message })
        opts.notify(message, 'error')
        return
      }
      const items = matrixBatchItems(used, run.value.nodeIds)
      const res = await batchApi.create(canvasId, { items, budget_points: Math.max(0, Math.floor(run.value.points) || 0) })
      if (!res?.success || !res.data) {
        patchState({ error: res?.message || opts.t('提交失败') })
        opts.notify(res?.message || opts.t('提交失败'), 'error')
        return
      }
      patchState({ batch: res.data })
      applyBatch()
      ensureBatchPolling()
      opts.refreshWallet()
    }
    finally {
      patchState({ busy: false })
    }
  }

  async function action(name: BatchAction) {
    const batch = run.value?.batch
    if (!batch)
      return
    const res = await batchApi.action(batch.id, name)
    if (!res?.success || !res.data) {
      opts.notify(res?.message || opts.t('操作失败'), 'error')
      return
    }
    patchState({ batch: res.data })
    applyBatch()
    ensureBatchPolling()
    if (!batchActive(res.data))
      opts.refreshWallet()
  }

  /**
   * 回滚：先取消还在跑的批次（别让服务端继续花点数），再收回这次派生的节点与它们的连线，
   * 以及为它们打的组。只动带这个批次标记的节点，用户自己在画布上放的照留。
   */
  async function rollback() {
    const state = run.value
    if (!state)
      return
    if (batchActive(state.batch))
      await batchApi.action(state.batch!.id, 'cancel')
    // data 是内容节点 / 组的联合：先收窄成内容节点再读 matrix 标记
    const marked = (node: CanvasFlowNode) => (node.data as CanvasNodeData | undefined)?.matrix?.batchId === state.batchId
    const ids = state.nodeIds.length ? state.nodeIds : matrixNodeIds(opts.nodes.value, state.batchId)
    const left = opts.nodes.value.filter(node => !ids.includes(node.id) && !marked(node))
    const emptyGroup = state.groupId && !left.some(node => node.parentNode === state.groupId) ? [state.groupId] : []
    opts.removeNodes([...ids, ...emptyGroup])
    opts.pushHistory()
    opts.notify(opts.t('已回滚这次派生的 {n} 个节点', { n: ids.length }))
    stopBatchPolling()
    run.value = null
    opts.refreshWallet()
  }

  return {
    run,
    derive,
    resubmit,
    rollback,
    action,
    restore,
    stopBatchPolling,
  }
}
