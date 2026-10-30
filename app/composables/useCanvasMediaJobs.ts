import { nextTick, type Ref } from 'vue'
import { cellNodeLayout, fitCellBox } from '~/utils/canvas-grid-split'
import mediaApi from '~/api/media'
import taskApi from '~/api/task'
import type { GenerationTask, MediaAction, MediaJob } from '~/types/creative'
import {
  firstMediaOutput,
  isMediaJobActive,
  mediaActionState,
  mediaGridLayout,
  mediaJobTaskState,
  mediaOutputPatch,
  mediaOutputWarning,
  mediaOutputsOf,
  mediaSourceRef,
  pickMediaSourceNode,
  retakeSegmentOutputs,
  splitAvOutputs,
  storyboardOutputs,
} from '~/utils/canvas-media-job'
import { isContentNode, nodeSize, type CanvasFlowNode } from '~/utils/canvas-group'
import { canvasStageSize, type CanvasNodeData, type CanvasNodeKind } from '~/utils/canvas-node-kinds'

type ContentNode = CanvasFlowNode & { data: CanvasNodeData }

export type CanvasMediaSpawnLayout = {
  place?: 'right' | 'down' | 'up'
  at?: { x: number, y: number }
  w?: number
  h?: number
  data?: Partial<CanvasNodeData>
  select?: boolean
  /** 默认从源节点连一条边。深度提取这类结果不连线 */
  link?: boolean
  /** false：结果落在画布根上，不跟源节点进同一个组 */
  parent?: boolean
}

/**
 * 媒体作业内核：派生节点、提交作业、产物写回。
 * 面板 / 工具条只调这里，不要再自己拼作业请求。
 */
