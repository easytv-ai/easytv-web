import { authUserHeaders } from '~/utils/auth-user'
import { isSameOriginMediaUrl } from '~/utils/canvas-image-edit'
import { mergeReadableUrl } from '~/utils/canvas-video-merge'

/**
 * 阿里云 OSS 视频截帧地址。t 是毫秒，img 直接显示不需要 CORS。
 * 签名地址和已经带 process 的不改，避免把签名算坏。
 */
export function isOssSnapshotableUrl(src: string) {
  const value = String(src || '').trim()
  if (!/^https?:\/\//i.test(value))
    return false
  return !/[?&](Signature|OSSAccessKeyId|x-oss-process)=/i.test(value)
}

/** 视频封面：有 cover 用 cover，公开 OSS 则截首帧，其它地址交给调用方用 video 标签自己出画面 */
export function videoCoverUrl(src: string, cover = '', timeSec = 0.04, width = 160) {
  const poster = String(cover || '').trim()
  if (poster)
    return poster
  return ossVideoSnapshotUrl(src, timeSec, width)
}

export function ossVideoSnapshotUrl(src: string, timeSec: number, width = 240) {
  if (!isOssSnapshotableUrl(src))
    return ''
  const ms = Math.max(0, Math.round(timeSec * 1000))
  const w = Math.max(80, Math.round(width) || 240)
  const sep = src.includes('?') ? '&' : '?'
  return `${src}${sep}x-oss-process=video/snapshot,t_${ms},f_jpg,w_${w},h_0,m_fast`
}

export function stripFrameTimes(duration: number, count: number) {
  const n = Math.max(1, Math.floor(count) || 1)
  const d = Number.isFinite(duration) && duration > 0 ? duration : 0
  if (n === 1)
    return [d > 0 ? Math.min(0.04, d * 0.5) : 0]
  const times: number[] = []
  for (let i = 0; i < n; i++)
    times.push(d > 0 ? (i / (n - 1)) * d * 0.98 : 0)
  return times
}

function readableVideoUrl(src: string) {
  return mergeReadableUrl(src, typeof location === 'undefined' ? 'http://localhost' : location.origin)
}

async function waitVideo(video: HTMLVideoElement, event: 'loadedmetadata', timeoutMs: number) {
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const done = (ok: boolean) => {
      if (settled)
        return
      settled = true
      video.removeEventListener(event, onOk)
      video.removeEventListener('error', onErr)
      window.clearTimeout(timer)
      if (ok)
        resolve()
      else
        reject(new Error(event))
    }
    const onOk = () => done(true)
    const onErr = () => done(false)
    video.addEventListener(event, onOk)
    video.addEventListener('error', onErr)
    const timer = window.setTimeout(() => done(false), timeoutMs)
  })
}

async function fetchReadableVideoBlob(src: string) {
  const proxied = readableVideoUrl(src)
  if (proxied !== src) {
    try {
      const direct = await fetch(src, { mode: 'cors', cache: 'force-cache' })
      if (direct.ok)
        return await direct.blob()
      await direct.body?.cancel()
    }
    catch {
      // OSS 没 CORS 头时浏览器会直接拒
    }
  }
  const headers: Record<string, string> = {}
  const apiBase = String(useRuntimeConfig().public.apiBaseUrl || '').replace(/\/$/, '')
  if (apiBase && src.startsWith(apiBase))
    Object.assign(headers, authUserHeaders())
  const res = await fetch(proxied, { headers, cache: 'force-cache' })
  if (!res.ok)
    throw new Error('fetch')
  return await res.blob()
}

function bindCaptureVideo(src: string, objectUrl = '') {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  const playable = objectUrl || readableVideoUrl(src)
  if (!isSameOriginMediaUrl(playable))
    video.crossOrigin = 'anonymous'
  video.src = playable
  return {
    video,
    dispose() {
      video.removeAttribute('src')
      video.load()
      if (objectUrl)
        URL.revokeObjectURL(objectUrl)
    },
  }
}

async function prepareCaptureVideo(src: string) {
  const first = bindCaptureVideo(src)
  try {
    await waitVideo(first.video, 'loadedmetadata', 8000)
    return first
  }
  catch {
    first.dispose()
  }
  const blob = await fetchReadableVideoBlob(src)
  const bound = bindCaptureVideo(src, URL.createObjectURL(blob))
  try {
    await waitVideo(bound.video, 'loadedmetadata', 8000)
    return bound
  }
  catch (error) {
    bound.dispose()
    throw error
  }
}

