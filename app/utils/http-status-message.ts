/**
 * HTTP 状态码 → 用户可读提示。
 * 接口有返回 message 时优先用 message；仅有状态码（429/502 等）时用此映射。
 */

/** i18n 键，供 useApiMessage / t() 使用 */
export const HTTP_STATUS_I18N_KEY: Record<number, string> = {
  400: 'http.status.400',
  401: 'http.status.401',
  403: 'http.status.403',
  404: 'http.status.404',
  408: 'http.status.408',
  409: 'http.status.409',
  413: 'http.status.413',
  422: 'http.status.422',
  429: 'http.status.429',
  500: 'http.status.500',
  502: 'http.status.502',
  503: 'http.status.503',
  504: 'http.status.504',
}

/** 无 i18n 时的中文兜底（http 层、非组件上下文） */
export const HTTP_STATUS_MESSAGES_ZH: Record<number, string> = {
  400: '请求参数有误，请检查后重试',
  401: '未登录或登录已失效，请重新登录',
  403: '没有权限执行此操作',
  404: '请求的资源不存在',
  408: '请求超时，请稍后重试',
  409: '请求冲突，请刷新后重试',
  413: '请求内容过大',
  422: '提交的数据无法处理，请检查后重试',
  429: '请求过于频繁，请稍后再试',
  500: '服务器内部错误，请稍后重试',
  502: '网关错误，服务暂时不可用',
  503: '服务维护中，请稍后重试',
  504: '网关超时，请稍后重试',
}

const NETWORK_FALLBACK_ZH = '网络连接失败，请检查网络后重试'
const UNKNOWN_FALLBACK_ZH = '请求失败，请稍后重试'

function pickNonEmptyString(value: unknown): string {
  const s = String(value ?? '').trim()
  if (!s || s === 'undefined' || s === 'null')
    return ''
  return s
}

/** $fetch / ofetch 抛错时的通用英文文案，不应直接展示给用户 */
export function isGenericFetchErrorMessage(message: string): boolean {
  const msg = message.trim()
  if (!msg)
    return true
  if (/^\[(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\]/i.test(msg))
    return true
  if (/^fetch failed/i.test(msg))
    return true
  if (/failed to fetch/i.test(msg))
    return true
  if (/network error/i.test(msg))
    return true
  if (/timeout/i.test(msg) && msg.length < 80)
    return true
  return false
}

export function getHttpStatusI18nKey(statusCode?: number | null): string {
  if (statusCode == null || statusCode <= 0)
    return 'http.status.network'
  if (HTTP_STATUS_I18N_KEY[statusCode])
    return HTTP_STATUS_I18N_KEY[statusCode]
  if (statusCode >= 500)
    return 'http.status.5xx'
  if (statusCode >= 400)
    return 'http.status.4xx'
  return 'http.status.unknown'
}

/** 根据 HTTP 状态码取中文提示（http.ts 等无 i18n 上下文） */
export function getHttpStatusMessage(statusCode?: number | null): string {
  if (statusCode == null || statusCode <= 0)
    return NETWORK_FALLBACK_ZH
  if (HTTP_STATUS_MESSAGES_ZH[statusCode])
    return HTTP_STATUS_MESSAGES_ZH[statusCode]
  if (statusCode >= 500)
    return HTTP_STATUS_MESSAGES_ZH[500] ?? UNKNOWN_FALLBACK_ZH
  if (statusCode >= 400)
    return HTTP_STATUS_MESSAGES_ZH[400] ?? UNKNOWN_FALLBACK_ZH
  return UNKNOWN_FALLBACK_ZH
}

export interface ResolveApiMessageOptions {
  statusCode?: number | null
  fallback?: string
}

/**
 * 解析接口提示文案：优先 body.message / statusMessage，否则按 HTTP 状态码映射。
 */
export function resolveApiMessage(
  res: unknown,
  options?: ResolveApiMessageOptions,
): string {
  const body = res && typeof res === 'object'
    ? res as Record<string, unknown>
    : null

  const fromBody = pickNonEmptyString(body?.message)
    || pickNonEmptyString(body?.statusMessage)
  if (fromBody)
    return fromBody

  const statusCode = options?.statusCode
    ?? (typeof body?.statusCode === 'number' ? body.statusCode : undefined)
    ?? (typeof body?.status === 'number' ? body.status : undefined)

  if (statusCode != null && statusCode > 0)
    return getHttpStatusMessage(statusCode)

  return options?.fallback ?? NETWORK_FALLBACK_ZH
}

/** 从 $fetch 异常中解析 statusCode */
export function extractFetchStatusCode(error: unknown): number | undefined {
  const err = error as { statusCode?: number, status?: number, response?: { status?: number } }
  const code = err?.statusCode ?? err?.status ?? err?.response?.status
  return typeof code === 'number' && code > 0 ? code : undefined
}

/** 规范化 catch 后的错误体：保留接口 message，无 message 时补状态码映射 */
export function normalizeFetchErrorBody(
  error: unknown,
  body?: Record<string, unknown> | null,
): Record<string, unknown> {
  const statusCode = extractFetchStatusCode(error)
  const err = error as { message?: string }
  const rawErrMsg = pickNonEmptyString(err?.message)

  const base = body && typeof body === 'object' ? { ...body } : {}
  const existingMsg = pickNonEmptyString(base.message) || pickNonEmptyString(base.statusMessage)

  let message = existingMsg
  if (!message && rawErrMsg && !isGenericFetchErrorMessage(rawErrMsg))
    message = rawErrMsg
  if (!message)
    message = resolveApiMessage(base, { statusCode })

  return {
    ...base,
    success: base.success === true ? true : false,
    message,
    ...(statusCode ? { statusCode } : {}),
  }
}
