import http from '~/api/http'
import type { ApiResponse, UgcList, UgcPlatform, UgcSubmission } from '~/types/creative'

export type UgcSubmitPayload = {
  platform: UgcPlatform
  url: string
  /** 关联站内作品，可不传 */
  work_id?: number
}

/** 站外投稿 / 创作伙伴计划（API.md 8.5） */
export const ugcApi = {
  /** 提交站外链接：同 url 只能一次，每月条数受 growth.ugc_monthly_entries 限制 */
  submit(body: UgcSubmitPayload): Promise<ApiResponse<UgcSubmission | null>> {
    return http.post('/user/ugc', body)
  },

  /** 我的投稿与状态，附本月已得积分 / 上限 */
  list(): Promise<ApiResponse<UgcList>> {
    return http.get('/user/ugc')
  },
}

export default ugcApi
