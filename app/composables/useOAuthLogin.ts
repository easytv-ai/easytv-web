import type { AuthUser } from '~/utils/auth-login-parse'
import { oauthFetch } from '@/utils/oauth-fetch'

/** 中间件 / 插件也会调用，不能直接 useI18n() */
function tOauth(key: string): string {
  try {
    const nuxtApp = tryUseNuxtApp()
    const i18n = nuxtApp?.$i18n as { t?: (k: string) => unknown } | undefined
    if (typeof i18n?.t === 'function')
      return String(i18n.t(key))
  }
  catch {
    // 无 Nuxt 上下文时回退原文
  }
  return key
}

function userFromOAuthResponse(res: any): AuthUser | null {
  const data = (res?.data ?? res?.content) as Record<string, unknown> | undefined
  if (!data)
    return null
  const accessToken = String(data.access_token ?? data.token ?? '').trim()
  if (!accessToken)
    return null
  return {
    ...data,
    username: String(data.username ?? ''),
    access_token: accessToken,
    token: accessToken,
  }
}

/** 只负责授权回跳后的换票。发起跳转由微信扫码面板自己完成。 */
export function useOAuthLogin() {
  async function completeOAuthLogin(
    provider: string,
    code: string,
    state: string,
  ): Promise<{ ok: true, user: AuthUser } | { ok: false, message?: string }> {
    const res = await oauthFetch(`/oauth/${encodeURIComponent(provider)}`, {
      params: { code, state },
    })
    if (!res?.success) {
      return { ok: false, message: String(res?.message ?? tOauth('第三方登录失败')) }
    }
    const user = userFromOAuthResponse(res)
    if (!user?.access_token)
      return { ok: false, message: tOauth('未获取到登录凭证') }
    return { ok: true, user }
  }

  return { completeOAuthLogin }
}
