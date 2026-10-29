import {
  AUTH_LOGIN_REDIRECT_QUERY,
  storeLoginRedirect,
} from '~/utils/auth-login-redirect'

/** 在当前页打开登录弹窗，并记下登录成功后的回跳路径 */
export function useAuthLoginRedirect() {
  const route = useRoute()
  const { openLogin } = useLoginModal()

  function goToLogin(redirectPath?: string) {
    openLogin({ tab: 'login', redirect: redirectPath ?? route.fullPath })
  }

  function persistRedirectFromRoute() {
    const redirect = route.query[AUTH_LOGIN_REDIRECT_QUERY]
    const raw = Array.isArray(redirect) ? redirect[0] : redirect
    if (raw)
      storeLoginRedirect(String(raw))
  }

  return { goToLogin, persistRedirectFromRoute }
}
