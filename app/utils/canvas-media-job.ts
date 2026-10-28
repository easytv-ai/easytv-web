import type { MediaAction, MediaJob, MediaOutput } from '~/types/creative'
import type { CanvasNodeData } from '~/utils/canvas-node-kinds'

/** 源素材：优先节点的资产 id，没有就用生成任务 id；都没有时返回 null */
export function mediaSourceRef(data: Pick<CanvasNodeData, 'assetId' | 'taskId'>): { asset_id: number } | { task_id: number } | null {
  const assetId = Number(data.assetId)
  if (assetId > 0)
    return { asset_id: assetId }
  const taskId = Number(data.taskId)
  if (taskId > 0)
    return { task_id: taskId }
  return null
}

/** 派生节点的源节点：参数里记的 sourceId → 连进来的上游 → 自己 */
export function pickMediaSourceNode<T extends { id: string }>(
  node: T,
  sourceId: string | undefined,
  findNode: (id: string) => T | undefined,
  edges: Array<{ source: string, target: string }>,
  isContent: (item: T | undefined) => item is T,
): T {
  const bySource = sourceId ? findNode(sourceId) : undefined
  if (bySource && isContent(bySource))
    return bySource
  let upstreamId = ''
  for (const edge of edges) {
    if (edge.target === node.id) {
      upstreamId = edge.source
      break
    }
  }
  const upstream = upstreamId ? findNode(upstreamId) : undefined
  if (upstream && isContent(upstream))
    return upstream
  return node
}

/**
 * 画布工具条按钮 → 媒体工具动作（API.md 23）。
 * 只列需要按 GET /user/media/actions 的 available 决定能不能点的按钮；没列的按钮不受清单影响。
 */
export const MEDIA_BAR_ACTIONS: Record<string, string> = {
  'hd': 'upscale',
  'depth': 'depth_extract',
  'retake': 'retake_segment',
  'frame-by-frame': 'storyboard',
  'clip-cut': 'trim',
  'video-split': 'split',
  'smart-extend': 'extend',
  'add-bgm': 'mix_bgm',
  'grid-split': 'grid_split',
  'depth-motion': 'motion_capture',
  'remove-subtitles': 'remove_subtitle',
  'box-subtitles': 'remove_subtitle',
  'separate': 'split_av',
  'extract-voice': 'vocal_separation',
  'extract-bgm': 'bgm_separation',
  'remove-subject': 'subject_remove',
  'edit-subject': 'subject_modify',
  'replace-subject': 'subject_replace',
  'smart-matting': 'matting',
  'transcribe': 'transcribe',
  'remove-silence': 'remove_silence',
}

export type MediaAvailability = {
  available: boolean
  /** 不可用原因（后端 reason，已是人话） */
  reason: string
  /** 清单里有没有这条；清单还没拉到时按可用处理，避免加载期间整条工具条变灰 */
  known: boolean
}

export const MEDIA_ACTION_MISSING_REASON = '该功能暂未开放'

/** 按动作名查可用性；清单为空（还没加载 / 加载失败）时一律放行，交给创建接口报错 */
export function mediaActionState(actions: MediaAction[] | null | undefined, action: string): MediaAvailability {
  if (!actions?.length)
    return { available: true, reason: '', known: false }
  const found = actions.find(item => item.action === action)
  if (!found)
    return { available: false, reason: MEDIA_ACTION_MISSING_REASON, known: false }
  return { available: found.available !== false, reason: found.available === false ? (found.reason || MEDIA_ACTION_MISSING_REASON) : '', known: true }
}

/** 工具条按钮的可用性：没映射到媒体动作的按钮永远可用 */
export function mediaBarItemState(actions: MediaAction[] | null | undefined, itemId: string): MediaAvailability {
  const action = MEDIA_BAR_ACTIONS[itemId]
  if (!action)
    return { available: true, reason: '', known: false }
  return mediaActionState(actions, action)
}

/**
 * 独立接口动作（合成走 /user/canvas/:id/compose）：
 * 清单里有就听清单；老后端还没有这条时放行，避免整条入口被误关。
 */
