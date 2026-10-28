import { resolveAcceptLanguageHeader } from '~/utils/acceptLanguage'
import { authUserHeaders } from '~/utils/auth-user'
import { normalizeFetchErrorBody } from '~/utils/http-status-message'
import { handleTeamForbidden } from '~/utils/workspace'
import {
  isSessionExpiredResponse,
  wrapIfUnauthorized,
} from '~/utils/auth-session-expired'

const REQUEST_TIMEOUT = 120000

function normalizeOrigin(raw: string): string {
  const s = String(raw ?? '').trim().replace(/\/$/, '')
  if (!s)
    return ''
  if (/^https?:\/\//i.test(s))
    return s
  return `http://${s}`
}

function resolveUrl(url: string): string {
  if (/^https?:\/\//i.test(url))
    return url
  const base = normalizeOrigin(useRuntimeConfig().public.apiBaseUrl)
  return `${base}${url.startsWith('/') ? url : `/${url}`}`
}

function withLanguageHeaders(headers?: Record<string, string>): Record<string, string> {
  return authUserHeaders({
    'Accept-Language': resolveAcceptLanguageHeader(),
    ...headers,
  })
}

async function fetch(
  url: string,
  options?: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<any> {
  try {
    const data = await $fetch<any>(resolveUrl(url), {
      ...options,
      headers: withLanguageHeaders(headers),
      timeout: REQUEST_TIMEOUT,
    })
    if (data && data.success === false)
      handleTeamForbidden(data)
    return wrapIfUnauthorized(data)
  }
  catch (error: unknown) {
    const err = error as { statusCode?: number, status?: number, data?: any, message?: string }
    const body = err?.data && typeof err.data === 'object'
      ? err.data as Record<string, unknown>
      : null
    const normalized = normalizeFetchErrorBody(error, body)
    if (isSessionExpiredResponse(normalized))
      return wrapIfUnauthorized(normalized)
    return normalized
  }
}

export default new class Http {
  get(url: string, params?: Record<string, unknown>, headers?: Record<string, string>) {
    return fetch(url, { method: 'GET', params }, headers)
  }

  post(url: string, data?: unknown, headers?: Record<string, string>, params?: Record<string, unknown>) {
    return fetch(url, { method: 'POST', body: data, params }, headers)
  }

  put(url: string, data?: unknown, headers?: Record<string, string>) {
    return fetch(url, { method: 'PUT', body: data }, headers)
  }

  delete(url: string, data?: unknown, headers?: Record<string, string>) {
    return fetch(url, { method: 'DELETE', body: data }, headers)
  }
}()
