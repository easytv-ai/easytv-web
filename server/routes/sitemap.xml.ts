function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** 公开页：首页、定价、法律页；作品播放页从 API 动态取（最多 500 条） */
const PUBLIC_PATHS = ['/agent', '/studio', '/pricing', '/legal/terms', '/legal/privacy', '/legal/ai-guidelines']

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const siteUrl = String(config.public.siteUrl || 'http://localhost:3005').replace(/\/$/, '')
  const apiBase = String(config.public.apiBaseUrl || '').replace(/\/$/, '')
  const now = new Date().toISOString()

  const entries: { loc: string, lastmod: string, priority: string }[] = PUBLIC_PATHS.map(path => ({
    loc: `${siteUrl}${path}`,
    lastmod: now,
    priority: path === '/agent' ? '1.0' : '0.6',
  }))

  if (apiBase) {
    try {
      const res = await $fetch<{ success: boolean, data?: { items: { id: number, updated_at: number, published_at: number }[] } }>(`${apiBase}/work`, {
        query: { page: 1, page_size: 500 },
        timeout: 5000,
      })
      for (const w of res?.data?.items ?? []) {
        entries.push({
          loc: `${siteUrl}/watch/${w.id}`,
          lastmod: new Date((w.updated_at || w.published_at) * 1000).toISOString(),
          priority: '0.8',
        })
      }
    }
    catch {
      // API 不可用时只输出静态页
    }
  }

  const urls = entries.map(e => `  <url>
    <loc>${escapeXml(e.loc)}</loc>
    <lastmod>${e.lastmod}</lastmod>
    <priority>${e.priority}</priority>
  </url>`).join('\n')

  setHeader(event, 'content-type', 'application/xml; charset=utf-8')
  setHeader(event, 'cache-control', 'public, max-age=3600')
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`
})
