import { Readable } from 'node:stream'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { getRequestHeader, sendStream } from 'h3'
import { allowedMediaHosts, isAllowedMediaUrl } from '../utils/media-hosts'
import { isProxyMediaType, setMediaProxyHeaders } from '../utils/media-proxy'

const MAX_BYTES = 512 * 1024 * 1024

/** OSS 视频没有 CORS 头，浏览器不能直接交给 ffmpeg。只代理白名单域名。 */
export default defineEventHandler(async (event) => {
  const raw = String(getQuery(event).url || '')
  let target: URL
  try {
    target = new URL(raw)
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: '无效的视频地址' })
  }
  const { hosts, apiHost } = allowedMediaHosts()
  if (!isAllowedMediaUrl(target, hosts))
    throw createError({ statusCode: 400, statusMessage: '不支持的视频地址' })

  const headers: Record<string, string> = {}
  const range = getRequestHeader(event, 'range')
  if (range)
    headers.range = range
  if (apiHost && target.hostname === apiHost) {
    const authorization = getRequestHeader(event, 'authorization')
    if (authorization)
      headers.authorization = authorization
  }

  let res: Response
  try {
    res = await openAllowedMedia(target, hosts, headers)
  }
  catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error)
      throw error
    throw createError({ statusCode: 502, statusMessage: '视频读取失败' })
  }
  if (!res.ok || !res.body)
    throw createError({ statusCode: 502, statusMessage: '视频读取失败' })

  const length = Number(res.headers.get('content-length') || 0)
  const contentRange = res.headers.get('content-range') || ''
  const totalMatch = contentRange.match(/\/(\d+)\s*$/)
  const total = totalMatch ? Number(totalMatch[1]) : length
  if (Number.isFinite(total) && total > MAX_BYTES)
    throw createError({ statusCode: 413, statusMessage: '视频过大' })
  const type = ((res.headers.get('content-type') || '').split(';')[0] ?? '').trim().toLowerCase()
  if (type && !isProxyMediaType(type))
    throw createError({ statusCode: 400, statusMessage: '不是视频' })

  if (res.status === 206)
    setResponseStatus(event, 206)
  if (contentRange)
    setHeader(event, 'content-range', contentRange)
  const acceptRanges = res.headers.get('accept-ranges')
  if (acceptRanges)
    setHeader(event, 'accept-ranges', acceptRanges)
  else if (res.status === 206 || range)
    setHeader(event, 'accept-ranges', 'bytes')
  setMediaProxyHeaders(event, type || 'video/mp4')
  if (length > 0)
    setHeader(event, 'content-length', length)
  setHeader(event, 'cache-control', 'private, max-age=3600')
  return sendStream(event, Readable.fromWeb(res.body as WebReadableStream))
})

async function openAllowedMedia(target: URL, hosts: Set<string>, headers: Record<string, string>) {
  let current = target
  for (let hop = 0; hop < 3; hop += 1) {
    const res = await fetch(current.toString(), { headers, redirect: 'manual' })
    if (res.status < 300 || res.status >= 400)
      return res
    await res.body?.cancel()
    const location = res.headers.get('location')
    if (!location)
      throw createError({ statusCode: 502, statusMessage: '视频读取失败' })
    const next = new URL(location, current)
    if (!isAllowedMediaUrl(next, hosts))
      throw createError({ statusCode: 400, statusMessage: '不支持的视频地址' })
    current = next
  }
  throw createError({ statusCode: 502, statusMessage: '视频读取失败' })
}
