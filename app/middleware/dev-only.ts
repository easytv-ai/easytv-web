/**
 * 仅开发环境可进。生产构建里配合 nuxt.config pages:extend 会直接拿掉路由。
 */
export default defineNuxtRouteMiddleware(() => {
  if (import.meta.dev)
    return
  const localePath = useLocalePath()
  return navigateTo(localePath('/'))
})
