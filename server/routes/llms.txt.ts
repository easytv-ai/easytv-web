export default defineEventHandler((event) => {
  const siteUrl = String(useRuntimeConfig().public.siteUrl || 'https://www.easytv.ai').replace(/\/$/, '')
  setHeader(event, 'content-type', 'text/plain; charset=utf-8')
  setHeader(event, 'cache-control', 'public, max-age=3600')
  return `# EasyTV

> EasyTV 是 AI 视频创作平台：在自由画布上组合文本、图片、视频、音频节点，调用大模型生成成片，并发布到首页信息流。

## 主要页面

- 首页: ${siteUrl}/agent
- 精选成片: ${siteUrl}/studio
- 定价（会员与积分）: ${siteUrl}/pricing
- 作品播放页: ${siteUrl}/watch/{id}
- 用户服务协议: ${siteUrl}/legal/terms
- 隐私政策: ${siteUrl}/legal/privacy
- AI 生成内容规范: ${siteUrl}/legal/ai-guidelines

## 说明

- 创作台需要登录，页面内容为用户生成内容，包含 AI 生成的图片与视频。
- 站点地图: ${siteUrl}/sitemap.xml
`
})
