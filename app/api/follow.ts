import http from '~/api/http'
import type { ApiResponse, FollowToggleResult, FollowedAuthor, PageQuery, Paged, Work } from '~/types/creative'

/** 关注（API.md 9.2） */
export const followApi = {
  /** 关注 / 取关同一个接口幂等切换；关注自己返回「不能关注自己」 */
  /** workId 只在播放页关注时传。作者页、榜单、关注列表不传，服务端就不会把这次关注记到某一条片子上。 */
  toggle(authorId: number, workId = 0): Promise<ApiResponse<FollowToggleResult>> {
    return http.post(`/user/author/${authorId}/follow`, workId > 0 ? { work_id: workId } : undefined)
  },

  /** 我关注的作者的作品流（已发布，按发布时间倒序） */
  following(query: PageQuery = {}): Promise<ApiResponse<Paged<Work>>> {
    return http.get('/user/following', query)
  },

  /** 我关注的作者列表 */
  authors(query: PageQuery = {}): Promise<ApiResponse<Paged<FollowedAuthor>>> {
    return http.get('/user/follow/authors', query)
  },
}

export default followApi
