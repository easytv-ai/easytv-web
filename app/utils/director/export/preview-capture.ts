/**
 * 沿运镜时间点读预演帧。不上传、不落节点、不提交生成。
 * 每一帧先把播放头拨过去（播放引擎会把机位姿态写上），再等两帧让画面画完。
 * 彩色直接 toDataURL；深度和白模再换材质渲一帧。
 */
import { planPreviewFrames, type PreviewFramePlan, type PreviewSampling } from './preview-frames'
import type { PreviewControlOutput, PreviewOutput } from './preview-pass'
import type { DirectorCameraShot } from '../schema'

export interface PreviewCapturedFrame extends PreviewFramePlan {
  dataUrl: string
}

export interface PreviewCapturePlayback {
  canvas: { value: { toDataURL: (type: string) => string } | null }
  pause: () => void
  setPlayheadTime: (time: number) => void
  setExporting: (value: boolean) => void
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted)
    throw new DOMException('Aborted', 'AbortError')
}

export function isPreviewExportAbort(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')
}

/** 按计划逐帧读像素。seek 之后必须先 settle，否则读到的是上一帧 */
export async function readPreviewFrames(input: {
  frames: PreviewFramePlan[]
  seek: (time: number) => void
  settle: () => Promise<void>
  read: () => string
  signal?: AbortSignal
}): Promise<PreviewCapturedFrame[]> {
  const out: PreviewCapturedFrame[] = []
  for (const frame of input.frames) {
    throwIfAborted(input.signal)
    input.seek(frame.time)
    await input.settle()
    throwIfAborted(input.signal)
    out.push({ ...frame, dataUrl: input.read() })
  }
  return out
}

function waitFrames(count: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    let remaining = count
    let done = false
    const finish = (fn: () => void) => {
      if (done)
        return
      done = true
      signal?.removeEventListener('abort', onAbort)
      fn()
    }
    const onAbort = () => finish(() => reject(new DOMException('Aborted', 'AbortError')))
    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    const tick = () => {
      if (done)
        return
      remaining -= 1
      if (remaining <= 0)
        finish(() => resolve())
      else
        requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

export async function capturePreviewFrames(options: {
  camera: Pick<DirectorCameraShot, 'nodes' | 'segments'> | null | undefined
  playback: PreviewCapturePlayback
  setViewMode: (mode: 'director' | 'camera') => void
  previousViewMode: 'director' | 'camera'
  sampling?: PreviewSampling
  output?: PreviewOutput
  /** 深度 / 白模由视口提供。彩色不需要 */
  readPass?: (output: PreviewControlOutput) => string
  settle?: () => Promise<void>
  signal?: AbortSignal
}): Promise<{ ok: true, frames: PreviewCapturedFrame[] } | { ok: false, message: string }> {
  const nodes = options.camera?.nodes ?? []
  if (!nodes.length)
    return { ok: false, message: '先在机位视角按 K 记一个运镜节点' }

  const canvas = options.playback.canvas.value
  if (!canvas)
    return { ok: false, message: '视口还没准备好' }

  const output = options.output ?? 'color'
  if (output !== 'color' && !options.readPass)
    return { ok: false, message: '视口还没准备好' }

  const planned = planPreviewFrames(options.camera ?? { nodes: [] }, options.sampling ?? { mode: 'shot-ends' })
  const suffix = output === 'depth' ? '-深度.png' : output === 'matte' ? '-白模.png' : ''
  const frames = planned.map(frame => ({
    ...frame,
    label: suffix ? frame.label.replace(/\.png$/, suffix) : frame.label,
  }))
  if (!frames.length)
    return { ok: false, message: '预演导出失败，再试一次' }

  const settle = options.settle ?? (() => waitFrames(2, options.signal))
  const readPass = options.readPass
  options.playback.setExporting(true)
  options.setViewMode('camera')
  options.playback.pause()
  try {
    throwIfAborted(options.signal)
    const captured = await readPreviewFrames({
      frames,
      seek: time => options.playback.setPlayheadTime(time),
      settle,
      read: () => output === 'color' ? canvas.toDataURL('image/png') : readPass!(output),
      signal: options.signal,
    })
    return { ok: true, frames: captured }
  }
  catch (error) {
    if (options.signal?.aborted || isPreviewExportAbort(error))
      return { ok: false, message: '已取消导出预演' }
    return { ok: false, message: '截图失败，画面里可能有跨域素材' }
  }
  finally {
    options.playback.setExporting(false)
    options.setViewMode(options.previousViewMode)
  }
}
