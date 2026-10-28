import http from '~/api/http'
import type { ApiResponse, Campaign, CampaignEntry, PageQuery, Paged } from '~/types/creative'

/** 投稿墙排序：最热（按点赞快照）/ 最新 / 名次（发奖后） */
export type CampaignEntrySort = 'likes' | 'new' | 'rank'

/** 活动中心（API.md 8.6，M10） */
export const campaignApi = {
  /** 进行中 + 最近 3 个已结束 / 已发奖；草稿不会返回 */
  list(): Promise<ApiResponse<Campaign[]>> {
    return http.get('/campaign')
  },

  /** 详情；带登录态时附 my_entry（没投过是 null） */
  detail(slug: string): Promise<ApiResponse<Campaign>> {
    return http.get(`/campaign/${encodeURIComponent(slug)}`)
  },

  /** 已通过的投稿墙；sort 不传时进行中按 likes、已发奖按 rank */
  entries(slug: string, query: PageQuery & { sort?: CampaignEntrySort } = {}): Promise<ApiResponse<Paged<CampaignEntry>>> {
    return http.get(`/campaign/${encodeURIComponent(slug)}/entries`, query)
  },

  /** 用已发布的作品投稿，一个作品对一个活动只能投一次 */
  enter(workId: number, campaignId: number): Promise<ApiResponse<CampaignEntry>> {
    return http.post(`/user/work/${workId}/enter`, { campaign_id: campaignId })
  },
}

export default campaignApi
