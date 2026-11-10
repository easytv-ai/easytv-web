import { setHeader } from 'h3'

const RASTER_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
])

/** 图片代理只回栅格图。image/svg+xml 在本站地址打开时会执行脚本。 */
export function isRasterImageType(type: string) {
  return RASTER_TYPES.has(type)
}

/** 视频代理可回传的类型。不含 svg / html。 */
export function isProxyMediaType(type: string) {
  return type.startsWith('video/')
    || type.startsWith('audio/')
    || isRasterImageType(type)
    || type === 'application/octet-stream'
    || type === 'application/mp4'
    || type === 'binary/octet-stream'
}

/** 上游把 SVG 标成图片时，看开头字节拦住。 */
export function looksLikeMarkup(bytes: Uint8Array) {
  let start = 0
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF)
    start = 3
  while (start < bytes.length && (bytes[start] === 0x20 || bytes[start] === 0x09 || bytes[start] === 0x0A || bytes[start] === 0x0D))
    start += 1
  const head = String.fromCharCode(...bytes.slice(start, start + 16)).toLowerCase()
  return head.startsWith('<svg')
    || head.startsWith('<?xml')
    || head.startsWith('<!doctype')
    || head.startsWith('<html')
}

/** 即使类型被认错，也不让这段响应在本站域名里当页面执行。 */
export function setMediaProxyHeaders(event: Parameters<typeof setHeader>[0], type: string) {
  setHeader(event, 'content-type', type)
  setHeader(event, 'x-content-type-options', 'nosniff')
  setHeader(event, 'content-security-policy', "default-src 'none'; style-src 'none'; script-src 'none'; sandbox")
}
