import http from '~/api/http'
import type {
  ApiResponse,
  PageQuery,
  Paged,
  RechargeInfo,
  RechargePayRequest,
  RechargePayResult,
  RechargeRecord,
} from '~/types/creative'

/** 旧充值通道：配置 / 下单 / 查单 / 记录（API.md 6.2 补充） */
export const rechargeApi = {
  /** 充值页配置：面额、最低金额、可用支付方式 */
  info(): Promise<ApiResponse<RechargeInfo>> {
    return http.get('/user/recharge/info')
  },

  /** 我的充值记录 */
  list(query: PageQuery = {}): Promise<ApiResponse<Paged<RechargeRecord>>> {
    return http.get('/user/recharge/self', query)
  },

  /**
   * 统一充值下单。
   * 微信 / 当面付返回二维码；电脑网站支付返回 payment_url。
   * team_id>0 为团队充值，须为该团队 owner。
   */
  pay(data: RechargePayRequest): Promise<ApiResponse<RechargePayResult>> {
    return http.post('/user/pay', data)
  },

  /**
   * 主动查单（防 webhook 漏单）。
   * 已支付则补入账，返回 success；否则 pending。
   */
  status(tradeNo: string): Promise<ApiResponse<{ status: 'success' | 'pending' }>> {
    return http.post('/user/recharge/status', { trade_no: tradeNo })
  },
}

export default rechargeApi
