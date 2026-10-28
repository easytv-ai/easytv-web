import http from '~/api/http'
import type { ApiResponse, FollowToggleResult, FollowedAuthor, PageQuery, Paged, Work } from '~/types/creative'

/** 关注（API.md 9.2，M11） */
export const followApi = {
  /** 关注 / 取关同一个接口幂等切换；关注自己返回「不能关注自己」 */
  toggle(authorId: number): Promise<ApiResponse<FollowToggleResult>> {
    return http.post(`/user/author/${authorId}/follow`)
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
