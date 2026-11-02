/** 海报要画进 canvas 再导出。OSS 封面没有 CORS 头，浏览器直接画会失败，上面只剩空渐变。只代理 allowedMediaHosts 里的域名。 */
import { allowedMediaHosts, isAllowedMediaUrl } from '../utils/media-hosts'

export default defineEventHandler(async (event) => {
  const raw = String(getQuery(event).url || '')
  let target: URL
  try {
    target = new URL(raw)
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: '无效的图片地址' })
  }
  const { hosts } = allowedMediaHosts()
  if (!isAllowedMediaUrl(target, hosts))
    throw createError({ statusCode: 400, statusMessage: '不支持的图片地址' })

  const res = await fetch(target.toString(), { redirect: 'error' })
  if (!res.ok)
    throw createError({ statusCode: 502, statusMessage: '封面读取失败' })
  const type = ((res.headers.get('content-type') || '').split(';')[0] ?? '').trim().toLowerCase()
  if (!type.startsWith('image/'))
    throw createError({ statusCode: 400, statusMessage: '不是图片' })
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.byteLength > 8 * 1024 * 1024)
    throw createError({ statusCode: 413, statusMessage: '图片过大' })

  setHeader(event, 'content-type', type)
  setHeader(event, 'cache-control', 'private, max-age=300')
  return bytes
})
