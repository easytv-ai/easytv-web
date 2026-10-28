import http from '~/api/http'

/** 邮箱验证码用途：v=注册 r=重置密码 b=微信绑定邮箱 */
export type VerificationAction = 'v' | 'r' | 'b'

export interface SendEmailVerificationParams {
  email: string
  action: VerificationAction
}

export interface SendSmsVerificationParams {
  mobile: string
}

export interface SmsLoginParams {
  mobile: string
  code: string
}

export const VERIFICATION_ACTION = {
  register: 'v',
  resetPassword: 'r',
  wechatBindEmail: 'b',
} as const satisfies Record<string, VerificationAction>

export const userAuth = {
  /**
   * 用户登录
   */
  login(data: any): Promise<any> {
    return http.post('/user/login', data, {})
  },

  /**
   * 后台生成的控制台访问 ticket 兑换登录态
   */
  consoleAccessExchange(data: { ticket: string }): Promise<any> {
    return http.post('/user/console_access/exchange', data, {})
  },

  /**
   * 用户登出
   */
  logout(): Promise<any> {
    return http.get('/user/logout', {})
  },

  /**
   * 用户注册
   */
  register(data: any): Promise<any> {
    return http.post('/user/register', data, {})
  },

  /**
   * 重置密码
   */
  reset(data: any): Promise<any> {
    return http.post('/user/reset', data, {})
  },

  /**
   * 发送邮箱验证码
   * @param params.email 目标邮箱
   * @param params.action v=注册 r=重置密码 b=微信绑定邮箱
   */
  sendEmailVerification(params: SendEmailVerificationParams): Promise<any> {
    return http.get('/verification', { ...params })
  },

  /**
   * 发送短信验证码（登录）
   * GET /sms/verification?mobile=
   */
  sendSmsVerification(params: SendSmsVerificationParams): Promise<any> {
    return http.get('/sms/verification', { mobile: params.mobile })
  },

  /**
   * 手机号验证码登录（未注册会自动开户）
   * POST /user/sms_login
   */
  smsLogin(data: SmsLoginParams): Promise<any> {
    return http.post('/user/sms_login', data, {})
  },
}

export default userAuth
