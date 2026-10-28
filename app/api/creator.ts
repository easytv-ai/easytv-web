import http from '~/api/http'
import type { ApiResponse, CreatorLeaderboard, CreatorSummary, CreatorWithdraw } from '~/types/creative'

/** 创作者中心：技能分成收益（API.md 8.3） */
export const creatorApi = {
  /** 我的技能、调用 / 收益合计、可兑换收益、最近 50 条流水 */
  summary(): Promise<ApiResponse<CreatorSummary>> {
    return http.get('/user/creator/summary')
  },

  /** 收益兑换成积分（90 天批次），返回兑换后的可兑换收益 */
  exchange(points: number): Promise<ApiResponse<{ withdrawable: number, cash_available?: number }>> {
    return http.post('/user/creator/exchange', { points })
  },

  /** 技能收益提现人民币，进入提现审核 */
  withdraw(body: { amount: number, way: string, account_info: string }): Promise<ApiResponse<{
    withdraw_no: string
    status: number
    withdrawable: number
    cash_available: number
  }>> {
    return http.post('/user/creator/withdraw', body)
  },

  /** 技能分成提现记录 */
  withdraws(page: number, pageSize: number): Promise<ApiResponse<{ items: CreatorWithdraw[], total: number }>> {
    return http.get('/user/creator/withdraws', { page, page_size: pageSize })
  },

  /** 创作者榜（公开），前 20 */
  leaderboard(period: 'week' | 'month' = 'week'): Promise<ApiResponse<CreatorLeaderboard>> {
    return http.get('/creator/leaderboard', { period })
  },
}

export default creatorApi
