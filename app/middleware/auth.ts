/**
 * 需登录才可访问的路由。
 * 令牌在 localStorage，服务端只能看登录标记 cookie。
 * 有标记就直接渲染页面；没有标记也留在当前页，客户端再弹出登录框。
 * 不再把访客送到独立的 /login 页面。
 */
import { AUTH_SESSION_COOKIE, hasAuthSessionMarker } from '~/utils/auth-session-cookie'
import { LOGIN_MODAL_REQUIRED } from '~/utils/login-modal'

export default defineNuxtRouteMiddleware((to) => {
  const required = useState(LOGIN_MODAL_REQUIRED, () => '')

  if (import.meta.server) {
    if (hasAuthSessionMarker(useCookie(AUTH_SESSION_COOKIE).value)) {
      required.value = ''
      return
    }
    required.value = to.fullPath
    return
  }

  const { user, hydrate } = useAuth()
  const isLoggedIn = useState('isLoggedIn', () => false)
  hydrate()
  if (user.value) {
    isLoggedIn.value = true
    required.value = ''
    return
  }
  required.value = to.fullPath
})
