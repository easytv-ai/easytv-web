import http from '~/api/http'
import type { ApiResponse, InviteInfo, InviteSummary } from '~/types/creative'

/** 邀请有礼：API.md 7.2 / 7.3 */
export const inviteApi = {
  /** 邀请码解析（匿名）；不存在时 success=false */
  resolve(code: string): Promise<ApiResponse<InviteInfo>> {
    return http.get(`/invite/${encodeURIComponent(code)}`)
  },

  /** 我的邀请总览：邀请码、链接、统计、规则值、最近 20 条记录 */
  summary(): Promise<ApiResponse<InviteSummary>> {
    return http.get('/user/invite/summary')
  },

  /** 邀请记录分页：GET /user/invite/records */
  records(query: { keyword?: string, page?: number, page_size?: number } = {}) {
    const params: Record<string, unknown> = {
      page: query.page,
      page_size: query.page_size,
    }
    if (query.keyword)
      params.keyword = query.keyword
    return http.get('/user/invite/records', params)
  },

  /** 推广返利流水：GET /user/bills/self?biz_type=1,2,6 */
  bills(query: { page?: number, page_size?: number } = {}) {
    return http.get('/user/bills/self', { biz_type: '1,2,6', ...query })
  },
}

export default inviteApi
