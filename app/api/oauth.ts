import http from '~/api/http'

export const oauth = {
  /**
   * Discord OAuth 登录
   */
  discord(params?: Record<string, unknown>): Promise<any> {
    return http.get('/oauth/discord', params ?? {})
  },

  /**
   * GitHub OAuth 登录
   */
  github(params?: Record<string, unknown>): Promise<any> {
    return http.get('/oauth/github', params ?? {})
  },

  /**
   * LinuxDO OAuth 登录
   */
  linuxdo(params?: Record<string, unknown>): Promise<any> {
    return http.get('/oauth/linuxdo', params ?? {})
  },

  /**
   * OIDC 登录
   */
  oidc(params?: Record<string, unknown>): Promise<any> {
    return http.get('/oauth/oidc', params ?? {})
  },

  /**
   * 生成 OAuth State（防 CSRF）
   */
  state(params?: Record<string, unknown>): Promise<any> {
    return http.get('/oauth/state', params ?? {})
  },

  /**
   * 绑定 Telegram
   */
  bindTelegram(params?: Record<string, unknown>): Promise<any> {
    return http.get('/oauth/telegram/bind', params ?? {})
  },

  /**
   * Telegram 登录
   */
  telegramLogin(params?: Record<string, unknown>): Promise<any> {
    return http.get('/oauth/telegram/login', params ?? {})
  },

  /**
   * 绑定微信
   */
  bindWechat(params?: Record<string, unknown>): Promise<any> {
    return http.get('/oauth/wechat/bind', params ?? {})
  },

  /**
   * 微信 OAuth 登录
   */
  wechat(params?: Record<string, unknown>): Promise<any> {
    return http.get('/oauth/wechat', params ?? {})
  },

  /**
   * 微信开放平台扫码登录：获取 state / auth_url 等预授权信息
   * redirect_url 走 query：POST /wechat/oauth/preauth?redirect_url=...
   */
  wechatOAuthPreauth(params?: { redirect_url?: string }): Promise<any> {
    const redirectUrl = String(params?.redirect_url ?? '').trim()
    const query = redirectUrl ? { redirect_url: redirectUrl } : undefined
    return http.post('/wechat/oauth/preauth', undefined, undefined, query)
  },

  /**
   * 微信扫码登录结果轮询（evidence 为 preauth 返回的 state）
   */
  wechatOAuthLoginStatus(params: { evidence: string }): Promise<any> {
    return http.get('/wechat/oauth/login-status', params)
  },
}

export default oauth
