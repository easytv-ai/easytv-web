import { pathWithoutLocale } from '~/utils/app-path'

export const AUTH_LOGIN_REDIRECT_QUERY = 'redirect'
export const AUTH_LOGIN_REDIRECT_STORAGE_KEY = 'easyapi-auth-login-redirect'

const BLOCKED_REDIRECT_PATHS = new Set([
  '/login',
  '/register',
  '/forgot-password',
  '/user/reset',
  '/bind-email',
])

/** 仅允许站内相对路径，防止开放重定向 */
export function sanitizeLoginRedirectPath(path: string): string | null {
  const raw = String(path ?? '').trim()
  if (!raw.startsWith('/') || raw.startsWith('//'))
    return null

  const pathname = raw.split(/[?#]/)[0] ?? raw
  const base = pathWithoutLocale(pathname)
  if (BLOCKED_REDIRECT_PATHS.has(base))
    return null

  return raw
}

export function storeLoginRedirect(path: string) {
  if (!import.meta.client)
    return
  const safe = sanitizeLoginRedirectPath(path)
  if (safe)
    sessionStorage.setItem(AUTH_LOGIN_REDIRECT_STORAGE_KEY, safe)
}

export function consumeStoredLoginRedirect(): string | null {
  if (!import.meta.client)
    return null
  const stored = sessionStorage.getItem(AUTH_LOGIN_REDIRECT_STORAGE_KEY)
  sessionStorage.removeItem(AUTH_LOGIN_REDIRECT_STORAGE_KEY)
  return sanitizeLoginRedirectPath(stored ?? '')
}

export function buildLoginRedirectQuery(redirectPath?: string): Record<string, string> {
  const safe = sanitizeLoginRedirectPath(String(redirectPath ?? ''))
  if (!safe)
    return {}
  storeLoginRedirect(safe)
  return { [AUTH_LOGIN_REDIRECT_QUERY]: safe }
}

export function buildLoginPath(
  redirectPath?: string,
  options?: { localePrefix?: string },
): string {
  const prefix = String(options?.localePrefix ?? '')
  const base = `${prefix}/login`
  const safe = sanitizeLoginRedirectPath(String(redirectPath ?? ''))
  if (!safe)
    return base
  storeLoginRedirect(safe)
  const params = new URLSearchParams()
  params.set(AUTH_LOGIN_REDIRECT_QUERY, safe)
  return `${base}?${params.toString()}`
}

export function resolveLoginRedirectPath(
  queryRedirect?: string | null,
  fallback = '/studio',
): string {
  const fromQuery = sanitizeLoginRedirectPath(String(queryRedirect ?? ''))
  if (fromQuery) {
    if (import.meta.client)
      sessionStorage.removeItem(AUTH_LOGIN_REDIRECT_STORAGE_KEY)
    return fromQuery
  }

  const fromStorage = consumeStoredLoginRedirect()
  if (fromStorage)
    return fromStorage

  return fallback
}