export function mediaActionIfListed(actions: MediaAction[] | null | undefined, action: string): MediaAvailability {
  if (!actions?.length)
    return { available: true, reason: '', known: false }
  const found = actions.find(item => item.action === action)
  if (!found)
    return { available: true, reason: '', known: false }
  return {
    available: found.available !== false,
    reason: found.available === false ? (found.reason || MEDIA_ACTION_MISSING_REASON) : '',
    known: true,
  }
}

/** 胶片条给的是 0~1 比例，乘时长换算成秒（保留两位小数） */
export function ratioToSeconds(ratio: number, duration: number) {
  const r = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0
  const d = Number.isFinite(duration) && duration > 0 ? duration : 0
  return Math.round(r * d * 100) / 100
}

/**
 * 把比例区间换成秒区间；时长未知或区间太短时返回 null，由调用方提示。
 * minSpan：最短段长（秒），片段重拍后端要求 ≥ 0.5，片段截取 ≥ 0.1。
 */
export function rangeToSeconds(
  range: { start: number, end: number },
  duration: number,
  minSpan = 0.1,
): { start: number, end: number } | null {
  if (!(duration > 0))
    return null
  const start = ratioToSeconds(Math.min(range.start, range.end), duration)
  const end = ratioToSeconds(Math.max(range.start, range.end), duration)
  if (end - start < minSpan)
    return null
  return { start, end }
}

/** 重拍节点存的是比例 + 探测到的时长；按 API.md 23.8 换成秒 */
export function retakeSegmentSeconds(params: NonNullable<CanvasNodeData['retakeParams']>) {
  return rangeToSeconds({ start: params.start, end: params.end }, Number(params.duration) || 0, 0.5)
}

/**
 * 片段重拍的区间参数：读到了时长就发秒数；读不到（素材跨域、还没探完）就发 0~1 比例，
 * 由服务端按探到的源时长换算（API.md 23.8 start_ratio / end_ratio）。区间无效返回 null。
 */
export function retakeSegmentRange(params: NonNullable<CanvasNodeData['retakeParams']>):
  { start: number, end: number } | { start_ratio: number, end_ratio: number } | null {
  const seconds = retakeSegmentSeconds(params)
  if (seconds)
    return seconds
  if (Number(params.duration) > 0)
    return null // 时长已知但段太短
  const start = Math.min(params.start, params.end)
  const end = Math.max(params.start, params.end)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 1 || end - start < 0.01)
    return null
  return { start_ratio: Math.round(start * 1000) / 1000, end_ratio: Math.round(end * 1000) / 1000 }
}

export type MediaJobTaskState = Pick<CanvasNodeData, 'taskStatus' | 'taskProgress' | 'taskError'>

/** 作业状态 → 节点上的 taskStatus / taskProgress / taskError（复用生成任务那套展示） */
export function mediaJobTaskState(job: Pick<MediaJob, 'status' | 'progress' | 'error'>, fallbackError = '处理失败'): MediaJobTaskState {
  const status = Number(job.status)
  const progress = Math.max(0, Math.min(100, Number(job.progress) || 0))
  if (status === 2)
    return { taskStatus: 'succeeded', taskProgress: 100, taskError: '' }
  if (status === -1)
    return { taskStatus: 'failed', taskProgress: progress, taskError: job.error || fallbackError }
  if (status === 1)
    return { taskStatus: 'running', taskProgress: progress, taskError: '' }
  return { taskStatus: 'pending', taskProgress: progress, taskError: '' }
}

export function isMediaJobActive(status: number | undefined | null) {
  return status === 0 || status === 1
}

/** outputs 可能是 null / 字符串（老数据），统一成数组 */
export function mediaOutputsOf(job: Pick<MediaJob, 'outputs' | 'output_url' | 'output_asset_id'> | null | undefined): MediaOutput[] {
  if (!job)
    return []
  let raw: unknown = job.outputs
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    }
    catch {
      raw = []
    }
  }
  const list = Array.isArray(raw) ? raw.filter((item): item is MediaOutput => Boolean(item && typeof item === 'object')) : []
  if (list.length)
    return list
  if (job.output_url)
    return [{ asset_id: Number(job.output_asset_id) || 0, url: job.output_url, type: '', name: '' }]
  return []
}

