/** 智能续写大弹窗（视频节点）：类型 / 输出规格的共享定义与提交负载 */

/** 续写类型：延长和片段重拍都把选中的视频交给模型；首尾帧才截静帧；重拍生成后再拼回原片 */
export type ExtendStudioType = 'extend' | 'reference' | 'fl2v' | 'edit' | 'retake'

export const EXTEND_STUDIO_TYPES: Array<{ id: ExtendStudioType, label: string, hint: string }> = [
  { id: 'extend', label: '视频延长', hint: '以这段视频接着往下生成' },
  { id: 'reference', label: '全能参考', hint: '以这段视频为参考生成新视频' },
  { id: 'fl2v', label: '首尾帧', hint: '用选区尾帧作首帧，再选一张图作尾帧' },
  { id: 'edit', label: '视频编辑', hint: '参考这段视频，按提示词改出新的' },
  { id: 'retake', label: '片段重拍', hint: '重选一段时间线片段，按提示词重新生成' },
]

/** 输出规格（API.md 1.4 的 params 约定） */
export const EXTEND_STUDIO_RATIOS = ['智能', '16:9', '9:16', '1:1'] as const
export const EXTEND_STUDIO_RESOLUTIONS = ['480p', '720p', '1080p'] as const
export const EXTEND_STUDIO_FORMATS = ['mp4', 'mov'] as const
export const EXTEND_STUDIO_COUNTS = [1, 2, 4] as const
export const EXTEND_STUDIO_SECONDS_MAX = 30

export type ExtendStudioRef = {
  /** 素材库 id，提交时作为 inputs 的 asset_id */
  assetId: number
  kind: 'image' | 'video' | 'audio'
  url: string
  name?: string
}

export type ExtendStudioPayload = {
  type: ExtendStudioType
  model: string
  prompt: string
  /** 风格库选中的提示词片段，空串表示没选 */
  style: string
  /** 选中的运镜预设 id 列表（canvas-node-kinds 的 CAMERA_MOVE_ITEMS） */
  cameras: string[]
  /** 生成的新片段时长（秒）；延长时即续写秒数 */
  seconds: number
  ratio: string
  resolution: string
  videoFormat: 'mp4' | 'mov'
  /** 模型参数表没有音频开关时不传 */
  audio?: boolean
  count: number
  /** 源视频上的选区（比例 0-1）。延长把这段交给模型接着拍；首尾帧用选区尾帧作首帧 */
  range: { start: number, end: number, duration: number }
  refs: ExtendStudioRef[]
  /** 首尾帧：弹窗里抽好并上传的选区尾帧（first_frame） */
  firstFrameAssetId?: number
  /** 片段重拍：时间线分成的段数（RETAKE_SEGMENT_COUNT） */
  total?: number
}

/**
 * 视频延长要交给模型的那一段（秒）。
 * 选区贴着整段时返回 null，调用方直接用已入库的源视频；
 * 起点或终点被拖开时，返回要裁出来的窗口，模型从这段的结尾接着拍。
 */
/**
 * 片段重拍打开时的选区（比例 0–1）。
 * 已有重拍节点沿用上次圈的区间；第一次打开先落在第一段，避免一上来把整条片子重做掉。
 */
export function initialRetakeRange(
  saved: { start?: number, end?: number } | null | undefined,
  total: number,
): { start: number, end: number } {
  const start = Number(saved?.start)
  const end = Number(saved?.end)
  if (Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end <= 1 && end > start + 0.001)
    return { start, end }
  const parts = Math.max(1, Math.floor(Number(total) || 1))
  return { start: 0, end: 1 / parts }
}

export function extendSourceWindow(range: { start: number, end: number, duration: number }) {
  const duration = Number(range.duration) || 0
  if (!(duration > 0.4))
    return null
  const start = Math.max(0, Math.min(1, Number(range.start) || 0)) * duration
  const end = Math.max(0, Math.min(1, Number(range.end) || 0)) * duration
  if (!(end > start + 0.08))
    return null
  if (start <= 0.15 && end >= duration - 0.15)
    return null
  return {
    start: Math.round(start * 100) / 100,
    end: Math.round(end * 100) / 100,
  }
}

/**
 * 重拍要交给模型的秒数。选区只决定拼回哪一段；生成时长可以另选。
 * 模型声明了档位时，取不短于选区的最小档（都不够就用最长档）。
 */
export function retakeOutputSeconds(spanSeconds: number, allowed?: readonly number[]): number {
  const need = Math.round(Number(spanSeconds) || 0)
  const base = Math.min(15, Math.max(2, need || 2))
  const list = (allowed || []).filter(n => n > 0).slice().sort((a, b) => a - b)
  if (!list.length)
    return base
  return list.find(n => n >= base) ?? list[list.length - 1]!
}

function ratioNumber(token: string): number {
  const [aw, ah] = token.split(':').map(Number)
  if (!(aw > 0 && ah > 0))
    return 0
  return aw / ah
}

/**
 * 重拍比例只走模型参数表里的值。
 * 原片比例就在表里（误差 4% 以内）用那一档；不在表里且模型收 adaptive 时用 adaptive，
 * 避免把 2:3 这类表外比例送给 Seedance。
 * 用户已经点过某一档、且新模型仍收这一档时，保持他的选择。
 */
export function retakeOutputRatio(input: {
  current: string
  allowed?: readonly string[]
  width?: number
  height?: number
  touched?: boolean
}): string {
  const allowed = (input.allowed || []).map(item => item.trim()).filter(Boolean)
  const current = input.current.trim()
  if (!allowed.length)
    return current || '9:16'
  const declared = allowed.find(item => item.toLowerCase() === current.toLowerCase())
  if (input.touched && declared)
    return declared
  const width = Number(input.width) || 0
  const height = Number(input.height) || 0
  const fromFrame = width > 0 && height > 0 ? width / height : 0
  const fromCurrent = ratioNumber(current)
  if (input.touched)
    return closestDeclaredRatio(fromCurrent || fromFrame, allowed)
  if (fromFrame > 0)
    return closestDeclaredRatio(fromFrame, allowed)
  if (declared)
    return declared
  return closestDeclaredRatio(fromCurrent, allowed)
}

