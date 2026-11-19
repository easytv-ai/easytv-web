/**
 * 开发时 node 的 req.url 经常是相对路径（`/api/_nuxt_icon/lucide.json?...`）。
 * h3@2 的 getQuery / getRequestURL 会 `new URL(event.req.url)`，相对路径直接 Invalid URL。
 * 图标接口还包了一层缓存：真正的 handler 拿到的是克隆出来的新 event，
 * 只改原 event.url 盖不到它。所以把 req.url 收成访问器，读出来始终是绝对地址。
 * nitro-cloudflare-dev 会把自己的 request 钩子插到最前，这里等插件都注册完再抢回最前。
 */
function header(req: { headers?: Record<string, string | string[] | undefined> | Headers }, name: string) {
  const headers = req.headers
  if (!headers)
    return ''
  if (typeof (headers as Headers).get === 'function')
    return (headers as Headers).get(name) || ''
  const value = (headers as Record<string, string | string[] | undefined>)[name]
  return (Array.isArray(value) ? value[0] : value) || ''
}

function absoluteHref(raw: string, req: { headers?: Record<string, string | string[] | undefined> | Headers }) {
  if (!raw || raw.includes('://'))
    return raw
  const host = header(req, 'host') || '127.0.0.1'
  const proto = header(req, 'x-forwarded-proto') === 'https' ? 'https' : 'http'
  return new URL(raw, `${proto}://${host}`).href
}

function absoluteRequestUrl(event: {
  url?: URL | string
  req?: { url?: string, headers?: Record<string, string | string[] | undefined> | Headers }
  node?: { req?: { url?: string, headers?: Record<string, string | string[] | undefined> | Headers } }
}) {
  const req = event.node?.req ?? event.req
  if (!req || typeof req.url !== 'string')
    return
  if (!(event.url instanceof URL)) {
    try {
      event.url = new URL(absoluteHref(req.url, req))
    }
    catch {
      // 解析失败交给后面的处理器
    }
  }
  if (req.url.includes('://'))
    return
  const desc = Object.getOwnPropertyDescriptor(req, 'url')
  if (desc && desc.configurable === false)
    return
  let stored = req.url
  try {
    Object.defineProperty(req, 'url', {
      configurable: true,
      enumerable: desc?.enumerable ?? true,
      get() {
        try {
          return absoluteHref(stored, req)
        }
        catch {
          return stored
        }
      },
      set(value: string) {
        stored = value
      },
    })
  }
  catch {
    // 写不了 url 时，至少 event.url 已经补上
  }
}

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('request', absoluteRequestUrl)
  queueMicrotask(() => {
    const hooks = nitro.hooks._hooks?.request as unknown[] | undefined
    if (!hooks)
      return
    const index = hooks.indexOf(absoluteRequestUrl)
    if (index > 0) {
      hooks.splice(index, 1)
      hooks.unshift(absoluteRequestUrl)
    }
  })
})
