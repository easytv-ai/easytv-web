/**
 * 浏览器里用 ffmpeg.wasm 把多段视频拼成一条 mp4。
 * 核心文件随前端发布，不走第三方 CDN。只在用户点「合并」时加载。
 */

import { authUserHeaders } from '~/utils/auth-user'
import {
  mergeDurationShort,
  mergeReadableUrl,
  mergeReencodeArgs,
  mergeToTsArgs,
  mergeTsConcatArgs,
  MergeVideoError,
  parseClockDuration,
  trimVideoArgs,
  type MergeVideoProgress,
} from '~/utils/canvas-video-merge'

type FfmpegHandle = {
  load: (config: { coreURL: string, wasmURL: string }) => Promise<unknown>
  writeFile: (path: string, data: Uint8Array) => Promise<unknown>
  readFile: (path: string) => Promise<Uint8Array | string>
  deleteFile: (path: string) => Promise<unknown>
  exec: (args: string[]) => Promise<number>
  on: {
    (event: 'progress', callback: (event: { progress: number }) => void): void
    (event: 'log', callback: (event: { message: string }) => void): void
  }
  off: {
    (event: 'progress', callback: (event: { progress: number }) => void): void
    (event: 'log', callback: (event: { message: string }) => void): void
  }
  terminate?: () => void
}

let ffmpegPromise: Promise<FfmpegHandle> | null = null

async function loadFfmpeg(onProgress?: (progress: MergeVideoProgress) => void) {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const { FFmpeg } = await import('@ffmpeg/ffmpeg')
      const { toBlobURL } = await import('@ffmpeg/util')
      const core = await import('@ffmpeg/core?url')
      const wasm = await import('@ffmpeg/core/wasm?url')
      const ffmpeg = new FFmpeg() as FfmpegHandle
      onProgress?.({ phase: 'loading', progress: 0 })
      try {
        await ffmpeg.load({
          coreURL: await toBlobURL(core.default, 'text/javascript'),
          wasmURL: await toBlobURL(wasm.default, 'application/wasm'),
        })
      }
      catch (cause) {
        ffmpeg.terminate?.()
        throw new MergeVideoError('load', cause instanceof Error ? cause.message : undefined)
      }
      return ffmpeg
    })()
  }
  try {
    return await ffmpegPromise
  }
  catch (error) {
    ffmpegPromise = null
    throw error
  }
}

function wait(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

function canRetryFetch(error: unknown) {
  if (!(error instanceof MergeVideoError) || error.code !== 'fetch')
    return true
  const status = Number(error.detail)
  if (!Number.isFinite(status) || status <= 0)
    return true
  return status >= 500
}

/** 同源和带 CORS 的地址直接拉，才能用到播放器已经缓存的那一份。没有 CORS 再走本站代理。 */
async function openVideo(url: string) {
  const proxied = mergeReadableUrl(url, window.location.origin)
  if (proxied === url)
    return fetch(url)
  try {
    const direct = await fetch(url, { mode: 'cors', cache: 'force-cache' })
    if (direct.ok)
      return direct
    await direct.body?.cancel()
  }
  catch {
    // 跨域没有 CORS 头时浏览器会直接拒绝
  }
  const headers: Record<string, string> = {}
  const apiBase = String(useRuntimeConfig().public.apiBaseUrl || '').replace(/\/$/, '')
  if (apiBase && url.startsWith(apiBase))
    Object.assign(headers, authUserHeaders())
  return fetch(proxied, { headers, cache: 'force-cache' })
}

async function readVideoBlob(url: string) {
  let last: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await openVideo(url)
      if (!response.ok)
        throw new MergeVideoError('fetch', response.status)
      return await response.blob()
    }
    catch (cause) {
      last = cause instanceof MergeVideoError
        ? cause
        : new MergeVideoError('fetch', cause instanceof Error ? cause.message : 'network')
      if (!canRetryFetch(last) || attempt === 2)
        throw last
      await wait(400 * (attempt + 1))
    }
  }
  throw last instanceof MergeVideoError ? last : new MergeVideoError('fetch', 'network')
}

async function readAllVideos(
  urls: string[],
  onProgress?: (progress: MergeVideoProgress) => void,
) {
  const blobs = new Array<Blob>(urls.length)
  let cursor = 0
  let done = 0
  async function next() {
    while (cursor < urls.length) {
      const index = cursor
      cursor += 1
      const blob = await readVideoBlob(urls[index] || '')
      if (!blob.size)
        throw new MergeVideoError('read', index + 1)
      blobs[index] = blob
      done += 1
      onProgress?.({
        phase: 'reading',
        progress: Math.round((done / urls.length) * 45),
        index: done,
        total: urls.length,
      })
    }
  }
  const workers = Math.min(3, urls.length)
  await Promise.all(Array.from({ length: workers }, () => next()))
  return blobs
}

