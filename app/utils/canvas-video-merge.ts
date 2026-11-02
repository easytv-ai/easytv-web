/**
 * 画布多段视频拼接：顺序、concat 列表和 ffmpeg 参数。
 * 真正的 wasm 执行在 canvas-video-merge.ffmpeg.ts，只在浏览器里按需加载。
 *
 * 顺序跟影策一致：有分镜序号的先按序号，其余按画布从上到下、从左到右。
 * 拼接先走无损拷贝，编码对不上再统一转码。
 */

export type MergeVideoProgress = {
  phase: 'loading' | 'reading' | 'encoding' | 'uploading'
  progress: number
  index?: number
  total?: number
  /** 同一套进度条：拼接、裁剪、分割文案不同 */
  job?: 'merge' | 'trim' | 'split'
}

export type MergeVideoClip = {
  id: string
  url: string
  x: number
  y: number
  w: number
  h: number
  shotIndex?: number
  parentId?: string
}

import { isMediaUrl } from '~/utils/media'

/** 两段都要留得下，贴着首尾或彼此太近的分割点不要 */
export const SPLIT_MIN_PART = 0.3
/** 一次最多切这么多段，避免浏览器里连续转码把内存打满 */
export const SPLIT_MAX_PARTS = 12

export type MergeVideoErrorCode = 'browser' | 'load' | 'fetch' | 'read' | 'encode' | 'needTwo'

/** 比例分割点（0~1）换成首尾相接的秒区间。不合法时返回 null */
export function splitRanges(ratios: number[], duration: number, minPart = SPLIT_MIN_PART) {
  if (!(duration > minPart * 2))
    return null
  const cuts = ratios
    .map(value => Math.round(Math.min(1, Math.max(0, Number(value) || 0)) * duration * 100) / 100)
    .filter(value => value >= minPart && value <= duration - minPart)
    .sort((left, right) => left - right)
  const kept: number[] = []
  for (const cut of cuts) {
    const prev = kept.length ? kept[kept.length - 1]! : 0
    if (cut - prev >= minPart - 0.001)
      kept.push(cut)
  }
  if (!kept.length || duration - kept[kept.length - 1]! < minPart - 0.001)
    return null
  if (kept.length + 1 > SPLIT_MAX_PARTS)
    kept.length = SPLIT_MAX_PARTS - 1
  const edges = [0, ...kept, duration]
  return edges.slice(0, -1).map((start, index) => ({
    start,
    end: edges[index + 1]!,
  }))
}

export class MergeVideoError extends Error {
  readonly code: MergeVideoErrorCode
  readonly detail?: string | number

  constructor(code: MergeVideoErrorCode, detail?: string | number) {
    super(code)
    this.name = 'MergeVideoError'
    this.code = code
    this.detail = detail
  }
}

