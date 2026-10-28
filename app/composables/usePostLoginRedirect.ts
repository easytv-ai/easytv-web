import {
  AUTH_LOGIN_REDIRECT_QUERY,
  resolveLoginRedirectPath,
} from '~/utils/auth-login-redirect'

/** 登录成功后回到来源页或 fallback */
export async function redirectAfterAuthLogin(options?: {
  fallbackPath?: string
}) {
  const localePath = useLocalePath()
  const route = useRoute()
  const redirect = route.query[AUTH_LOGIN_REDIRECT_QUERY]
  const raw = Array.isArray(redirect) ? redirect[0] : redirect
  const fallback = options?.fallbackPath ?? '/studio'
  const target = resolveLoginRedirectPath(raw ? String(raw) : null, fallback)
  return navigateTo(localePath(target))
}
