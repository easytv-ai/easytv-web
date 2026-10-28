import http from '~/api/http'

export const system = {
  /**
   * 获取关于信息
   */
  about(params?: Record<string, unknown>): Promise<any> {
    return http.get('/about', params ?? {})
  },

  /**
   * 获取首页内容
   */
  homePageContent(params?: Record<string, unknown>): Promise<any> {
    return http.get('/home_page_content', params ?? {})
  },

  /**
   * 获取模型列表
   */
  models(params?: Record<string, unknown>): Promise<any> {
    return http.get('/models', params ?? {})
  },

  /**
   * 获取公告
   */
  notice(params?: Record<string, unknown>): Promise<any> {
    return http.get('/notice', params ?? {})
  },

  /**
   * 获取定价信息
   */
  pricing(params?: Record<string, unknown>): Promise<any> {
    return http.get('/pricing', params ?? {})
  },

  /**
   * 首页热门模型排行（近 7 天调用量）
   */
  hotModels(params?: Record<string, unknown>): Promise<any> {
    return http.get('/hot-models', params ?? {})
  },

  /**
   * 获取隐私政策
   */
  privacyPolicy(params?: Record<string, unknown>): Promise<any> {
    return http.get('/privacy-policy', params ?? {})
  },

  /**
   * 获取倍率配置
   */
  ratioConfig(params?: Record<string, unknown>): Promise<any> {
    return http.get('/ratio_config', params ?? {})
  },

  /**
   * 测试系统状态（管理员）
   */
  statusTest(params?: Record<string, unknown>): Promise<any> {
    return http.get('/status/test', params ?? {})
  },

  /**
   * 获取 Uptime Kuma 状态
   */
  uptimeStatus(params?: Record<string, unknown>): Promise<any> {
    return http.get('/uptime/status', params ?? {})
  },

  /**
   * 获取用户协议
   */
  userAgreement(params?: Record<string, unknown>): Promise<any> {
    return http.get('/user-agreement', params ?? {})
  },
}

export default system
