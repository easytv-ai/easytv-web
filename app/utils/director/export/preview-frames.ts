/**
 * 预演帧规划：给一条运镜算出要导出的时间点。
 * 只排时间，不渲染、不上传、不往画布落节点。执行器（读像素、上传）另做。
 *
 * 没给 shots 时，相邻两个运镜节点之间的一段运动就是一镜。
 * 一镜的末帧取走到终点的时刻（duration 结束），不含之后的 hold。
 */
import { buildCameraSegments, getNodeStartTimes } from '../camera-path'
import type { CameraNode, CameraSegment, DirectorCameraShot } from '../schema'

/** 一镜最多这么多帧，避免间隔采样把画布铺满 */
export const PREVIEW_MAX_FRAMES_PER_SHOT = 6

/** 时间轴「按间隔」档的秒数。超过一镜上限时仍抽成 6 帧并保住首尾 */
export const PREVIEW_INTERVAL_SECONDS = 0.25

export type PreviewSampling =
  | { mode: 'shot-ends' }
  | { mode: 'interval', seconds: number }

/** 时间轴下拉的两档：首尾帧，或固定 0.25 秒一帧 */
export function previewSamplingFromMode(mode: string): PreviewSampling {
  if (mode === 'interval')
    return { mode: 'interval', seconds: PREVIEW_INTERVAL_SECONDS }
  return { mode: 'shot-ends' }
}

/** 一镜在运镜时间轴上的起止（秒） */
export interface PreviewShotRange {
  start: number
  end: number
}

export interface PreviewFramePlan {
  time: number
  /** 从 0 起，和传入的镜头顺序一致 */
  shotIndex: number
  /** 落图文件名，如 镜子1-0.00s.png */
  label: string
}

function roundTime(time: number) {
  return Number(Math.max(0, time).toFixed(2))
}

function frameLabel(shotIndex: number, time: number) {
  return `镜子${shotIndex + 1}-${time.toFixed(2)}s.png`
}

function dedupeSorted(times: number[]) {
  const out: number[] = []
  for (const time of times) {
    if (!out.length || out[out.length - 1] !== time)
      out.push(time)
  }
  return out
}

function segmentsOf(nodes: CameraNode[], segments?: CameraSegment[]) {
  if (segments && segments.length === nodes.length - 1)
    return segments
  return buildCameraSegments(nodes, segments)
}

/** 没指定镜头范围时，一段运动一镜：起点是节点时间，终点是这段走完的时刻 */
export function previewShotRanges(camera: Pick<DirectorCameraShot, 'nodes' | 'segments'>): PreviewShotRange[] {
  const nodes = camera.nodes ?? []
  if (!nodes.length)
    return []
  if (nodes.length === 1) {
    const time = nodes[0]!.time
    return [{ start: time, end: time }]
  }
  const segments = segmentsOf(nodes, camera.segments)
  const starts = getNodeStartTimes(nodes, segments)
  return segments.map((segment, index) => {
    const start = starts[index] ?? 0
    return { start, end: start + segment.duration }
  })
}

function sampleShot(start: number, end: number, sampling: PreviewSampling) {
  const from = roundTime(start)
  const to = roundTime(Math.max(end, start))
  if (sampling.mode === 'shot-ends' || !(sampling.seconds > 0) || from === to)
    return dedupeSorted([from, to])

  const times = [from]
  let cursor = from
  while (cursor + sampling.seconds < to - 1e-6) {
    cursor = roundTime(cursor + sampling.seconds)
    if (cursor >= to)
      break
    times.push(cursor)
  }
  times.push(to)
  const sampled = dedupeSorted(times)
  if (sampled.length <= PREVIEW_MAX_FRAMES_PER_SHOT)
    return sampled

  const capped: number[] = []
  const last = PREVIEW_MAX_FRAMES_PER_SHOT - 1
  for (let index = 0; index < PREVIEW_MAX_FRAMES_PER_SHOT; index++)
    capped.push(roundTime(from + (to - from) * (index / last)))
  return dedupeSorted(capped)
}

export function planPreviewFrames(
  camera: Pick<DirectorCameraShot, 'nodes' | 'segments'>,
  sampling: PreviewSampling = { mode: 'shot-ends' },
  shots?: PreviewShotRange[],
): PreviewFramePlan[] {
  const ranges = (shots?.length ? shots : previewShotRanges(camera))
    .filter(range => Number.isFinite(range.start) && Number.isFinite(range.end))

  const frames: PreviewFramePlan[] = []
  ranges.forEach((range, shotIndex) => {
    for (const time of sampleShot(range.start, range.end, sampling))
      frames.push({ time, shotIndex, label: frameLabel(shotIndex, time) })
  })
  return frames
}
