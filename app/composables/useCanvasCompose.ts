import { onScopeDispose, ref, type Ref } from 'vue'
import { composeApi } from '~/api/screenplay'
import type { ComposeJob } from '~/types/creative'
import {
  composeNodeSize,
  composeReady,
  composeTimeline,
  type ComposeOptions,
  type ComposeSource,
} from '~/utils/canvas-compose'
import type { CanvasMediaSpawnLayout } from '~/composables/useCanvasMediaJobs'
import { isContentNode, type CanvasFlowNode } from '~/utils/canvas-group'
import type { CanvasNodeData } from '~/utils/canvas-node-kinds'
import { startHiddenAwarePoll } from '~/utils/hidden-poll'

type ComposeContentNode = CanvasFlowNode & { data: CanvasNodeData }

/** 与成片向导合成轮询同一节奏 */
export const COMPOSE_POLL_MS = 3000

export type ComposeRunState = {
  nodeId: string
  sourceIds: string[]
  job: ComposeJob | null
  error: string
  busy: boolean
}

export type ComposeSubmitHooks = {
  onNode?: (id: string) => void
  onDone?: (result: { ok: boolean, nodeId?: string, error?: string }) => void
}

/**
 * 画布多段合成：先把画布存一次（合成按 node_id 找已落库的视频），
 * 再在选区右侧落一个空视频节点，把这次时间线快照交给 compose 接口，轮询写回。
 */
