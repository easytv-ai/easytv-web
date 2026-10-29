import { pathWithoutLocale } from '~/utils/app-path'
import { sanitizeLoginRedirectPath, storeLoginRedirect } from '~/utils/auth-login-redirect'
import { OPEN_LOGIN_COOKIE, type LoginModalTab } from '~/utils/login-modal'

/**
 * /login、/register、/forgot-password 不再作为页面停留。
 * 记下要打开的 Tab，回到回跳地址或首页，由登录弹窗接住。
 */
function queryText(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value
  return String(raw ?? '').trim()
}

export default defineNuxtRouteMiddleware((to) => {
  const base = pathWithoutLocale(to.path)
  const tab: LoginModalTab = base === '/register'
    ? 'register'
    : base === '/forgot-password'
      ? 'forgot'
      : 'login'

  const cookie = useCookie<string | null>(OPEN_LOGIN_COOKIE, { path: '/', maxAge: 60 })
  cookie.value = tab

  const redirect = sanitizeLoginRedirectPath(queryText(to.query.redirect))
  if (import.meta.client && redirect)
    storeLoginRedirect(redirect)

  const target = redirect || '/studio'
  const hashIndex = target.indexOf('#')
  const hash = hashIndex >= 0 ? target.slice(hashIndex) : ''
  const withoutHash = hashIndex >= 0 ? target.slice(0, hashIndex) : target
  const queryIndex = withoutHash.indexOf('?')
  const pathname = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash
  const params = new URLSearchParams(queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : '')
  for (const key of ['ref', 'aff', 'pcode'] as const) {
    const value = queryText(to.query[key])
    if (value && !params.has(key))
      params.set(key, value)
  }

  const localePath = useLocalePath()
  const search = params.toString()
  return navigateTo(`${localePath(pathname || '/agent')}${search ? `?${search}` : ''}${hash}`, { replace: true })
})
