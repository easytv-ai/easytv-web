/**
 * 运镜视频导出（复刻自 open-director 的 io/videoExport.ts，MIT）。
 *
 * 做法是「真播一遍再录下来」：把视口切到机位视角，对 canvas 开 captureStream，
 * 按真实时间播完整条运镜路径，MediaRecorder 收流。全是浏览器原生 API，不引依赖；
 * Chrome 出 webm，Safari 出 mp4。录完把 blob 交回去，画布页上传成视频节点；
 * 没有画布的开发页再本地下载。
 */
import { watch } from 'vue'
import { getCameraPathDuration } from '../camera-path'
import type { DirectorCameraShot } from '../schema'
import type { CameraPlaybackStore } from './store'

export interface VideoExportResult {
  ok: boolean
  /** 文案是 i18n key（即中文原文），调用方自己过 t() */
  message: string
  /** 成功时带上实际时长，方便提示里写清楚 */
  duration?: number
  /** 录好的文件；画布页拿去上传成长视频节点，开发页没有画布就本地下载 */
  blob?: Blob
  fileName?: string
}

/** 低于这个时长录出来只有几帧，没有参考价值 */
const MIN_EXPORT_DURATION = 0.1
/** 录制帧率。运镜是参考片，30 帧够用，再高只是让文件变大 */
const CAPTURE_FPS = 30
/** 开录前先渲染几帧，免得首帧还停在切视角之前的画面 */
const WARMUP_FRAMES = 4

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
]

/** 挑一个浏览器支持的容器；都不支持就交给 MediaRecorder 自己选 */
export function pickRecorderMimeType(isSupported: (type: string) => boolean): string | undefined {
  return MIME_CANDIDATES.find(type => isSupported(type))
}

export function getExportExtension(mimeType: string | undefined): 'mp4' | 'webm' {
  return mimeType?.includes('mp4') ? 'mp4' : 'webm'
}

export function getExportFileName(cameraName: string, extension: string): string {
  // 文件名里的斜杠和冒号在部分系统上会被当成路径分隔，统一换掉
  const safeName = (cameraName || '机位').replace(/[\\/:*?"<>|]/g, '_')
  return `${safeName}-运镜.${extension}`
}

/** 没有画布可回写时（开发页）才本地下载 */
export function downloadExportedVideo(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 试用页收下预演帧：按序本地下载，不上传、不进画布 */
export function downloadPreviewFrames(frames: Array<{ dataUrl: string, fileName: string }>) {
  frames.forEach((frame, index) => {
    window.setTimeout(() => {
      const anchor = document.createElement('a')
      anchor.href = frame.dataUrl
      anchor.download = frame.fileName
      anchor.click()
    }, index * 200)
  })
}

/** 能不能导出；不能的话给出的 message 就是提示文案 */
export function checkExportable(camera: DirectorCameraShot | null | undefined): VideoExportResult {
  const nodes = camera?.nodes ?? []
  if (!camera || nodes.length < 2)
    return { ok: false, message: '至少要有两个运镜节点才能导出' }

  const duration = getCameraPathDuration(nodes, camera.segments ?? [])
  if (duration < MIN_EXPORT_DURATION)
    return { ok: false, message: '运镜总时长太短，导不出东西' }

  return { ok: true, message: '', duration }
}

function waitFrames(count: number) {
  return new Promise<void>((resolve) => {
    let remaining = count
    const tick = () => {
      remaining -= 1
      if (remaining <= 0)
        resolve()
      else
        requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

/**
 * 等播放结束。
 *
 * 除了盯着 isPlaying，还带一个兜底超时：播放引擎要是因为别的原因没能走到头
 * （比如路径中途被改空了），这个 Promise 会一直挂着，录制器和摄像头流就
 * 永远关不掉 —— 上游没有这层兜底。
 */
function waitForPlaybackEnd(playback: CameraPlaybackStore, timeoutMs: number) {
  return new Promise<void>((resolve) => {
    let stopWatch: (() => void) | null = null
    const timer = setTimeout(() => {
      stopWatch?.()
      resolve()
    }, timeoutMs)

    stopWatch = watch(() => playback.isPlaying.value, (playing) => {
      if (playing)
        return
      clearTimeout(timer)
      stopWatch?.()
      resolve()
    })
  })
}

export interface ExportVideoOptions {
  camera: DirectorCameraShot | null | undefined
  playback: CameraPlaybackStore
  /** 切视角用，导出结束要切回原来的 */
  setViewMode: (mode: 'director' | 'camera') => void
  previousViewMode: 'director' | 'camera'
}

export async function exportCameraPathVideo(options: ExportVideoOptions): Promise<VideoExportResult> {
  const { camera, playback, setViewMode, previousViewMode } = options

  const check = checkExportable(camera)
  if (!check.ok)
    return check

  const canvas = playback.canvas.value
  if (!canvas || typeof canvas.captureStream !== 'function' || typeof MediaRecorder === 'undefined')
    return { ok: false, message: '这个浏览器不支持画布录制，导不了视频' }

  const duration = check.duration!
  const mimeType = pickRecorderMimeType(type => MediaRecorder.isTypeSupported(type))
  const chunks: BlobPart[] = []
  const stream = canvas.captureStream(CAPTURE_FPS)
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0)
      chunks.push(event.data)
  }

  playback.setExporting(true)

  try {
    // 固定取景：导出期间切到机位视角，播放头归零后先渲染几帧再开录
    setViewMode('camera')
    playback.pause()
    playback.setPlayheadTime(0)
    await waitFrames(WARMUP_FRAMES)

    recorder.start()
    playback.play()
    // 兜底超时给到时长的两倍再加三秒，掉帧拖慢的情况也够
    await waitForPlaybackEnd(playback, duration * 2000 + 3000)

    const blob = await new Promise<Blob>((resolve) => {
      // dataavailable 在 stop() 之后才异步触发，必须在 onstop 里收尾，
      // 直接在 stop() 后面拿 chunks 会得到一个 0 字节的文件
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType ?? 'video/webm' }))
      recorder.stop()
    })

    if (!blob.size)
      return { ok: false, message: '视频导出失败，再试一次' }

    return {
      ok: true,
      message: '已导出运镜视频',
      duration,
      blob,
      fileName: getExportFileName(camera!.name, getExportExtension(mimeType)),
    }
  }
  catch {
    return { ok: false, message: '视频导出失败，再试一次' }
  }
  finally {
    if (recorder.state !== 'inactive') {
      try {
        recorder.stop()
      }
      catch {
        // 已经停了就算了
      }
    }
    for (const track of stream.getTracks())
      track.stop()

    playback.setExporting(false)
    // 导出前本来在导演视角的话切回去，别把用户留在机位视角里
    if (previousViewMode !== 'camera')
      setViewMode('director')
  }
}
