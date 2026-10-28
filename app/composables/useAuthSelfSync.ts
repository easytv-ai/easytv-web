import { useAuth } from '~/composables/useAuth'
import type { AuthUser } from '~/utils/auth-login-parse'
import userManagement from '~/api/user-management'
import { getAccessToken } from '~/utils/auth-user'
import { isSessionExpiredResponse } from '~/utils/auth-session-expired'
import { readSettingAvatar } from '~/utils/user-setting'

/** 与密码登录一致，仅持久化这些字段到 easyapi_auth_user */
const AUTH_USER_PERSIST_FIELDS = [
  'id',
  'username',
  'nickname',
  'avatar',
  'group',
  'role',
  'status',
  'access_token',
  'token',
] as const

function pickAuthUserFields(
  profile: Record<string, unknown>,
  accessToken: string,
): AuthUser {
  const picked = {} as AuthUser
  for (const key of AUTH_USER_PERSIST_FIELDS) {
    if (key === 'access_token' || key === 'token')
      continue
    const value = profile[key]
    if (value != null && value !== '')
      (picked as Record<string, unknown>)[key] = value
  }
  picked.username = String(profile.username ?? picked.username ?? '')
  if (accessToken) {
    picked.access_token = accessToken
    picked.token = accessToken
  }
  return picked
}

/** 从 GET /api/user/self 响应解析用户对象 */
export function parseUserFromSelfResponse(res: any): Record<string, unknown> | null {
  if (res == null || typeof res !== 'object')
    return null
  if (res.success === false)
    return null
  const raw = res.data ?? res.content ?? res
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const profile = raw as Record<string, unknown>
    if (profile.id != null || profile.username != null || profile.nickname != null)
      return profile
  }
  return null
}

/** 从 GET /api/user/self 响应解析邮箱 */
export function parseEmailFromSelfResponse(res: any): string {
  return String(parseUserFromSelfResponse(res)?.email ?? '').trim()
}

function mergeAuthUserWithSelfProfile(
  authUser: AuthUser,
  selfProfile: Record<string, unknown>,
): AuthUser {
  const accessToken = String(authUser.access_token ?? authUser.token ?? '').trim()
  const id = selfProfile.id ?? authUser.id ?? authUser.user_id
  const avatar = readSettingAvatar(selfProfile.setting, String(selfProfile.avatar ?? authUser.avatar ?? ''))
  const merged = pickAuthUserFields(
    { ...selfProfile, id, avatar },
    accessToken,
  )
  // 后台「进入控制台」代登的会话标记要保留：退出时据此只清本地、不作废用户本人的令牌
  if (authUser.console_access)
    merged.console_access = true
  return merged
}

/** 用 self 接口补全登录态（ticket 兑换等场景下 exchange 仅返回 token + user_id） */
export async function hydrateAuthUserFromSelf(): Promise<boolean> {
  if (!import.meta.client)
    return false
  const { user, setUser, isLoggedIn } = useAuth()
  if (!isLoggedIn.value && !user.value)
    return false

  const current = user.value
  if (current && current.id == null && current.user_id != null)
    setUser({ ...current, id: current.user_id })

  try {
    const res = await userManagement.self()
    const profile = parseUserFromSelfResponse(res)
    if (!profile)
      return false
    const base = user.value ?? { username: '' }
    const email = parseEmailFromSelfResponse(res)
    setUser({
      ...mergeAuthUserWithSelfProfile(base, profile),
      has_password: parseHasPasswordFromProfile(profile),
      ...(email ? { email } : {}),
    })
    return true
  }
  catch {
    return false
  }
}

/** 从 self 用户对象解析是否已设置登录密码 */
export function parseHasPasswordFromProfile(profile: Record<string, unknown> | null | undefined): boolean {
  if (!profile)
    return false
  const raw = profile.has_password
  if (raw === true || raw === 1)
    return true
  if (raw === false || raw === 0)
    return false
  return Boolean(raw)
}

/** 从 GET /api/user/self 响应解析是否已设置登录密码 */
export function parseHasPasswordFromSelfResponse(res: any): boolean {
  return parseHasPasswordFromProfile(parseUserFromSelfResponse(res))
}

/** 用 self 接口回填登录态中的邮箱与密码状态（OAuth 登录响应可能不含这些字段） */
export async function refreshAuthUserEmailFromSelf(): Promise<void> {
  if (!import.meta.client)
    return
  const { user, setUser, isLoggedIn } = useAuth()
  if (!isLoggedIn.value || !getAccessToken())
    return
  try {
    const res = await userManagement.self()
    if ((res as Record<string, unknown>)?.unauthorized || isSessionExpiredResponse(res))
      return
    const profile = parseUserFromSelfResponse(res)
    if (!profile || !user.value)
      return
    const patch: Record<string, unknown> = {
      has_password: parseHasPasswordFromSelfResponse(res),
    }
    const email = parseEmailFromSelfResponse(res)
    if (email)
      patch.email = email
    setUser({ ...user.value, ...patch })
  }
  catch {
    // 忽略：弹窗逻辑在同步失败时仍可按本地会话判断
  }
}
