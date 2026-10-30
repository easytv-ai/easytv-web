export default defineEventHandler((event) => {
  const siteUrl = String(useRuntimeConfig().public.siteUrl || 'http://localhost:3005').replace(/\/$/, '')

  setHeader(event, 'content-type', 'text/plain; charset=utf-8')
  setHeader(event, 'cache-control', 'public, max-age=3600')

  return `User-agent: *
Allow: /
Disallow: /console
Disallow: /*/console
Disallow: /setting
Disallow: /*/setting
Disallow: /login
Disallow: /*/login
Disallow: /register
Disallow: /*/register
Disallow: /forgot-password
Disallow: /*/forgot-password
Disallow: /user/
Disallow: /*/user/
Disallow: /oauth/
Disallow: /*/oauth/

Sitemap: ${siteUrl}/sitemap.xml
`
})
