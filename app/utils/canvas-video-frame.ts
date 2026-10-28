/** 从视频地址截取指定时间点的一帧，返回 jpeg Blob 与像素尺寸 */

export async function captureVideoFrame(
  src: string,
  timeSec: number,
): Promise<{ blob: Blob, width: number, height: number, time: number }> {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.crossOrigin = 'anonymous'
  video.src = src

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error('load'))
    })

    const duration = Number.isFinite(video.duration) ? video.duration : 0
    let target = Math.max(0, timeSec)
    if (duration > 0) {
      // 尾帧略提前，避免部分编码 seek 不到 duration
      const max = Math.max(0, duration - 0.04)
      target = Math.min(target, max)
    }

    await new Promise<void>((resolve) => {
      let settled = false
      const done = () => {
        if (settled)
          return
        settled = true
        video.removeEventListener('seeked', done)
        resolve()
      }
      video.addEventListener('seeked', done)
      try {
        video.currentTime = target
      }
      catch {
        done()
      }
      window.setTimeout(done, 800)
    })

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
    video.removeAttribute('src')
    video.load()
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