/** 按传入顺序拼接。至少两段，地址要是浏览器能拉到的绝对地址。 */
export async function mergeVideoBlobs(
  urls: string[],
  onProgress?: (progress: MergeVideoProgress) => void,
) {
  if (!import.meta.client)
    throw new MergeVideoError('browser')
  if (urls.length < 2)
    throw new MergeVideoError('needTwo')
  const ffmpeg = await loadFfmpeg(onProgress)
  const { fetchFile } = await import('@ffmpeg/util')
  const names: string[] = []
  try {
    const blobs = await readAllVideos(urls, onProgress)
    for (let index = 0; index < blobs.length; index += 1) {
      const name = `input-${index}.mp4`
      await ffmpeg.writeFile(name, await fetchFile(blobs[index]!))
      names.push(name)
      blobs[index] = new Blob()
    }
    onProgress?.({ phase: 'encoding', progress: 55 })
    let exitCode = 1
    const tsNames: string[] = []
    try {
      exitCode = await concatWithTimeline(ffmpeg, names, tsNames, (done, total) => {
        onProgress?.({
          phase: 'encoding',
          progress: Math.min(96, 55 + Math.round((done / Math.max(1, total)) * 41)),
        })
      })
      if (exitCode === 0 && await timelineStoppedEarly(ffmpeg, names))
        exitCode = 1
      if (exitCode !== 0) {
        await ffmpeg.deleteFile('merged.mp4').catch(() => undefined)
        const onEncode = ({ progress }: { progress: number }) => {
          const value = Number(progress)
          if (!Number.isFinite(value))
            return
          onProgress?.({
            phase: 'encoding',
            progress: Math.min(99, 96 + Math.round(Math.max(0, Math.min(1, value)) * 3)),
          })
        }
        ffmpeg.on('progress', onEncode)
        try {
          exitCode = await ffmpeg.exec(mergeReencodeArgs(names, true))
          if (exitCode !== 0) {
            await ffmpeg.deleteFile('merged.mp4').catch(() => undefined)
            exitCode = await ffmpeg.exec(mergeReencodeArgs(names, false))
          }
        }
        finally {
          ffmpeg.off('progress', onEncode)
        }
      }
    }
    finally {
      await Promise.all(tsNames.map(file => ffmpeg.deleteFile(file).catch(() => undefined)))
    }
    if (exitCode !== 0)
      throw new MergeVideoError('encode')
    return await outputBlob(ffmpeg, 'merged.mp4')
  }
  finally {
    await Promise.all([...names, 'merged.mp4'].map(file => ffmpeg.deleteFile(file).catch(() => undefined)))
  }
}

/** 浏览器里裁一段。start / end 是秒。 */
export async function trimVideoBlob(
  url: string,
  start: number,
  end: number,
  onProgress?: (progress: MergeVideoProgress) => void,
) {
  if (!import.meta.client)
    throw new MergeVideoError('browser')
  if (!(end > start + 0.05))
    throw new MergeVideoError('encode')
  const report = (progress: MergeVideoProgress) => onProgress?.({ ...progress, job: 'trim' })
  const ffmpeg = await loadFfmpeg(report)
  const input = 'cut-in.mp4'
  const output = 'cut-out.mp4'
  try {
    report({ phase: 'reading', progress: 12 })
    await writeSource(ffmpeg, url, input)
    report({ phase: 'encoding', progress: 40 })
    const code = await encodeRange(ffmpeg, input, output, start, end, (progress) => {
      report({ phase: 'encoding', progress: 40 + Math.round(progress * 55) })
    })
    if (code !== 0)
      throw new MergeVideoError('encode')
    return await outputBlob(ffmpeg, output)
  }
  finally {
    await Promise.all([input, output].map(file => ffmpeg.deleteFile(file).catch(() => undefined)))
  }
}

/** 在 at 秒处切成前后两段。 */
export async function splitVideoBlob(
  url: string,
  at: number,
  duration: number,
  onProgress?: (progress: MergeVideoProgress) => void,
) {
  if (!import.meta.client)
    throw new MergeVideoError('browser')
  if (!(at >= 0.3) || !(duration > at + 0.3))
    throw new MergeVideoError('encode')
  const report = (progress: MergeVideoProgress) => onProgress?.({ ...progress, job: 'split' })
  const ffmpeg = await loadFfmpeg(report)
  const input = 'split-in.mp4'
  const headName = 'split-head.mp4'
  const tailName = 'split-tail.mp4'
  try {
    report({ phase: 'reading', progress: 12 })
    await writeSource(ffmpeg, url, input)
    report({ phase: 'encoding', progress: 30 })
    const headCode = await encodeRange(ffmpeg, input, headName, 0, at, (progress) => {
      report({ phase: 'encoding', progress: 30 + Math.round(progress * 30) })
    })
    if (headCode !== 0)
      throw new MergeVideoError('encode')
    const head = await outputBlob(ffmpeg, headName)
    await ffmpeg.deleteFile(headName).catch(() => undefined)
    const tailCode = await encodeRange(ffmpeg, input, tailName, at, duration, (progress) => {
      report({ phase: 'encoding', progress: 62 + Math.round(progress * 34) })
    })
    if (tailCode !== 0)
      throw new MergeVideoError('encode')
    const tail = await outputBlob(ffmpeg, tailName)
    return { head, tail }
  }
  finally {
    await Promise.all([input, headName, tailName].map(file => ffmpeg.deleteFile(file).catch(() => undefined)))
  }
}

