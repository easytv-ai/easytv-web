import http from '~/api/http'
import type { ApiResponse, Partner, PartnerApplyBody, PartnerDashboard, PartnerLanding } from '~/types/creative'

/** 渠道伙伴计划（API.md 9.3，M12） */
export const partnerApi = {
  /** 申请入驻；已申请过返回当前那一行（可用于「重新申请」） */
  apply(body: PartnerApplyBody): Promise<ApiResponse<Partner>> {
    return http.post('/user/partner/apply', body)
  },

  /** 我的伙伴看板；从未申请过 data 为 null */
  me(): Promise<ApiResponse<PartnerDashboard | null>> {
    return http.get('/user/partner/me')
  },

  /** 落地页数据（公开）；无效码 success=false */
  landing(code: string): Promise<ApiResponse<PartnerLanding>> {
    return http.get(`/partner/${encodeURIComponent(code)}`)
  },
}

export default partnerApi
