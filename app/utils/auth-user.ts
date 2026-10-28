import { parseStoredAuthUser } from '~/utils/auth-login-parse'
import { getDeviceId } from '~/utils/device-id'
import { readWorkspaceTeamId } from '~/utils/workspace'

export const AUTH_USER_STORAGE_KEY = 'easyapi_auth_user'
export const AUTH_EXPIRED_STORAGE_KEY = 'easyapi_auth_expired'

function readAuthUser() {
  if (!import.meta.client)
    return null
  const parsed = parseStoredAuthUser(localStorage.getItem(AUTH_USER_STORAGE_KEY))
  if (!parsed)
    return null
  return parsed
}

/** 后端要求的用户标识：已登录用用户 id，未登录固定为 -1 */
export function getUserId(): string {
  const user = readAuthUser()
  const id = user?.id ?? user?.user_id
  if (id != null && id !== '')
    return String(id)
  return '-1'
}

export function getAccessToken(): string {
  const user = readAuthUser()
  return String(user?.access_token ?? user?.token ?? '').trim()
}

export function authUserHeaders(
  extra?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {
    'EasyTV-User': getUserId(),
    ...extra,
  }
  // 设备指纹只在客户端有；后端用它防刷（API.md 第 7 节）
  if (import.meta.client) {
    const deviceId = getDeviceId()
    if (deviceId)
      headers['EasyTV-Device'] = deviceId
  }
  const accessToken = getAccessToken()
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`
    // 团队空间：后端按这个头切换数据与扣费范围（API.md 20）
    const teamId = readWorkspaceTeamId()
    if (teamId > 0)
      headers['EasyTV-Team'] = String(teamId)
  }
  return headers
}
