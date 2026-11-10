import type { Ref } from 'vue'
import assetApi from '~/api/asset'
import type { CanvasMediaSpawnLayout } from '~/composables/useCanvasMediaJobs'
import { absPosition, isContentNode, type CanvasFlowNode } from '~/utils/canvas-group'
import { canvasMergeRunning, publishMergeProgress, trackMergeUpload } from '~/utils/canvas-merge-state'
import type { CanvasNodeData } from '~/utils/canvas-node-kinds'
import {
  mergeResultOrigin,
  MergeVideoError,
  type MergeVideoClip,
} from '~/utils/canvas-video-merge'
import { resolveMediaUrl } from '~/utils/media'

/**
 * 多选视频一键拼接：浏览器 ffmpeg 出片后先落到画布，再后台上传进资产。
 * 不走合成接口，也不烧字幕、配音或配乐。
 */
export function useCanvasVideoMerge(opts: {
  nodes: Ref<CanvasFlowNode[]>
  findNode: (id: string) => CanvasFlowNode | undefined
  spawnMediaNode: (
    from: CanvasFlowNode & { data: CanvasNodeData },
    kind: 'image' | 'video' | 'audio',
    tag: string,
    label: string,
    layout?: CanvasMediaSpawnLayout,
  ) => CanvasFlowNode
  addEdges: (edge: { id: string, source: string, target: string, sourceHandle: string, targetHandle: string }) => void
  updateNodeData: (id: string, data: Partial<CanvasNodeData>) => void
  pushHistory: () => void
  notify: (title: string, color?: 'neutral' | 'error') => void
  t: (key: string, params?: Record<string, unknown>) => string
  blocked?: () => boolean
}) {
  const running = canvasMergeRunning

  function failText(error: unknown) {
    if (error instanceof MergeVideoError) {
      if (error.code === 'load')
        return opts.t('canvas.merge.loadFail')
      if (error.code === 'fetch')
        return opts.t('canvas.merge.fetchFail', { status: error.detail ?? '' })
      if (error.code === 'read')
        return opts.t('canvas.merge.unreadable', { n: error.detail ?? '' })
      if (error.code === 'encode')
        return opts.t('canvas.merge.encodeFail')
      if (error.code === 'needTwo')
        return opts.t('canvas.merge.needTwo')
      if (error.code === 'browser')
        return opts.t('canvas.merge.browserOnly')
      if (error.code === 'noAudio')
        return opts.t('canvas.videoTool.noAudio')
    }
    return error instanceof Error && error.message ? error.message : opts.t('canvas.merge.fail')
  }

  async function mergeClips(clips: MergeVideoClip[]) {
    if (running.value || opts.blocked?.())
      return
    if (clips.length < 2) {
      opts.notify(opts.t('canvas.merge.needTwo'), 'error')
      return
    }
    const anchor = opts.findNode(clips[0]!.id)
    if (!anchor || !isContentNode(anchor) || anchor.data.kind !== 'video')
      return
    running.value = true
    publishMergeProgress({ phase: 'loading', progress: 0 })
    let blobUrl = ''
    try {
      const { mergeVideoBlobs } = await import('~/utils/canvas-video-merge.ffmpeg')
      const blob = await mergeVideoBlobs(
        clips.map(item => resolveMediaUrl(item.url)),
        publishMergeProgress,
      )
      blobUrl = URL.createObjectURL(blob)
      const origin = mergeResultOrigin(clips)
      const parentIds = clips.map(item => item.parentId || '')
      const sharedParent = parentIds.every(id => id === parentIds[0]) ? parentIds[0] : ''
      let at = origin
      if (sharedParent) {
        const parent = opts.nodes.value.find(item => item.id === sharedParent)
        const parentAt = parent ? absPosition(parent, opts.nodes.value) : { x: 0, y: 0 }
        at = { x: origin.x - parentAt.x, y: origin.y - parentAt.y }
      }
      const sample = clips[0]!
      const sibling = opts.spawnMediaNode(anchor, 'video', opts.t('canvas.merge.tag'), opts.t('canvas.merge.label', { n: clips.length }), {
        at,
        w: sample.w,
        h: sample.h,
        parent: Boolean(sharedParent),
        select: true,
        link: false,
        data: {
          content: blobUrl,
          prompt: '',
          taskStatus: 'succeeded',
          taskProgress: 100,
          taskError: '',
          params: { videoEditOperation: 'concat' },
        },
      })
      for (const clip of clips) {
        opts.addEdges({
          id: `e-merge-${clip.id}-${sibling.id}`,
          source: clip.id,
          target: sibling.id,
          sourceHandle: 'out',
          targetHandle: 'in',
        })
      }
      opts.pushHistory()
      const nodeId = sibling.id
      blobUrl = ''
      opts.notify(opts.t('canvas.merge.ok', { n: clips.length }))
      publishMergeProgress(null)
      const task = saveMergedAsset(nodeId, blob, clips.length)
      trackMergeUpload(task)
      void task.catch(() => undefined)
    }
    catch (error) {
      if (blobUrl)
        URL.revokeObjectURL(blobUrl)
      opts.notify(failText(error), 'error')
    }
    finally {
      running.value = false
      window.setTimeout(() => {
        if (!running.value)
          publishMergeProgress(null)
      }, 700)
    }
  }

  async function saveMergedAsset(nodeId: string, blob: Blob, count: number) {
    try {
      const file = new File([blob], `merged-${count}.mp4`, { type: 'video/mp4' })
      const asset = await uploadAssetOnce(file)
      opts.updateNodeData(nodeId, { content: asset.url, assetId: asset.id })
      opts.pushHistory()
    }
    catch {
      opts.notify(opts.t('canvas.merge.uploadFail'), 'error')
      throw new Error('merge-upload')
    }
  }

  return { running, mergeClips }
}

async function uploadAssetOnce(file: File) {
  const uploaded = await assetApi.upload(file)
  if (uploaded?.success && uploaded.data?.url)
    return uploaded.data
  throw new Error(uploaded?.message || '')
}
