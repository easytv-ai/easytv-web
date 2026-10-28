/**
 * 登录响应怎么认成功、token 落在哪一层。
 * 接口同时出现过 content / data、access_token / token / id_token，解析错了页面会显示已登录，后续请求却是 401。
 */

export interface AuthUser {
  username: string
  nickname?: string
  email?: string
  /** GET /api/user/self → has_password */
  has_password?: boolean
  access_token?: string
  token?: string
  [key: string]: unknown
}

export function isLoginApiSuccess(res: { success?: unknown } | null | undefined) {
  return res?.success === true
}

/** 业务失败或 HTTP 4xx/5xx。null 不算失败，交给调用方看 success。 */
export function isApiFailure(res: { error?: unknown, statusCode?: unknown, success?: unknown } | null | undefined) {
  if (res == null)
    return false
  if (res.error === true)
    return true
  if (typeof res.statusCode === 'number' && res.statusCode >= 400)
    return true
  if (res.success === false)
    return true
  return false
}

export function userFromLoginResponse(res: any, fallbackUsername: string): AuthUser {
  const data = (res?.content ?? res?.data) as Record<string, unknown> | undefined
  const nested = (data?.user ?? data) as Record<string, unknown> | undefined
  const authUser: AuthUser = {
    ...(nested ?? {}),
    username: String(
      nested?.username ?? res?.username ?? data?.username ?? fallbackUsername,
    ),
  }
  const accessToken = String(
    nested?.access_token
    ?? data?.access_token
    ?? res?.token
    ?? data?.token
    ?? data?.id_token
    ?? data?.accessToken
    ?? '',
  ).trim() || undefined
  if (accessToken) {
    authUser.access_token = accessToken
    authUser.token = accessToken
  }
  else {
    delete authUser.access_token
    delete authUser.token
  }
  const userId = nested?.id ?? nested?.user_id ?? data?.id ?? data?.user_id
  if (userId != null && userId !== '')
    authUser.id = userId
  return authUser
}

/** localStorage 里的登录信息。坏 JSON、空串、非对象都当成未登录，调用方应清掉这段存储。 */
export function parseStoredAuthUser(raw: string | null | undefined): AuthUser | null {
  if (!raw)
    return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return null
    return parsed as AuthUser
  }
  catch {
    return null
  }
}
