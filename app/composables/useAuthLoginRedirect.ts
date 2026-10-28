import {
  AUTH_LOGIN_REDIRECT_QUERY,
  buildLoginRedirectQuery,
  storeLoginRedirect,
} from '~/utils/auth-login-redirect'

/** 跳转登录页，并携带登录成功后的回跳路径 */
export function useAuthLoginRedirect() {
  const localePath = useLocalePath()
  const route = useRoute()

  function goToLogin(redirectPath?: string) {
    const target = redirectPath ?? route.fullPath
    const query = buildLoginRedirectQuery(target)
    return navigateTo(localePath({ path: '/login', query }))
  }

  function persistRedirectFromRoute() {
    const redirect = route.query[AUTH_LOGIN_REDIRECT_QUERY]
    const raw = Array.isArray(redirect) ? redirect[0] : redirect
    if (raw)
      storeLoginRedirect(String(raw))
  }

  return { goToLogin, persistRedirectFromRoute }
}
