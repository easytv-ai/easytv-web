import { pathWithoutLocale } from '~/utils/app-path'
import {
  AUTH_LOGIN_REDIRECT_QUERY,
  resolveLoginRedirectPath,
} from '~/utils/auth-login-redirect'

function localizeRedirect(target: string, localePath: (path: string) => string) {
  const hashIndex = target.indexOf('#')
  const hash = hashIndex >= 0 ? target.slice(hashIndex) : ''
  const withoutHash = hashIndex >= 0 ? target.slice(0, hashIndex) : target
  const queryIndex = withoutHash.indexOf('?')
  const pathname = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash
  const search = queryIndex >= 0 ? withoutHash.slice(queryIndex) : ''
  return `${localePath(pathWithoutLocale(pathname) || '/agent')}${search}${hash}`
}

/** 登录成功后关掉弹窗，回到来源页或 fallback */
export async function redirectAfterAuthLogin(options?: {
  fallbackPath?: string
}) {
  const localePath = useLocalePath()
  const route = useRoute()
  const { closeLogin, redirect: modalRedirect } = useLoginModal()
  const fromModal = modalRedirect.value
  closeLogin()
  const queryRedirect = route.query[AUTH_LOGIN_REDIRECT_QUERY]
  const raw = fromModal || (Array.isArray(queryRedirect) ? queryRedirect[0] : queryRedirect)
  const fallback = options?.fallbackPath ?? '/agent'
  const target = resolveLoginRedirectPath(raw ? String(raw) : null, fallback)
  return navigateTo(localizeRedirect(target, localePath))
}
