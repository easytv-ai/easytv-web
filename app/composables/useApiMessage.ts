import {
  getHttpStatusI18nKey,
} from '~/utils/http-status-message'

/**
 * 组件内解析接口提示：有 message 用 message，否则按状态码走 i18n 映射。
 */
export function useApiMessage() {
  const { t } = useI18n()

  function statusMessage(statusCode?: number | null): string {
    const key = getHttpStatusI18nKey(statusCode)
    if (key === 'http.status.unknown' && statusCode)
      return t(key, { code: statusCode })
    return t(key)
  }

  function resolve(
    res: unknown,
    options?: { statusCode?: number | null, fallback?: string },
  ): string {
    const body = res && typeof res === 'object'
      ? res as Record<string, unknown>
      : null

    const fromBody = String(body?.message ?? body?.statusMessage ?? '').trim()
    if (fromBody && fromBody !== 'undefined' && fromBody !== 'null')
      return fromBody

    const statusCode = options?.statusCode
      ?? (typeof body?.statusCode === 'number' ? body.statusCode : undefined)
      ?? (typeof body?.status === 'number' ? body.status : undefined)

    if (statusCode != null && statusCode > 0)
      return statusMessage(statusCode)

    if (options?.fallback)
      return options.fallback

    return t('http.status.network')
  }

  /** 成功/失败均可：仅当响应体带 message 时返回 */
  function peek(res: unknown): string | undefined {
    const body = res && typeof res === 'object'
      ? res as Record<string, unknown>
      : null
    const msg = String(body?.message ?? body?.statusMessage ?? '').trim()
    if (msg && msg !== 'undefined' && msg !== 'null')
      return msg
    return undefined
  }

  return {
    resolveApiMessage: resolve,
    peekApiMessage: peek,
    httpStatusMessage: statusMessage,
  }
}
