/**
 * 需登录才可访问的路由中间件。
 * 令牌仍在 localStorage，服务端读不到。登录标记 cookie 只表示「这个浏览器登过」，
 * 没有标记就在服务端直接去登录页，避免受保护页先画出来再跳走。
 * 有标记才放行：客户端再按 localStorage 核对，坏掉的标记会在 hydrate 时清掉。
 */
import { buildLoginRedirectQuery } from '~/utils/auth-login-redirect'
import { AUTH_SESSION_COOKIE, hasAuthSessionMarker } from '~/utils/auth-session-cookie'

export default defineNuxtRouteMiddleware((to) => {
  const localePath = useLocalePath()
  const loginTo = () => localePath({
    path: '/login',
    query: buildLoginRedirectQuery(to.fullPath),
  })

  if (import.meta.server) {
    if (hasAuthSessionMarker(useCookie(AUTH_SESSION_COOKIE).value))
      return
    return navigateTo(loginTo())
  }

  const { user, hydrate } = useAuth()
  const isLoggedIn = useState('isLoggedIn', () => false)
  hydrate()

  if (user.value) {
    isLoggedIn.value = true
    return
  }

  return navigateTo(loginTo())
})