async function imageLoads(src: string, timeoutMs = 4000) {
  return await new Promise<boolean>((resolve) => {
    const img = new Image()
    const timer = window.setTimeout(() => {
      img.src = ''
      resolve(false)
    }, timeoutMs)
    img.onload = () => {
      window.clearTimeout(timer)
      resolve(true)
    }
    img.onerror = () => {
      window.clearTimeout(timer)
      resolve(false)
    }
    img.src = src
  })
}

function seekLanded(current: number, target: number) {
  return Number.isFinite(current) && Math.abs(current - target) < 0.35
}

/** 等到画面真的停在目标时间附近。没到位就返回 false，调用方不能把当前帧当成这一张。 */
async function seekVideo(video: HTMLVideoElement, time: number) {
  const target = Math.max(0, time)
  if (seekLanded(video.currentTime, target) && video.readyState >= 2)
    return true
  return await new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (ok: boolean) => {
      if (settled)
        return
      settled = true
      video.removeEventListener('seeked', onSeeked)
      resolve(ok)
    }
    const onSeeked = () => finish(seekLanded(video.currentTime, target))
    video.addEventListener('seeked', onSeeked)
    try {
      video.currentTime = target
    }
    catch {
      finish(false)
      return
    }
    window.setTimeout(() => finish(seekLanded(video.currentTime, target)), 2500)
  })
}

async function grabStripFromVideo(
  src: string,
  count: number,
  isStale?: () => boolean,
): Promise<{ duration: number, frames: string[] }> {
  const bound = await prepareCaptureVideo(src)
  const { video, dispose } = bound
  try {
    if (isStale?.())
      return { duration: 0, frames: [] }
    const duration = Number.isFinite(video.duration) ? Math.max(0, video.duration) : 0
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx)
      return { duration, frames: [] }
    const frames: string[] = []
    for (const time of stripFrameTimes(duration, count)) {
      const landed = await seekVideo(video, time)
      if (isStale?.())
        return { duration: 0, frames: [] }
      if (!landed)
        continue
      canvas.width = video.videoWidth || 160
      canvas.height = video.videoHeight || 90
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      try {
        frames.push(canvas.toDataURL('image/jpeg', 0.72))
      }
      catch {
        break
      }
    }
    return { duration, frames }
  }
  finally {
    dispose()
  }
}

/**
 * 胶片条抽帧：OSS 视频走截帧参数（img 能显示、不需 CORS）；
 * 读不到再走本站代理 / blob，用 canvas 截。
 */
export async function captureVideoStripFrames(
  src: string,
  count: number,
  isStale?: () => boolean,
): Promise<{ duration: number, frames: string[] }> {
  if (!import.meta.client)
    return { duration: 0, frames: [] }
  const n = Math.max(1, Math.floor(count) || 1)
  let duration = await probeMediaDuration(src)
  if (isStale?.())
    return { duration: 0, frames: [] }

  const ossFrames = isOssSnapshotableUrl(src)
    ? stripFrameTimes(duration, n).map(time => ossVideoSnapshotUrl(src, time))
    : []
  if (ossFrames.length && ossFrames.every(Boolean) && await imageLoads(ossFrames[0]!)) {
    if (isStale?.())
      return { duration: 0, frames: [] }
    return { duration, frames: ossFrames }
  }

  try {
    const grabbed = await grabStripFromVideo(src, n, isStale)
    if (grabbed.duration > 0)
      duration = grabbed.duration
    return { duration, frames: grabbed.frames }
  }
  catch {
    return { duration, frames: [] }
  }
}

