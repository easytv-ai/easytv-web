import { pathWithoutLocale } from '~/utils/app-path'
import { AUTH_SESSION_COOKIE, hasAuthSessionMarker } from '~/utils/auth-session-cookie'

/**
 * 已登录访问营销首页时，直接进入创作台。
 * 服务端凭登录标记 cookie 判断并直接重定向，不再先渲染落地页再由客户端跳转，避免 hydration 错位。
 */
export default defineNuxtRouteMiddleware((to) => {
  if (pathWithoutLocale(to.path) !== '/')
    return
  if (import.meta.server) {
    if (hasAuthSessionMarker(useCookie(AUTH_SESSION_COOKIE).value))
      return navigateTo(useLocalePath()('/studio'))
    return
  }

  const { hydrate, isLoggedIn } = useAuth()
  hydrate()
  if (!isLoggedIn.value)
    return

  const localePath = useLocalePath()
  return navigateTo(localePath('/studio'))
})
