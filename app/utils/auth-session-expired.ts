import { useAuth } from '~/composables/useAuth'
import { AUTH_EXPIRED_STORAGE_KEY, AUTH_USER_STORAGE_KEY, getAccessToken } from '~/utils/auth-user'
import { writeAuthSessionCookie } from '~/utils/auth-session-cookie'
import { pathWithoutLocale } from '~/utils/app-path'
import { buildLoginPath } from '~/utils/auth-login-redirect'
import { openLoginModalState } from '~/utils/login-modal'

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
  // 请求回调里 Nuxt 上下文可能已经没了，先直接清掉本地会话，避免界面还停在已登录。
  try {
    localStorage.removeItem(AUTH_USER_STORAGE_KEY)
  }
  catch {
    // 隐私模式写不了存储时，仍继续清内存里的登录态
  }
  writeAuthSessionCookie(false)
  const apply = () => useAuth().setUser(null)
  try {
    const nuxtApp = tryUseNuxtApp()
    if (nuxtApp)
      nuxtApp.runWithContext(apply)
    else
      apply()
  }
  catch {
    // 本地会话已经清掉；内存状态在下次进入页面时会按空存储再同步
  }
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

const SESSION_EXPIRED_CODES = new Set([
  'invalid_token',
  'not_logged_in',
  'user_mismatch',
  'user_disabled',
  'user_header_missing',
  'user_header_invalid',
])

function sessionExpiredCode(payload: Record<string, unknown>): string {
  if (typeof payload.code === 'string')
    return payload.code
  const data = payload.data
  if (data && typeof data === 'object' && typeof (data as { code?: unknown }).code === 'string')
    return (data as { code: string }).code
  return ''
}

/** 未登录 / 会话失效 → 需退出并重新登录 */
export function isSessionExpiredResponse(res: unknown): boolean {
  if (!res || typeof res !== 'object')
    return false
  const payload = res as Record<string, unknown>
  const msg = String(payload.message ?? '').toLowerCase()
  const statusCode = Number(payload.statusCode ?? payload.status)
  const code = sessionExpiredCode(payload)

  if (code === 'invalid_token' || code === 'user_mismatch' || code === 'user_disabled')
    return true

  if (SESSION_EXPIRED_CODES.has(code) && getAccessToken())
    return true

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

  if (
    msg.includes('无效的登录凭证')
    || msg.includes('登录凭证不匹配')
    || msg.includes('账号已被禁用')
  )
    return true

  if (getAccessToken() && msg.includes('登录已过期'))
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
  if (!import.meta.client || shouldSkipAuthRedirect(payload))
    return true

  clearAuthSession()

  if (redirecting || window.location.pathname.includes('/login'))
    return true

  redirecting = true
  sessionStorage.setItem(AUTH_EXPIRED_STORAGE_KEY, '1')
  const returnPath = `${window.location.pathname}${window.location.search}${window.location.hash}`
  try {
    openLoginModalState({ redirect: returnPath, tab: 'login' })
  }
  catch {
    redirecting = false
    const prefix = window.location.pathname.match(/^\/(zh-tw|zh|en|fr|ja|ru|vi)(?=\/|$)/i)?.[0] ?? ''
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
