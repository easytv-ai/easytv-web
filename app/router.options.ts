import type { RouterConfig } from '@nuxt/schema'

/** 根路径不再有页面，直接进首页（EasyTV Agent）。各语言前缀同样处理。 */
const homeRedirects = [
  { path: '/', redirect: '/agent' },
  { path: '/zh-tw', redirect: '/zh-tw/agent' },
  { path: '/en', redirect: '/en/agent' },
  { path: '/fr', redirect: '/fr/agent' },
  { path: '/ja', redirect: '/ja/agent' },
  { path: '/ru', redirect: '/ru/agent' },
  { path: '/vi', redirect: '/vi/agent' },
]

export default {
  routes: (routes) => [
    ...homeRedirects.map(item => ({
      name: `home-redirect-${item.path === '/' ? 'root' : item.path.slice(1)}`,
      path: item.path,
      redirect: item.redirect,
    })),
    ...routes,
  ],
} satisfies RouterConfig
