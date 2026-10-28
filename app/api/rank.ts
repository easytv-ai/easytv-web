import http from '~/api/http'
import type { ApiResponse, RankAuthors, RankPeriod, RankSkills, RankWorks } from '~/types/creative'

/** 榜单（API.md 9.2，M11）：公开，前 20 条 */
export const rankApi = {
  /** 作品榜：窗口内点赞数排序，同分看浏览数 */
  works(period: RankPeriod = 'week'): Promise<ApiResponse<RankWorks>> {
    return http.get('/rank/works', { period })
  },

  /** 作者榜：窗口内被赞数排序 */
  authors(period: RankPeriod = 'week'): Promise<ApiResponse<RankAuthors>> {
    return http.get('/rank/authors', { period })
  },

  /** 技能榜：窗口内调用数 + 收藏数 */
  skills(period: RankPeriod = 'week'): Promise<ApiResponse<RankSkills>> {
    return http.get('/rank/skills', { period })
  },
}

export default rankApi