/** 从视频地址截取指定时间点的一帧，返回 jpeg Blob 与像素尺寸 */
export async function captureVideoFrame(
  src: string,
  timeSec: number,
): Promise<{ blob: Blob, width: number, height: number, time: number }> {
  const snap = ossVideoSnapshotUrl(src, timeSec, 1280)
  if (snap) {
    try {
      const res = await fetch(readableVideoUrl(snap), { cache: 'force-cache' })
      const type = (res.headers.get('content-type') || '').toLowerCase()
      if (res.ok && type.startsWith('image/')) {
        const blob = await res.blob()
        if (blob.size) {
          const bmp = await createImageBitmap(blob)
          const width = bmp.width
          const height = bmp.height
          bmp.close()
          return { blob, width, height, time: timeSec }
        }
      }
    }
    catch {
      // 代理没放行 OSS 时退回 video + canvas
    }
  }

  const { video, dispose } = await prepareCaptureVideo(src)
  try {

    const duration = Number.isFinite(video.duration) ? video.duration : 0
    let target = Math.max(0, timeSec)
    if (duration > 0) {
      // 尾帧略提前，避免部分编码 seek 不到 duration
      const max = Math.max(0, duration - 0.04)
      target = Math.min(target, max)
    }

    const landed = await seekVideo(video, target)
    if (!landed)
      throw new Error('seek')

    const width = video.videoWidth || 0
    const height = video.videoHeight || 0
    if (!width || !height)
      throw new Error('size')

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx)
      throw new Error('ctx')
    ctx.drawImage(video, 0, 0, width, height)

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((out) => {
        if (out)
          resolve(out)
        else
          reject(new Error('blob'))
      }, 'image/jpeg', 0.92)
    })

    return { blob, width, height, time: target }
  }
  finally {
    dispose()
  }
}

/** 截图时间文案：00:02.244 */
export function formatFrameClock(seconds: number) {
  const msTotal = Math.max(0, Math.round(seconds * 1000))
  const mins = Math.floor(msTotal / 60000)
  const secs = Math.floor((msTotal % 60000) / 1000)
  const ms = msTotal % 1000
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}

/** 读取视频时长（秒）；失败返回 0 */
export async function probeVideoDuration(src: string): Promise<number> {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'metadata'
  video.crossOrigin = 'anonymous'
  video.src = src
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error('load'))
      window.setTimeout(() => reject(new Error('timeout')), 12000)
    })
    return Number.isFinite(video.duration) ? Math.max(0, video.duration) : 0
  }
  finally {
    video.removeAttribute('src')
    video.load()
  }
}

/**
 * 只读时长：不设 crossOrigin（读 metadata 不需要跨域，设了反而在存储没配 CORS 时一直等到超时），
 * 音频 / 视频都能用；读不到返回 0。
 */
export async function probeMediaDuration(src: string, timeoutMs = 6000): Promise<number> {
  const media = document.createElement('audio')
  media.preload = 'metadata'
  media.src = src
  try {
    await new Promise<void>((resolve, reject) => {
      media.onloadedmetadata = () => resolve()
      media.onerror = () => reject(new Error('load'))
      window.setTimeout(() => reject(new Error('timeout')), timeoutMs)
    })
    return Number.isFinite(media.duration) ? Math.max(0, media.duration) : 0
  }
  catch {
    return 0
  }
  finally {
    media.removeAttribute('src')
    media.load()
  }
}

/**
 * 反推用抽帧时刻：约每 2 秒一帧，至少 2 帧（时长够时），最多 maxFrames。
 * 首尾略内收，避免个别编码 seek 不到 duration。
 */
export function samplePromptReverseTimes(duration: number, maxFrames = 8): number[] {
  const d = Math.max(0, Number(duration) || 0)
  if (d <= 0)
    return [0]
  const end = Math.max(0, d - 0.04)
  if (end < 0.2)
    return [0]
  const count = Math.min(maxFrames, Math.max(2, Math.ceil(end / 2)))
  if (count === 1)
    return [0]
  const times: number[] = []
  for (let i = 0; i < count; i++) {
    const t = (end * i) / (count - 1)
    times.push(Math.round(t * 1000) / 1000)
  }
  return times
}

export type PromptReverseSample = {
  index: number
  timeSec: number
  startSec: number
  endSec: number
}

/** 相邻抽帧时刻的中点切段，覆盖整段 [0, duration] */
export function promptReverseFrameRanges(times: number[], duration: number): PromptReverseSample[] {
  const d = Math.max(0, Number(duration) || 0)
  const list = times.filter(t => Number.isFinite(t) && t >= 0)
  if (!list.length)
    return [{ index: 1, timeSec: 0, startSec: 0, endSec: Math.max(0, Math.round(d)) }]
  return list.map((timeSec, i) => {
    const prev = i === 0 ? 0 : (list[i - 1]! + timeSec) / 2
    const next = i === list.length - 1 ? d : (timeSec + list[i + 1]!) / 2
    return {
      index: i + 1,
      timeSec,
      startSec: Math.max(0, Math.round(prev * 10) / 10),
      endSec: Math.max(0, Math.round(next * 10) / 10),
    }
  })
}