export function pickMediaOutput(outputs: MediaOutput[], type: MediaOutput['type']) {
  return outputs.find(item => item.type === type && item.url) || null
}

/** 产物写回节点：只带 url 的才算产物（解读文本产物没有 url，走任务轮询） */
export function mediaOutputPatch(output: MediaOutput | null | undefined): Partial<CanvasNodeData> {
  if (!output?.url)
    return {}
  const patch: Partial<CanvasNodeData> = { content: output.url }
  if (output.asset_id > 0)
    patch.assetId = output.asset_id
  return patch
}

/** 单产物动作（trim / upscale / 去字幕 / 主体消除…）：取第一份带 url 的产物 */
export function firstMediaOutput(outputs: MediaOutput[]) {
  return outputs.find(item => item.url) || null
}

/** split_av：一次出音轨 + 无声视频 */
export function splitAvOutputs(outputs: MediaOutput[]) {
  return {
    audio: pickMediaOutput(outputs, 'audio'),
    video: pickMediaOutput(outputs, 'video'),
  }
}

/** storyboard：抽出的帧 + 解读任务 id（analyze=false 时为 0） */
export function storyboardOutputs(outputs: MediaOutput[]) {
  const frames = outputs.filter(item => item.type === 'image' && item.url)
  const text = outputs.find(item => item.type === 'text' || Number(item.task_id) > 0)
  return { frames, analysisTaskId: Number(text?.task_id) || 0 }
}

/** retake_segment：outputs[0] 整条成片，outputs[1] 重拍片段 */
export function retakeSegmentOutputs(outputs: MediaOutput[]) {
  const videos = outputs.filter(item => item.type === 'video' && item.url)
  return { full: videos[0] || null, segment: videos[1] || null }
}

export type MediaWarningMeta = {
  code?: string
  params?: Record<string, string | number>
}

/**
 * 媒体作业成功但带保留说明时，优先按 warning_code 映射词条，没有码再认中文原文。
 * 已知：transcribe_truncated / transcribe_no_timestamps / no_silence；其余走通用提示。
 */
export function mediaOutputWarning(
  warning: string | undefined | null,
  t: (key: string, params?: Record<string, string | number>) => string,
  meta?: MediaWarningMeta,
): string {
  const code = String(meta?.code || '').trim()
  if (code === 'transcribe_truncated') {
    const n = Number(meta?.params?.minutes)
    return t('canvas.media.transcribeTruncated', { n: Number.isFinite(n) && n > 0 ? n : 20 })
  }
  if (code === 'transcribe_no_timestamps')
    return t('canvas.media.transcribeNoTimestamps')
  if (code === 'no_silence')
    return t('canvas.media.noSilence')

  const text = String(warning || '').trim()
  if (!text)
    return ''
  const minutes = text.match(/只转了前\s*(\d+)\s*分钟/) || text.match(/只转写了前\s*(\d+)\s*分钟/)
  if (minutes)
    return t('canvas.media.transcribeTruncated', { n: Number(minutes[1]) })
  if (text.includes('未返回时间戳'))
    return t('canvas.media.transcribeNoTimestamps')
  if (text.includes('没检测到停顿') || text.includes('没有检测到可去掉的停顿'))
    return t('canvas.media.noSilence')
  return t('canvas.media.warningFallback')
}

/** 抽出的帧排成网格：列数取 ceil(sqrt(n))，4→2 列、6→3 列、12→4 列 */
export function mediaGridLayout(count: number, origin: { x: number, y: number }, cell: { w: number, h: number }, gap = 24) {
  const n = Math.max(0, Math.floor(count))
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)))
  const out: Array<{ x: number, y: number }> = []
  for (let i = 0; i < n; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    out.push({ x: origin.x + col * (cell.w + gap), y: origin.y + row * (cell.h + gap) })
  }
  return { cols, rows: n ? Math.ceil(n / cols) : 0, positions: out }
}
