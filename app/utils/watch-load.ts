/** 公开作品详情：只有明确不存在 / 已下架才离开播放页，其余失败留在本页重试。 */

const MISSING_MESSAGES = new Set(['资源不存在', '无效的作品 ID'])

export type PublicWorkLoad<T> =
  | { state: 'ok', work: T, message: '' }
  | { state: 'missing', work: null, message: string }
  | { state: 'error', work: null, message: string }

export function classifyPublicWorkResponse<T>(res: {
  success?: boolean
  data?: T | null
  message?: string
  statusCode?: number
  status?: number
} | null | undefined): PublicWorkLoad<T> {
  if (res?.success && res.data)
    return { state: 'ok', work: res.data, message: '' }
  const status = Number(res?.statusCode || res?.status || 0)
  const message = String(res?.message || '').trim()
  // 业务「不存在」走 HTTP 200 + message；真正的 404 也算下架。5xx / 超时带着状态码，不能当成下架。
  if (status === 404 || (status < 400 && MISSING_MESSAGES.has(message)))
    return { state: 'missing', work: null, message }
  return { state: 'error', work: null, message }
}
