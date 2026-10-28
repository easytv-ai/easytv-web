/** OAuth 请求：走 NUXT_PUBLIC_API_BASE_URL，携带 credentials 以兼容 session state 校验 */

function normalizeOrigin(raw: string): string {
  const s = String(raw ?? '').trim().replace(/\/$/, '')
  if (!s)
    return ''
  if (/^https?:\/\//i.test(s))
    return s
  return `http://${s}`
}

function resolveOAuthUrl(url: string): string {
  if (/^https?:\/\//i.test(url))
    return url
  const base = normalizeOrigin(useRuntimeConfig().public.apiBaseUrl as string)
  return `${base}${url.startsWith('/') ? url : `/${url}`}`
}

export async function oauthFetch<T = any>(
  url: string,
  options?: {
    method?: string
    params?: Record<string, unknown>
    body?: unknown
  },
): Promise<T> {
  try {
    // $fetch 的类型化路由推断在这里会「过深」，按普通 fetch 签名调用
    const plainFetch = $fetch as unknown as (input: string, init?: Record<string, unknown>) => Promise<unknown>
    return (await plainFetch(resolveOAuthUrl(url), {
      method: (options?.method ?? 'GET') as 'GET',
      params: options?.params,
      ...(options?.body !== undefined ? { body: options.body as BodyInit } : {}),
      credentials: 'include',
    })) as T
  }
  catch (error: unknown) {
    const err = error as { data?: T, message?: string }
    if (err?.data && typeof err.data === 'object')
      return err.data
    return { success: false, message: err?.message || '网络请求失败' } as T
  }
}