function closestDeclaredRatio(target: number, allowed: string[]): string {
  const numeric = allowed
    .map(item => ({ item, value: ratioNumber(item) }))
    .filter(row => row.value > 0)
  const adaptive = allowed.find(item => item.toLowerCase() === 'adaptive')
  if (!(target > 0))
    return adaptive || numeric[0]?.item || allowed[0]!
  let best = numeric[0]
  let bestDiff = Number.POSITIVE_INFINITY
  for (const row of numeric) {
    const diff = Math.abs(target - row.value) / row.value
    if (diff < bestDiff) {
      bestDiff = diff
      best = row
    }
  }
  if (best && bestDiff <= 0.04)
    return best.item
  if (adaptive)
    return adaptive
  return best?.item || allowed[0]!
}

/** 分辨率沿用模型枚举的原文。没声明时保留当前值，对不上时优先 720p，再退回第一档。 */
export function retakeOutputResolution(current: string, allowed?: readonly string[]): string {
  const list = (allowed || []).map(item => item.trim()).filter(Boolean)
  const asked = current.trim() || '720p'
  if (!list.length)
    return asked
  const hit = list.find(item => item.toLowerCase() === asked.toLowerCase())
  if (hit)
    return hit
  return list.find(item => item.toLowerCase() === '720p') || list[0]!
}

function retakeClock(seconds: number) {
  const total = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/**
 * 片段重拍交给模型的提示词。
 * 改动说明写在前面；源视频上的镜头描述必须带上，空着改动框也不能只发一句「保持主体」。
 * 改动正文里已经包含原描述时不再重复贴一次。
 */
export function composeRetakePrompt(input: {
  change: string
  sourcePrompt: string
  start?: number
  end?: number
  fallback: string
}): string {
  const change = input.change.trim()
  const source = input.sourcePrompt.trim()
  const start = Number(input.start)
  const end = Number(input.end)
  const span = Number.isFinite(start) && Number.isFinite(end) && end > start
    ? `${retakeClock(start)}–${retakeClock(end)}`
    : ''
  const head = span ? `重拍当前选中的 ${span} 这一段` : '重拍当前选中的这一段'
  const keep = '保持原片的人物、场景、光影和机位，只改提到的地方。开头承接选区起点的构图，结尾接回后面的画面。'
  const alreadyHasSource = Boolean(source) && (change === source || change.includes(source))
  if (!change && !source)
    return input.fallback
  const lines: string[] = []
  if (change)
    lines.push(`${head}。${change}`, keep)
  else
    lines.push(`${head}，按原镜头描述重拍，保持人物、场景、光影和机位。`)
  if (source && !alreadyHasSource)
    lines.push(`原镜头描述：\n${source}`)
  return lines.join('\n')
}

export type RetakeSnapMode = 'move' | 'start' | 'end' | 'fit'

/**
 * 片段重拍的胶片选区按整秒吸附。
 * 窗口不能短于模型最短时长；片子比最短时长只长出一两秒时，窗口就只能挪那一两秒。
 */
export function retakeSnapRange(input: {
  duration: number
  start: number
  end: number
  minSeconds: number
  mode: RetakeSnapMode
  /** 指定窗口长度（秒）。fit / move 用来保住参数卡上选的时长 */
  lengthSeconds?: number
}): { start: number, end: number, seconds: number } {
  const video = Number(input.duration) || 0
  if (!(video > 0.2))
    return { start: input.start, end: input.end, seconds: 0 }
  const minWant = Math.round(Number(input.minSeconds) || 0)
  // 还不知道模型最短档时不要收成 1 秒，否则 Seedance 这种 4 秒起的模型会被看成 1 秒
  if (!(minWant > 0))
    return { start: input.start, end: input.end, seconds: 0 }
  const whole = Math.max(1, Math.floor(video + 1e-6))
  if (whole < minWant)
    return { start: 0, end: 1, seconds: minWant }

  const roundSec = (ratio: number) => {
    const clamped = Math.min(1, Math.max(0, Number(ratio) || 0))
    return Math.round(clamped * video)
  }
  let length = Math.round(Number(input.lengthSeconds) || 0)
  if (!(length > 0))
    length = Math.max(1, roundSec(input.end) - roundSec(input.start))
  if (input.mode === 'fit' && !(Number(input.lengthSeconds) > 0))
    length = Math.max(length, minWant)
  length = Math.min(whole, Math.max(minWant, length))

  let startSec = roundSec(input.start)
  let endSec = roundSec(input.end)
  if (input.mode === 'start') {
    endSec = Math.min(whole, Math.max(minWant, endSec || length))
    startSec = Math.min(endSec - minWant, Math.max(0, startSec))
    length = endSec - startSec
  }
  else if (input.mode === 'end') {
    startSec = Math.min(Math.max(0, whole - minWant), Math.max(0, startSec))
    endSec = Math.max(startSec + minWant, Math.min(whole, endSec))
    length = endSec - startSec
  }
  else {
    const maxStart = Math.max(0, whole - length)
    startSec = Math.min(maxStart, Math.max(0, startSec))
    endSec = startSec + length
  }
  const endRatio = video - endSec < 0.5 && endSec >= whole ? 1 : endSec / video
  return {
    start: startSec / video,
    end: Math.min(1, endRatio),
    seconds: length,
  }
}
