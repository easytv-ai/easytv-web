import { onScopeDispose, ref, type Ref } from 'vue'
import assetApi from '~/api/asset'
import { composeApi } from '~/api/screenplay'
import type { ComposeJob } from '~/types/creative'
import { canvasMergeRunning, publishMergeProgress } from '~/utils/canvas-merge-state'
import { probeMediaDuration } from '~/utils/canvas-video-frame'
import { MergeVideoError } from '~/utils/canvas-video-merge'
import {
  composeNodeSize,
  composeReady,
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
 * 画布多段合成：在浏览器里按入出点裁切后拼接，可选混入配乐。
 * 结果先落在选区右侧的视频节点上。以前没跑完的服务端合成仍会接着轮询。
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

    if (canvasMergeRunning.value) {
      opts.notify(opts.t('canvas.cut.busy'), 'error')
      hooks?.onDone?.({ ok: false, error: 'busy' })
      return
    }
    submitHooks = hooks
    run.value = {
      nodeId: '',
      sourceIds: ordered.map(item => item.id),
      job: { id: 0, status: 1, progress: 0 } as ComposeJob,
      error: '',
      busy: true,
    }
    const owned: string[] = []
    canvasMergeRunning.value = true
    try {
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
          taskProgress: 5,
        },
        select: true,
        link: true,
      })
      hooks?.onNode?.(sibling.id)
      patchRun({
        nodeId: sibling.id,
        job: { id: 0, status: 1, progress: 5 } as ComposeJob,
      })

      const { mergeVideoBlobs, trimVideoBlob, mixBgmBlobs } = await import('~/utils/canvas-video-merge.ffmpeg')
      const urls: string[] = []
      for (const item of ordered) {
        const start = Math.max(0, Number(item.trimIn) || 0)
        const end = Math.max(0, Number(item.trimOut) || 0)
        const duration = item.duration > 0 ? item.duration : 0
        const clipEnd = end > start ? end : duration
        const trimmed = start > 0.05 || (clipEnd > start + 0.05 && duration > 0 && clipEnd < duration - 0.05)
        if (!trimmed) {
          urls.push(item.url)
          continue
        }
        const blob = await trimVideoBlob(item.url, start, clipEnd, publishMergeProgress)
        const url = URL.createObjectURL(blob)
        owned.push(url)
        urls.push(url)
      }
      opts.updateNodeData(sibling.id, { taskProgress: 40 })
      patchRun({ job: { id: 0, status: 1, progress: 40 } as ComposeJob })
      let blob = await mergeVideoBlobs(urls, publishMergeProgress)
      const bgmId = Number(options.bgmAssetId) || 0
      if (bgmId > 0) {
        const audio = opts.nodes.value.find(node =>
          isContentNode(node) && node.data.kind === 'audio' && Number(node.data.assetId) === bgmId)
        const bgmUrl = audio && isContentNode(audio) ? String(audio.data.content || '').trim() : ''
        if (bgmUrl) {
          const preview = URL.createObjectURL(blob)
          owned.push(preview)
          const duration = await probeMediaDuration(preview)
          if (duration > 0.3)
            blob = await mixBgmBlobs(preview, bgmUrl, duration, options.bgmVolume, publishMergeProgress)
        }
      }
      const localUrl = URL.createObjectURL(blob)
      opts.updateNodeData(sibling.id, {
        content: localUrl,
        taskStatus: 'succeeded',
        taskProgress: 100,
        taskError: '',
        params: { videoEditOperation: 'concat' },
      })
      patchRun({ busy: false, error: '', job: { id: 0, status: 2, progress: 100 } as ComposeJob })
      opts.pushHistory()
      opts.track('canvas_compose_ok', {
        canvas_id: opts.canvasId(),
        clips: ordered.length,
        browser: true,
      })
      opts.notify(opts.t('canvas.compose.ok'))
      settleSubmit({ ok: true, nodeId: sibling.id })
      const file = new File([blob], `compose-${ordered.length}.mp4`, { type: 'video/mp4' })
      const uploaded = await assetApi.upload(file)
      if (uploaded?.success && uploaded.data?.url) {
        URL.revokeObjectURL(localUrl)
        opts.updateNodeData(sibling.id, { content: uploaded.data.url, assetId: uploaded.data.id })
        opts.pushHistory()
      }
    }
    catch (error) {
      const current = run.value
      if (current?.nodeId)
        opts.dropNode(current.nodeId)
      const message = error instanceof MergeVideoError
        ? opts.t('canvas.merge.fail')
        : (error instanceof Error && error.message ? error.message : opts.t('canvas.compose.submitFail'))
      patchRun({ busy: false, error: message, nodeId: '', job: { id: 0, status: -1, progress: 0, error: message } as ComposeJob })
      opts.notify(message, 'error')
      settleSubmit({ ok: false, error: message })
    }
    finally {
      canvasMergeRunning.value = false
      publishMergeProgress(null)
      for (const url of owned)
        URL.revokeObjectURL(url)
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
