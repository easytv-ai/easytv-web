/**
 * 服务端媒体代理（/api/canvas-media、/api/poster-image）允许抓取的域名。
 * 由运行时配置拼出，不写死任何官方域名，自托管时只需配环境变量：
 * - NUXT_PUBLIC_API_BASE_URL  后端域名（上传文件 /upload/... 走这里）
 * - NUXT_PUBLIC_SITE_URL      本站域名（public/ 下的静态素材）
 * - NUXT_PUBLIC_MEDIA_HOSTS   额外域名，逗号分隔（OSS / CDN）
 */
export { isAllowedMediaUrl } from '~/utils/media-hosts'

export function allowedMediaHosts(): { hosts: Set<string>, apiHost: string } {
  const pub = useRuntimeConfig().public
  const hosts = new Set<string>()
  const add = (value: unknown) => {
    const raw = String(value || '').trim()
    if (!raw)
      return ''
    try {
      const host = new URL(raw.includes('://') ? raw : `https://${raw}`).hostname
      if (host)
        hosts.add(host)
      return host
    }
    catch {
      return ''
    }
  }
  const apiHost = add(pub.apiBaseUrl)
  add(pub.siteUrl)
  for (const item of String(pub.mediaHosts || '').split(','))
    add(item)
  return { hosts, apiHost }
}
