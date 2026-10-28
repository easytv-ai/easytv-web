import http from '~/api/http'

export const userManagement = {
  /**
   * 获取当前登录用户信息
   */
  self(params?: Record<string, unknown>): Promise<any> {
    return http.get('/user/self', params ?? {})
  },

  /** 绑定 / 换绑手机号：POST /user/self/mobile */
  bindMobile(data: { mobile: string, code: string }): Promise<any> {
    return http.post('/user/self/mobile', data)
  },

  /**
   * 更新当前登录用户资料（nickname / username / 密码等）
   * 注意：PUT /api/user/ 是管理员接口，普通用户请用本接口
   */
  update(data: any): Promise<any> {
    return http.put('/user/self', data)
  },
}

export default userManagement