export function mergeShotIndex(data: {
  previewFrame?: { shotIndex?: number }
  params?: Record<string, unknown>
} | null | undefined) {
  const frame = data?.previewFrame?.shotIndex
  if (typeof frame === 'number' && Number.isFinite(frame))
    return frame
  const raw = data?.params?.shotIndex
  if (raw == null || raw === '')
    return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

/** 分镜序号优先，没有序号的排在后面，再按 y、x */
export function mergeVideoOrder<T extends { shotIndex?: number, x: number, y: number }>(items: T[]): T[] {
  return [...items].sort((left, right) => {
    const leftShot = left.shotIndex ?? Number.MAX_SAFE_INTEGER
    const rightShot = right.shotIndex ?? Number.MAX_SAFE_INTEGER
    if (leftShot !== rightShot)
      return leftShot - rightShot
    if (left.y !== right.y)
      return left.y - right.y
    return left.x - right.x
  })
}

export function mergeConcatScript(names: string[]) {
  return names.map(name => `file '${name}'`).join('\n')
}

/** 先收成 MPEG-TS，再接成一条。成片接着下一段拼时，时间轴才会继续往后走。 */
export function mergeToTsArgs(input: string, output: string, videoBsf?: string) {
  const args = ['-fflags', '+genpts', '-i', input, '-c', 'copy', '-avoid_negative_ts', 'make_zero']
  if (videoBsf)
    args.push('-bsf:v', videoBsf)
  args.push('-muxdelay', '0', '-muxpreload', '0', '-f', 'mpegts', output)
  return args
}

export function mergeTsConcatArgs(names: string[], withAudioBsf: boolean) {
  const args = ['-i', `concat:${names.join('|')}`, '-c', 'copy', '-avoid_negative_ts', 'make_zero']
  if (withAudioBsf)
    args.push('-bsf:a', 'aac_adtstoasc')
  args.push('-movflags', '+faststart', 'merged.mp4')
  return args
}

/** 拷贝没接上时间轴时再转码。每段从 0 重新计时，避免停在上一段结尾。 */
export function mergeReencodeArgs(names: string[], withAudio: boolean) {
  const inputs = names.flatMap(name => ['-i', name])
  const video = names.map((_, index) => `[${index}:v]setpts=PTS-STARTPTS[v${index}]`).join(';')
  const audio = withAudio
    ? names.map((_, index) => `[${index}:a]asetpts=PTS-STARTPTS[a${index}]`).join(';')
    : ''
  const pads = names.map((_, index) => withAudio ? `[v${index}][a${index}]` : `[v${index}]`).join('')
  const filter = [
    video,
    audio,
    `${pads}concat=n=${names.length}:v=1:a=${withAudio ? 1 : 0}[v]${withAudio ? '[a]' : ''}`,
  ].filter(Boolean).join(';')
  const args = [
    ...inputs,
    '-filter_complex', filter,
    '-map', '[v]',
  ]
  if (withAudio)
    args.push('-map', '[a]', '-c:a', 'aac')
  args.push('-c:v', 'libx264', '-movflags', '+faststart', 'merged.mp4')
  return args
}

/** 日志里的 Duration: 00:01:02.50 */
export function parseClockDuration(line: string) {
  const match = line.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (!match)
    return 0
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
}

/** 成片时长明显短于各段之和，说明后一段没有接上。 */
export function mergeDurationShort(inputs: number[], output: number) {
  const known = inputs.filter(item => item > 0.2)
  if (!known.length || output <= 0)
    return false
  const sum = known.reduce((total, item) => total + item, 0)
  return output + 0.35 < sum * 0.9
}

/**
 * 拷贝拼接后体积只剩第一段左右，才当没接上。
 * 容器时长经常只写第一段，不能拿它决定要不要在浏览器里整段转码。
 */
export function concatOutputTruncated(outputBytes: number, inputBytes: number[]) {
  const sizes = inputBytes.filter(item => item > 0)
  const sum = sizes.reduce((total, item) => total + item, 0)
  if (outputBytes <= 0 || sizes.length < 2 || sum <= 0)
    return false
  const first = sizes[0] || 0
  const rest = sum - first
  return outputBytes < first + rest * 0.35
}

/** 同一次拼接的百分比只往前走。后一段转码从 0 报起时，不能把条打回 55。 */
export function forwardMergeProgress(previous: number | null, next: number) {
  if (previous == null || next >= previous)
    return next
  return previous
}

/**
 * 跨域成片（OSS、接口域名）改走本站代理再交给 ffmpeg。
 * blob、data 和本站静态资源保持原地址。
 */
export function mergeReadableUrl(url: string, pageOrigin: string) {
  const value = url.trim()
  if (!value || /^(blob:|data:)/i.test(value))
    return value
  try {
    const parsed = new URL(value, pageOrigin)
    if (parsed.origin === pageOrigin)
      return parsed.toString()
  }
  catch {
    return value
  }
  return `/api/canvas-media?url=${encodeURIComponent(value)}`
}

/** 浏览器拼接的成片。已经有画面，不再走模型生成。 */
export function isMergeResult(data: { content?: string, params?: Record<string, unknown> } | null | undefined) {
  return data?.params?.videoEditOperation === 'concat' && isMediaUrl(data.content)
}

/** ffmpeg 时间参数，固定小数点，避免本地化把点写成逗号 */
export function ffmpegClock(seconds: number) {
  const value = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  return value.toFixed(3)
}

/** 先按关键帧拷贝裁切，失败再转码。 */
export function trimCopyArgs(input: string, output: string, start: number, end: number) {
  return [
    '-ss', ffmpegClock(start),
    '-to', ffmpegClock(end),
    '-i', input,
    '-c', 'copy',
    '-avoid_negative_ts', 'make_zero',
    '-movflags', '+faststart',
    output,
  ]
}

/**
 * 按时间裁一段。-ss / -to 放在 -i 前面，先跳到附近再转码。
 * 没有音轨时第二次去掉音频。
 */
export function trimVideoArgs(input: string, output: string, start: number, end: number, withAudio: boolean) {
  const args = [
    '-ss', ffmpegClock(start),
    '-to', ffmpegClock(end),
    '-i', input,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
  ]
  if (withAudio)
    args.push('-c:a', 'aac')
  else
    args.push('-an')
  args.push('-movflags', '+faststart', output)
  return args
}

/** 成片落在最右侧视频的右边，顶边对齐最上面一段 */
export function mergeResultOrigin(clips: Array<{ x: number, y: number, w: number }>) {
  return {
    x: Math.max(...clips.map(item => item.x + item.w)) + 120,
    y: Math.min(...clips.map(item => item.y)),
  }
}
