/**
 * 节点下载怎么取到字节：对象存储（OSS）多半没有 CORS 头，跨域 fetch 直接抛错。
 * 顺序：直连 → 本站同源代理 /api/canvas-media（服务端取，带域名白名单）→ 都不行就交给调用方新窗口打开原地址。
 */

export type DownloadFetch = (url: string) => Promise<{ ok: boolean, blob: () => Promise<Blob> }>

export type DownloadResult =
  | { via: 'direct' | 'proxy', blob: Blob }
  | { via: 'open' }

/** 跨域的 http(s) 地址才有代理可走；同源 / blob: / data: 直连失败说明资源本身有问题，代理也救不了 */
export function downloadProxyUrl(href: string, pageOrigin: string): string | null {
  const value = String(href || '').trim()
  if (!value || /^(blob:|data:)/i.test(value))
    return null
  try {
    const parsed = new URL(value, pageOrigin)
    if (!/^https?:$/.test(parsed.protocol) || parsed.origin === pageOrigin)
      return null
    return `/api/canvas-media?url=${encodeURIComponent(parsed.toString())}`
  }
  catch {
    return null
  }
}

async function tryBlob(fetcher: DownloadFetch, url: string): Promise<Blob | null> {
  try {
    const res = await fetcher(url)
    return res.ok ? await res.blob() : null
  }
  catch {
    return null
  }
}

export async function fetchDownloadBlob(href: string, pageOrigin: string, fetcher: DownloadFetch): Promise<DownloadResult> {
  const direct = await tryBlob(fetcher, href)
  if (direct)
    return { via: 'direct', blob: direct }
  const proxy = downloadProxyUrl(href, pageOrigin)
  const proxied = proxy ? await tryBlob(fetcher, proxy) : null
  return proxied ? { via: 'proxy', blob: proxied } : { via: 'open' }
}