export function useCanvasCompose(opts: {
  canvasId: () => number
  nodes: Ref<CanvasFlowNode[]>
  findNode: (id: string) => CanvasFlowNode | undefined
  updateNodeData: (id: string, patch: Record<string, unknown>) => void
  spawnMediaNode: (
    from: ComposeContentNode,
    kind: 'image' | 'video' | 'audio',
    tag: string,
    label: string,
    layout?: CanvasMediaSpawnLayout,
  ) => ComposeContentNode
  dropNode: (id: string) => void
  requestSave?: () => Promise<unknown>
  pushHistory: () => void
  notify: (title: string, color?: 'neutral' | 'error') => void
  t: (key: string, params?: Record<string, unknown>) => string
  track: (event: string, props?: Record<string, unknown>) => void
  blocked?: () => boolean
}) {
  const run = ref<ComposeRunState | null>(null)
  let stopPoll = () => {}
  let submitHooks: ComposeSubmitHooks | undefined

  function settleSubmit(result: { ok: boolean, nodeId?: string, error?: string }) {
    const hooks = submitHooks
    submitHooks = undefined
    hooks?.onDone?.(result)
  }

  function patchRun(patch: Partial<ComposeRunState>) {
    if (run.value)
      run.value = { ...run.value, ...patch }
  }

  function applyJob(nodeId: string, job: ComposeJob) {
    const progress = Math.min(100, Math.max(0, Number(job.progress) || 0))
    if (job.status === 2) {
      opts.updateNodeData(nodeId, {
        content: job.output_url || '',
        assetId: job.output_asset_id || undefined,
        composeJobId: job.id,
        taskStatus: 'succeeded',
        taskProgress: 100,
        taskError: '',
      })
      return
    }
    if (job.status === -1) {
      opts.updateNodeData(nodeId, {
        composeJobId: job.id,
        taskStatus: 'failed',
        taskProgress: progress,
        taskError: job.error || '',
      })
      return
    }
    opts.updateNodeData(nodeId, {
      composeJobId: job.id,
      taskStatus: 'running',
      taskProgress: progress,
      taskError: '',
    })
  }

  function stopComposePoll() {
    stopPoll()
    stopPoll = () => {}
  }

  async function pollOnce() {
    const current = run.value
    const jobId = current?.job?.id
    if (!current || !jobId)
      return
    const res = await composeApi.get(jobId)
    if (!res?.success || !res.data)
      return
    applyJob(current.nodeId, res.data)
    patchRun({ job: res.data })
    if (res.data.status === 2) {
      stopComposePoll()
      patchRun({ busy: false, error: '' })
      opts.pushHistory()
      opts.track('canvas_compose_ok', {
        canvas_id: opts.canvasId(),
        compose_id: res.data.id,
        clips: current.sourceIds.length,
        duration: res.data.duration,
        preview: Boolean(res.data.preview),
      })
      opts.notify(res.data.warning
        ? opts.t('canvas.compose.warn', { warning: res.data.warning })
        : opts.t('canvas.compose.ok'))
      settleSubmit({ ok: true, nodeId: current.nodeId })
      return
    }
    if (res.data.status === -1) {
      stopComposePoll()
      const message = res.data.error || opts.t('canvas.compose.failed')
      patchRun({ busy: false, error: message })
      opts.notify(message, 'error')
      settleSubmit({ ok: false, nodeId: current.nodeId, error: message })
    }
  }

  function watchJob() {
    stopComposePoll()
    const job = run.value?.job
    if (!job || (job.status !== 0 && job.status !== 1))
      return
    stopPoll = startHiddenAwarePoll(() => { void pollOnce() }, COMPOSE_POLL_MS)
  }

  async function submit(ordered: ComposeSource[], options: ComposeOptions, hooks?: ComposeSubmitHooks) {
    if (opts.blocked?.() || run.value?.busy) {
      hooks?.onDone?.({ ok: false, error: 'busy' })
      return
    }
    if (!composeReady(ordered.map(item => ({ kind: 'video', assetId: item.assetId })))) {
      opts.notify(opts.t('canvas.compose.needTwo'), 'error')
      hooks?.onDone?.({ ok: false, error: 'needTwo' })
      return
    }
    const first = opts.findNode(ordered[0]!.id)
    if (!first || !isContentNode(first)) {
      opts.notify(opts.t('canvas.compose.needClip'), 'error')
      hooks?.onDone?.({ ok: false, error: 'needClip' })
      return
    }

    submitHooks = hooks
    run.value = { nodeId: '', sourceIds: ordered.map(item => item.id), job: null, error: '', busy: true }
    try {
      await opts.requestSave?.()
      let canvasId = opts.canvasId()
      for (let i = 0; i < 12 && !canvasId; i++) {
        await new Promise(resolve => setTimeout(resolve, 500))
        canvasId = opts.canvasId()
      }
      if (!canvasId) {
        const message = opts.t('canvas.compose.needSave')
        patchRun({ busy: false, error: message })
        opts.notify(message, 'error')
        settleSubmit({ ok: false, error: message })
        return
      }

      const right = Math.max(...ordered.map(item => item.x + item.w))
      const top = Math.min(...ordered.map(item => item.y))
      const size = composeNodeSize(options.aspect)
      const sibling = opts.spawnMediaNode(first, 'video', opts.t('canvas.compose.tag'), opts.t('canvas.compose.label', { n: ordered.length }), {
        at: { x: right + 80, y: top },
        w: size.w,
        h: size.h,
        data: {
          prompt: '',
          taskStatus: 'running',
          taskProgress: 0,
        },
        select: true,
        link: true,
      })
      hooks?.onNode?.(sibling.id)
      patchRun({ nodeId: sibling.id })

      const timeline = composeTimeline(ordered, options)
      const res = await composeApi.create(canvasId, {
        timeline,
        preview: options.preview || undefined,
        ...(options.preview || !options.package ? {} : { package: true }),
      })
      if (!res?.success || !res.data) {
        const message = res?.message || opts.t('canvas.compose.submitFail')
        opts.dropNode(sibling.id)
        patchRun({ busy: false, error: message, nodeId: '' })
        opts.notify(message, 'error')
        settleSubmit({ ok: false, error: message })
        return
      }

      applyJob(sibling.id, res.data)
      patchRun({ nodeId: sibling.id, job: res.data, error: '' })
      opts.pushHistory()
      opts.track('canvas_compose_submit', {
        canvas_id: canvasId,
        compose_id: res.data.id,
        clips: ordered.length,
        preview: options.preview,
        aspect: options.aspect,
      })
      if (res.data.status === 2 || res.data.status === -1) {
        patchRun({ busy: false })
        if (res.data.status === 2) {
          opts.notify(opts.t('canvas.compose.ok'))
          settleSubmit({ ok: true, nodeId: sibling.id })
        }
        else {
          const message = res.data.error || opts.t('canvas.compose.failed')
          opts.notify(message, 'error')
          settleSubmit({ ok: false, nodeId: sibling.id, error: message })
        }
        return
      }
      watchJob()
    }
    finally {
      if (run.value && !run.value.job && run.value.busy) {
        patchRun({ busy: false })
        settleSubmit({ ok: false, error: run.value.error || opts.t('canvas.compose.submitFail') })
      }
    }
  }

  function resume() {
    if (run.value?.busy)
      return
    for (const node of opts.nodes.value) {
      if (!isContentNode(node))
        continue
      const jobId = Number(node.data.composeJobId) || 0
      if (jobId <= 0)
        continue
      const status = node.data.taskStatus
      if (node.data.content && status === 'succeeded')
        continue
      if (status !== 'pending' && status !== 'running' && status !== 'failed')
        continue
      run.value = {
        nodeId: node.id,
        sourceIds: [],
        job: { id: jobId, status: status === 'failed' ? -1 : 1, progress: Number(node.data.taskProgress) || 0 } as ComposeJob,
        error: status === 'failed' ? String(node.data.taskError || '') : '',
        busy: status === 'pending' || status === 'running',
      }
      if (status === 'pending' || status === 'running')
        watchJob()
      return
    }
  }

  onScopeDispose(() => stopComposePoll())

  return { run, submit, resume }
}