export function useCanvasMediaJobs(opts: {
  findNode: (id: string) => CanvasFlowNode | undefined
  updateNodeData: (id: string, patch: Record<string, unknown>) => void
  updateNode: (id: string, patch: Record<string, unknown>) => void
  addNodes: (node: CanvasFlowNode) => void
  addEdges: (edge: any) => void
  addSelectedNodes: (nodes: any[]) => void
  nodes: Ref<CanvasFlowNode[]>
  edges: Ref<Array<{ source: string, target: string }>>
  counts: Record<CanvasNodeKind, number>
  defaultEdgeOptions: { type: string, animated: boolean }
  pushHistory: () => void
  notify: (title: string, color?: 'neutral' | 'error') => void
  t: (key: string, params?: Record<string, unknown>) => string
  canvasId: () => number
  refreshWallet: () => void
  pollMediaJob: (nodeId: string, jobId: number) => void
  pollTask: (nodeId: string, taskId: number) => void
  applyTaskToNode: (nodeId: string, task: GenerationTask) => void
  dropNode: (id: string) => void
  groupNodeList: (ids: string[]) => void
  gateSpend: (points: number) => Promise<boolean>
  estimateSpend: (model: string, params?: Record<string, unknown>, count?: number) => number
  /** 跟练期间的早退闸：两个真提交点（submitMediaJob / submitDerivedTask 里的 mediaApi.create 与 taskApi.create）都先问它 */
  blocked?: () => boolean
}) {
  const mediaActions = useState<MediaAction[]>('media-actions', () => [])

  async function loadMediaActions() {
    const res = await mediaApi.actions()
    if (res?.success && res.data)
      mediaActions.value = res.data
  }

  function ensureMediaAction(name: string) {
    const state = mediaActionState(mediaActions.value, name)
    if (state.available)
      return true
    opts.notify(state.reason || opts.t('该功能暂未开放'), 'error')
    return false
  }

  function mediaSourceOf(node: ContentNode) {
    const source = mediaSourceRef(node.data)
    if (source)
      return source
    opts.notify(opts.t('请先把视频保存到资产库'), 'error')
    return null
  }

  function mediaSourceNode(node: ContentNode, sourceId?: string): ContentNode {
    return pickMediaSourceNode(
      node,
      sourceId,
      id => opts.findNode(id) as ContentNode | undefined,
      opts.edges.value,
      (item): item is ContentNode => Boolean(item && isContentNode(item)),
    )
  }

  /**
   * 在源节点旁边挂一个承接产物的节点并连线。content 先留空，作业完成后由 applyMediaOutputs 写回。
   * place：right 右侧同排 / down 下方 / up 上方；at 直接指定画布坐标（拉片网格用）。
   */
  function spawnMediaNode(
    from: ContentNode,
    kind: 'image' | 'video' | 'audio',
    tag: string,
    label: string,
    layout: CanvasMediaSpawnLayout = {},
  ): ContentNode {
    const size = nodeSize(from)
    const stage = canvasStageSize(kind) || { w: 320, h: 220 }
    const w = layout.w ?? (kind === 'audio' ? Math.max(240, Math.min(size.w, 300)) : size.w)
    const h = layout.h ?? (kind === 'audio' ? stage.h : size.h)
    const gap = 80
    opts.counts[kind] += 1
    const id = `${kind}-${opts.counts[kind]}`
    const position = layout.at
      ? { ...layout.at }
      : layout.place === 'down'
        ? { x: from.position.x, y: from.position.y + size.h + 48 }
        : layout.place === 'up'
          ? { x: from.position.x + size.w + gap, y: from.position.y - h - 48 }
          : { x: from.position.x + size.w + gap, y: from.position.y }
    const sibling: ContentNode = {
      id,
      type: 'easytv',
      position,
      width: w,
      height: h,
      style: {
        ...(kind === 'video' && typeof from.style === 'object' && from.style ? from.style : {}),
        width: `${w}px`,
        height: `${h}px`,
      },
      data: {
        kind,
        label,
        tag,
        content: '',
        prompt: '',
        mode: 'idle',
        ...layout.data,
      },
    }
    if (from.parentNode && layout.parent !== false) {
      sibling.parentNode = from.parentNode
      sibling.extent = 'parent'
      sibling.expandParent = true
    }
    if (layout.select) {
      for (const node of opts.nodes.value)
        node.selected = false
      sibling.selected = true
    }
    opts.addNodes(sibling)
    if (layout.link !== false) {
      opts.addEdges({
        id: `e-${from.id}-${id}-${Date.now()}-${opts.counts[kind]}`,
        source: from.id,
        target: id,
        sourceHandle: 'out',
        targetHandle: 'in',
        ...opts.defaultEdgeOptions,
      })
    }
    if (layout.select) {
      nextTick(() => {
        const created = opts.findNode(id)
        if (created)
          opts.addSelectedNodes([created])
      })
    }
    return sibling
  }

  /** 改节点宽高（width/height 与 style 一起改，vue-flow 两处都认） */
  function resizeNode(node: ContentNode, size: { w: number, h: number }) {
    opts.updateNode(node.id, {
      width: size.w,
      height: size.h,
      style: {
        ...(typeof node.style === 'object' && node.style ? node.style : {}),
        width: `${size.w}px`,
        height: `${size.h}px`,
      },
    })
  }

  function spawnDerivedImage(
    from: ContentNode,
    tag: string,
    prompt: string,
    layout?: { place?: 'right' | 'down', w?: number, h?: number, label?: string },
  ) {
    const size = nodeSize(from)
    const w = layout?.w ?? size.w
    const h = layout?.h ?? size.h
    opts.counts.image += 1
    const id = `image-${opts.counts.image}`
    const sibling: CanvasFlowNode = {
      id,
      type: 'easytv',
      position: layout?.place === 'down'
        ? { x: from.position.x, y: from.position.y + size.h + 80 }
        : { x: from.position.x + size.w + 80, y: from.position.y },
      width: w,
      height: h,
      style: {
        ...(typeof from.style === 'object' && from.style ? from.style : {}),
        width: `${w}px`,
        height: `${h}px`,
      },
      data: {
        kind: 'image',
        label: layout?.label ?? opts.t(tag),
        tag,
        content: '',
        prompt,
        mode: 'idle',
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
    return sibling
  }

  function spawnDerivedText(from: ContentNode, tag: string) {
    const size = nodeSize(from)
    const stage = canvasStageSize('text') || { w: 252, h: 220 }
    opts.counts.text += 1
    const id = `text-${opts.counts.text}`
    const w = Math.max(stage.w, 320)
    const h = Math.max(stage.h, 260)
    const sibling: CanvasFlowNode = {
      id,
      type: 'easytv',
      position: { x: from.position.x + size.w + 80, y: from.position.y },
      width: w,
      height: h,
      style: { width: `${w}px`, height: `${h}px` },
      data: {
        kind: 'text',
        label: opts.t(tag),
        tag,
        content: '',
        prompt: '',
        mode: 'idle',
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
    return sibling
  }

  function spawnStoryboardFrames(from: ContentNode, frames: ReturnType<typeof storyboardOutputs>['frames']) {
    if (!frames.length)
      return []
    const size = nodeSize(from)
    const source = mediaSourceNode(from, from.data.frameParams?.sourceId)
    const srcSize = nodeSize(source)
    const cell = { w: 320, h: Math.max(120, Math.min(640, Math.round(320 * srcSize.h / Math.max(1, srcSize.w)))) }
    const { positions } = mediaGridLayout(frames.length, { x: from.position.x + size.w + 80, y: from.position.y }, cell, 24)
    const ids: string[] = []
    frames.forEach((frame, index) => {
      const node = spawnMediaNode(from, 'image', '拉片帧', `${opts.t('拉片帧')} ${index + 1}`, {
        at: positions[index],
        w: cell.w,
        h: cell.h,
        data: { content: frame.url, assetId: frame.asset_id > 0 ? frame.asset_id : undefined },
      })
      ids.push(node.id)
    })
    nextTick(() => opts.groupNodeList(ids))
    return ids
  }

  function applyMediaOutputs(node: ContentNode, job: MediaJob): Partial<CanvasNodeData> {
    const outputs = mediaOutputsOf(job)
    switch (job.action) {
      case 'split_av': {
        const { audio, video } = splitAvOutputs(outputs)
        const linkedId = node.data.mediaLinkedId
        if (audio && linkedId && opts.findNode(linkedId))
          opts.updateNodeData(linkedId, mediaOutputPatch(audio))
        return mediaOutputPatch(video)
      }
      case 'split': {
        const videos = outputs.filter(item => item.type === 'video' || item.type === 'audio')
        const linkedId = node.data.mediaLinkedId
        if (videos[1] && linkedId && opts.findNode(linkedId))
          opts.updateNodeData(linkedId, { ...mediaOutputPatch(videos[1]), taskStatus: 'succeeded', taskProgress: 100, taskError: '' })
        return mediaOutputPatch(videos[0] ?? firstMediaOutput(outputs))
      }
      case 'storyboard': {
        const { frames, analysisTaskId } = storyboardOutputs(outputs)
        const frameIds = spawnStoryboardFrames(node, frames)
        if (analysisTaskId > 0) {
          const size = nodeSize(node)
          const { cols } = mediaGridLayout(frames.length, { x: 0, y: 0 }, { w: 320, h: 180 }, 24)
          const offset = frameIds.length ? cols * (320 + 24) : 0
          const textNode = spawnDerivedText(node, '拉片解读')
          opts.updateNode(textNode.id, { position: { x: node.position.x + size.w + 80 + offset, y: node.position.y } })
          opts.updateNodeData(textNode.id, { taskId: analysisTaskId, taskStatus: 'running', taskProgress: 0, taskError: '' })
          opts.pollTask(textNode.id, analysisTaskId)
        }
        return {}
      }
      case 'grid_split': {
        // 第一片落在作业壳上，其余按原行列摆到源节点右侧，整批打成一组（切片一起选一起动）。
        // 尺寸：格子按源节点分数算，再用产物真实宽高等比收一下，源图不是标准比例时切片才不会被压扁；
        // 提示词：切片沿用源图的提示词（壳是从源节点派生的，prompt 已带过来），改起来有底稿。
        const images = outputs.filter(item => item.type === 'image')
        const geo = node.data.gridSplit
        const ids = [node.id]
        const prompt = String(node.data.prompt || '')
        images.slice(1).forEach((output, i) => {
          const cell = geo?.cells[i + 1]
          const layout = cell && geo ? cellNodeLayout(cell, geo.source) : null
          const fitted = layout ? fitCellBox({ w: output.width, h: output.height }, layout) : null
          const base = node.data.label.replace(/_1$/, '')
          const sibling = spawnMediaNode(node, 'image', opts.t('宫格切分'), `${base}_${i + 2}`, {
            ...(layout && fitted ? { at: { x: layout.x, y: layout.y }, w: fitted.w, h: fitted.h } : { place: 'down' as const }),
            data: { ...mediaOutputPatch(output), prompt, taskStatus: 'succeeded', taskProgress: 100, taskError: '' },
          })
          ids.push(sibling.id)
        })
        const first = images[0]
        const firstCell = geo?.cells[0]
        if (first && firstCell && geo)
          resizeNode(node, fitCellBox({ w: first.width, h: first.height }, cellNodeLayout(firstCell, geo.source)))
        if (ids.length > 1)
          nextTick(() => opts.groupNodeList(ids))
        return { ...mediaOutputPatch(first ?? firstMediaOutput(outputs)), gridSplit: undefined }
      }
      case 'transcribe': {
        // 字幕文本节点：正文优先用后端随产物下发的 SRT，没有就退回资产地址；逐句时间轴留在节点上
        const output = outputs.find(item => item.type === 'text') ?? firstMediaOutput(outputs)
        if (!output)
          return {}
        const patch: Partial<CanvasNodeData> = { content: output.text || output.url || '' }
        if (output.asset_id > 0)
          patch.assetId = output.asset_id
        if (output.cues?.length)
          patch.transcriptCues = output.cues
        return patch
      }
      case 'retake_segment': {
        const { full, segment } = retakeSegmentOutputs(outputs)
        if (segment)
          spawnMediaNode(node, 'video', '重拍片段', `${node.data.retakeParams?.sourceLabel || opts.t('视频')}_${opts.t('重拍片段')}`, { place: 'down', data: mediaOutputPatch(segment) })
        return mediaOutputPatch(full)
      }
      default:
        return mediaOutputPatch(firstMediaOutput(outputs))
    }
  }

  function applyMediaJobToNode(nodeId: string, job: MediaJob) {
    const node = opts.findNode(nodeId)
    if (!node || !isContentNode(node))
      return
    const patch: Record<string, unknown> = {
      ...mediaJobTaskState(job, opts.t('处理失败')),
      mediaJobId: job.id,
      mediaAction: job.action,
    }
    if (Number(job.task_id) > 0)
      patch.taskId = job.task_id
    if (job.status === 2) {
      Object.assign(patch, applyMediaOutputs(node, job))
      const warned = mediaOutputsOf(job).find(item => item.warning || item.warning_code)
      if (warned) {
        const warning = mediaOutputWarning(warned.warning, (key, params) => opts.t(key, params), {
          code: warned.warning_code,
          params: warned.warning_params,
        })
        if (warning)
          opts.notify(warning)
      }
    }
    if (job.status === -1 && node.data.mediaLinkedId && opts.findNode(node.data.mediaLinkedId))
      opts.updateNodeData(node.data.mediaLinkedId, { taskStatus: 'failed', taskProgress: 0, taskError: job.error || opts.t('处理失败') })
    opts.updateNodeData(nodeId, patch)
  }

  async function submitMediaJob(
    node: ContentNode,
    action: string,
    source: { asset_id?: number, task_id?: number },
    params: Record<string, unknown>,
    jobOpts: { label: string, model?: string, dropOnFail?: string[], linkedId?: string },
  ) {
    // 跟练期间画布只读：这条是真提交（会扣点），回放拦不到它，先退出跟练
    if (opts.blocked?.()) {
      opts.notify(opts.t('跟练中不能派生：先退出跟练'), 'error')
      return false
    }
    const res = await mediaApi.create({
      action,
      ...source,
      params,
      node_id: node.id,
      canvas_id: opts.canvasId() || undefined,
      model: jobOpts.model || undefined,
    })
    if (!res?.success || !res.data) {
      for (const id of jobOpts.dropOnFail || [])
        opts.dropNode(id)
      opts.notify(res?.message || opts.t('提交失败'), 'error')
      return false
    }
    const job = res.data
    opts.updateNodeData(node.id, { mediaLinkedId: jobOpts.linkedId, mediaAction: action })
    applyMediaJobToNode(node.id, job)
    opts.pushHistory()
    if (job.engine !== 'local')
      void opts.refreshWallet()
    if (isMediaJobActive(job.status)) {
      opts.notify(opts.t('已提交 {label}', { label: opts.t(jobOpts.label) }))
      opts.pollMediaJob(node.id, job.id)
    }
    else if (job.status === 2) {
      opts.notify(opts.t('{label} 处理完成', { label: node.data.label }))
    }
    else if (job.status === -1) {
      opts.notify(job.error || opts.t('处理失败'), 'error')
    }
    return true
  }

  async function submitDerivedTask(
    sibling: CanvasFlowNode,
    label: string,
    body: Omit<Parameters<typeof taskApi.create>[0], 'canvas_id' | 'node_id'>,
    options?: { confirm?: boolean },
  ) {
    // 同样先过跟练闸：这条会在 gateSpend 弹扣点确认后真 taskApi.create，挡不住就会真花点数
    if (opts.blocked?.()) {
      opts.notify(opts.t('跟练中不能派生：先退出跟练'), 'error')
      return null
    }
    // confirm: false 用在已经按总价确认过的批量提交，避免每一镜再问一次
    if (options?.confirm !== false && !await opts.gateSpend(opts.estimateSpend(String(body.model || ''), (body.params || {}) as Record<string, unknown>))) {
      opts.dropNode(sibling.id)
      return null
    }
    const res = await taskApi.create({ ...body, canvas_id: opts.canvasId() || undefined, node_id: sibling.id })
    if (!res?.success || !res.data) {
      opts.dropNode(sibling.id)
      opts.notify(res?.message || opts.t('提交失败'), 'error')
      return null
    }
    opts.applyTaskToNode(sibling.id, res.data)
    opts.pushHistory()
    void opts.refreshWallet()
    if (res.data.status === 'pending' || res.data.status === 'running') {
      opts.notify(opts.t('已提交 {label}', { label: opts.t(label) }))
      opts.pollTask(sibling.id, res.data.id)
    }
    else if (res.data.status === 'failed') {
      opts.notify(res.data.error_msg || opts.t('生成失败'), 'error')
    }
    return res.data
  }

  return {
    mediaActions,
    loadMediaActions,
    ensureMediaAction,
    mediaSourceOf,
    mediaSourceNode,
    spawnMediaNode,
    spawnDerivedImage,
    spawnDerivedText,
    spawnStoryboardFrames,
    applyMediaOutputs,
    applyMediaJobToNode,
    submitMediaJob,
    submitDerivedTask,
  }
}