async function writeSource(ffmpeg: FfmpegHandle, url: string, name: string) {
  const blob = await readVideoBlob(url)
  if (!blob.size)
    throw new MergeVideoError('read', 1)
  const { fetchFile } = await import('@ffmpeg/util')
  await ffmpeg.writeFile(name, await fetchFile(blob))
}

async function encodeRange(
  ffmpeg: FfmpegHandle,
  input: string,
  output: string,
  start: number,
  end: number,
  onRatio?: (progress: number) => void,
) {
  const onEncode = ({ progress }: { progress: number }) => {
    const value = Number(progress)
    if (Number.isFinite(value))
      onRatio?.(Math.max(0, Math.min(1, value)))
  }
  ffmpeg.on('progress', onEncode)
  try {
    let code = await ffmpeg.exec(trimVideoArgs(input, output, start, end, true))
    if (code !== 0) {
      await ffmpeg.deleteFile(output).catch(() => undefined)
      code = await ffmpeg.exec(trimVideoArgs(input, output, start, end, false))
    }
    return code
  }
  finally {
    ffmpeg.off('progress', onEncode)
  }
}

async function outputBlob(ffmpeg: FfmpegHandle, name: string) {
  const output = await ffmpeg.readFile(name)
  if (typeof output === 'string' || !output.byteLength)
    throw new MergeVideoError('encode')
  const copy = new ArrayBuffer(output.byteLength)
  new Uint8Array(copy).set(output)
  return new Blob([copy], { type: 'video/mp4' })
}

const VIDEO_BITSTREAM_FILTERS = ['h264_mp4toannexb', 'hevc_mp4toannexb']

async function writeTransportStream(ffmpeg: FfmpegHandle, input: string, output: string) {
  for (const filter of VIDEO_BITSTREAM_FILTERS) {
    const code = await ffmpeg.exec(mergeToTsArgs(input, output, filter))
    if (code === 0)
      return true
    await ffmpeg.deleteFile(output).catch(() => undefined)
  }
  const code = await ffmpeg.exec(mergeToTsArgs(input, output))
  if (code === 0)
    return true
  await ffmpeg.deleteFile(output).catch(() => undefined)
  return false
}

/** 每段先收成 MPEG-TS 再接上，后一段的时间才会从成片结尾继续。 */
async function concatWithTimeline(
  ffmpeg: FfmpegHandle,
  names: string[],
  tsNames: string[],
  onStep?: (done: number, total: number) => void,
) {
  const total = names.length + 1
  onStep?.(0, total)
  for (let index = 0; index < names.length; index += 1) {
    const tsName = `part-${index}.ts`
    const ready = await writeTransportStream(ffmpeg, names[index] || '', tsName)
    if (!ready)
      return 1
    tsNames.push(tsName)
    onStep?.(index + 1, total)
  }
  let code = await ffmpeg.exec(mergeTsConcatArgs(tsNames, true))
  if (code !== 0) {
    await ffmpeg.deleteFile('merged.mp4').catch(() => undefined)
    code = await ffmpeg.exec(mergeTsConcatArgs(tsNames, false))
  }
  if (code === 0)
    onStep?.(total, total)
  return code
}

async function fileDuration(ffmpeg: FfmpegHandle, file: string) {
  let duration = 0
  const onLog = ({ message }: { message: string }) => {
    duration = Math.max(duration, parseClockDuration(message))
  }
  ffmpeg.on('log', onLog)
  try {
    await ffmpeg.exec(['-i', file])
  }
  catch {
    return duration
  }
  finally {
    ffmpeg.off('log', onLog)
  }
  return duration
}

/** 成片容器时长停在前一段，就当成没接上，改走转码。 */
async function timelineStoppedEarly(ffmpeg: FfmpegHandle, names: string[]) {
  const inputs: number[] = []
  for (const name of names)
    inputs.push(await fileDuration(ffmpeg, name))
  const output = await fileDuration(ffmpeg, 'merged.mp4')
  return mergeDurationShort(inputs, output)
}
