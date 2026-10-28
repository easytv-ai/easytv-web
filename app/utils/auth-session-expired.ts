import { useAuth } from '~/composables/useAuth'
import { AUTH_EXPIRED_STORAGE_KEY, getAccessToken } from '~/utils/auth-user'
import { pathWithoutLocale } from '~/utils/app-path'
import { buildLoginPath } from '~/utils/auth-login-redirect'

let redirecting = false

/** 会话失效跳转进行中 */
export function isSessionExpiryRedirectPending(): boolean {
  if (!import.meta.client)
    return false
  return redirecting || !!sessionStorage.getItem(AUTH_EXPIRED_STORAGE_KEY)
}

export function resetSessionExpiryRedirectState() {
  redirecting = false
}

function clearAuthSession() {
  if (!import.meta.client)
    return
  const { setUser } = useAuth()
  setUser(null)
}

export function normalizeSessionCheckPayload(
  data: unknown,
  status?: number,
): Record<string, unknown> {
  const record = data && typeof data === 'object' && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {}
  const statusCode = status ?? Number(record.statusCode ?? record.status)
  let message = ''
  const error = record.error
  if (error && typeof error === 'object')
    message = String((error as { message?: string }).message ?? '')
  else if (typeof error === 'string')
    message = error
  if (!message && typeof record.message === 'string')
    message = record.message
  return {
    ...record,
    ...(Number.isFinite(statusCode) ? { statusCode, status: statusCode } : {}),
    message,
  }
}

/** Demo 页：本地仍有 token 但已失效时可暂不跳转；完全未登录（401）仍跳转登录 */
function shouldSkipAuthRedirect(res: Record<string, unknown>): boolean {
  if (!import.meta.client)
    return false
  const base = pathWithoutLocale(window.location.pathname)
  const onDemo = base === '/demo/chat' || base.startsWith('/demo/')
  if (!onDemo)
    return false
  const statusCode = Number(res.statusCode ?? res.status)
  if (statusCode === 401)
    return false
  const msg = String(res.message ?? '').toLowerCase()
  if (msg.includes('未登录') && msg.includes('未提供'))
    return false
  return !!getAccessToken()
}

/** 未登录 / 会话失效 → 需跳转登录 */
export function isSessionExpiredResponse(res: unknown): boolean {
  if (!res || typeof res !== 'object')
    return false
  const payload = res as Record<string, unknown>
  const msg = String(payload.message ?? '').toLowerCase()
  const statusCode = Number(payload.statusCode ?? payload.status)

  if (statusCode === 401) {
  // 本地仍有 token 时，401 视为会话失效（避免仅清 user 不清 isLoggedIn 引发误跳）
    if (getAccessToken())
      return true
    if (msg.includes('未登录') && msg.includes('access token'))
      return true
    if (msg.includes('not logged in') && msg.includes('access token'))
      return true
    return false
  }

  if (msg.includes('access token') && (msg.includes('invalid') || msg.includes('无效')))
    return true

  if (msg.includes('未登录') && msg.includes('access token'))
    return true

  if (msg.includes('not logged in') && msg.includes('access token'))
    return true

  if (!getAccessToken())
    return false

  return msg.includes('access token')
    && (msg.includes('未登录') || msg.includes('not logged in'))
}

/** 会话失效：跳转登录、清理本地会话并标记登录过期提示 */
export function handleSessionExpiredIfNeeded(data: unknown, status?: number): boolean {
  const payload = normalizeSessionCheckPayload(data, status)
  if (!isSessionExpiredResponse(payload))
    return false
  if (
    import.meta.client
    && !shouldSkipAuthRedirect(payload)
    && !redirecting
    && !window.location.pathname.includes('/login')
  ) {
    redirecting = true
    clearAuthSession()
    sessionStorage.setItem(AUTH_EXPIRED_STORAGE_KEY, '1')
    const prefix = window.location.pathname.match(/^\/(zh-tw|zh|en|fr|ja|ru|vi)(?=\/|$)/i)?.[0] ?? ''
    const returnPath = `${window.location.pathname}${window.location.search}${window.location.hash}`
    window.location.assign(buildLoginPath(returnPath, { localePrefix: prefix }))
  }
  return true
}

export function wrapIfUnauthorized<T extends Record<string, unknown>>(res: T): T & { unauthorized?: boolean } {
  if (!isSessionExpiredResponse(res))
    return res
  handleSessionExpiredIfNeeded(res)
  return { ...res, unauthorized: true }
}
