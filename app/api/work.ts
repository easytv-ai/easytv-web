import http from '~/api/http'
import type { ApiResponse, AuthorProfile, PageQuery, Paged, Work, WorkComment, WorkProcess, WorkStatus, ClonePreview } from '~/types/creative'

/** 作品：API.md 1.5 / 2.1 / 2.2 */
export const workApi = {
  /** 公开信息流（已发布） */
  /** lang：按作品语言过滤（F6，API.md 10.7），如 zh / en */
  feed(query: PageQuery & { keyword?: string, category?: string, user_id?: number, featured?: 1, lang?: string } = {}): Promise<ApiResponse<Paged<Work>>> {
    return http.get('/work', query)
  },

  /** 公开详情，浏览数 +1 */
  detail(id: number): Promise<ApiResponse<Work>> {
    return http.get(`/work/${id}`)
  },

  mine(query: PageQuery & { status?: WorkStatus, keyword?: string } = {}): Promise<ApiResponse<Paged<Work>>> {
    return http.get('/user/work', query)
  },

  /** 从视频资产发布 */
  publish(data: { title: string, description?: string, category?: string, asset_id: number, project_id?: number, canvas_id?: number, cover_url?: string, show_process?: boolean, source_canvas_id?: number, source_skill_id?: number, open_source?: 0 | 1, lang?: string }): Promise<ApiResponse<Work>> {
    return http.post('/user/work', data)
  },

  update(id: number, data: { title?: string, description?: string, cover_url?: string, category?: string, status?: 1 | 2, show_process?: boolean, source_canvas_id?: number, source_skill_id?: number, open_source?: 0 | 1 }): Promise<ApiResponse<null>> {
    return http.put(`/user/work/${id}`, data)
  },

  /** 做同款：把开源作品的来源画布复制成我的新项目（API.md 7.3）；非开源时 success=false */
  /** 做同款预览：用到的模型与现状、预计积分、需要重新选的参考素材（API.md 14.3） */
  clonePreview(id: number): Promise<ApiResponse<ClonePreview>> {
    return http.get(`/work/${id}/clone-preview`)
  },

  clone(id: number): Promise<ApiResponse<{ canvas_id: number, project_id: number }>> {
    return http.post(`/user/work/${id}/clone`)
  },

  remove(id: number): Promise<ApiResponse<null>> {
    return http.delete(`/user/work/${id}`)
  },

  /** 点赞 / 取消点赞（切换） */
  like(id: number): Promise<ApiResponse<{ liked: boolean, like_count: number }>> {
    return http.post(`/user/work/${id}/like`)
  },

  /** 作者主页（匿名） */
  author(id: number): Promise<ApiResponse<AuthorProfile>> {
    return http.get(`/author/${id}`)
  },

  /** 制作过程（作者公开时）：发布时所在画布的节点与连线 */
  process(id: number): Promise<ApiResponse<WorkProcess>> {
    return http.get(`/work/${id}/process`)
  },

  /** 评论列表：一级评论分页，每条附最多 3 条回复 */
  comments(id: number, query: PageQuery = {}): Promise<ApiResponse<Paged<WorkComment>>> {
    return http.get(`/work/${id}/comments`, query)
  },

  /** 某条评论的全部回复 */
  replies(commentId: number, query: PageQuery = {}): Promise<ApiResponse<Paged<WorkComment>>> {
    return http.get(`/comment/${commentId}/replies`, query)
  },

  /** 发表评论 / 回复 */
  comment(id: number, data: { content: string, parent_id?: number }): Promise<ApiResponse<WorkComment>> {
    return http.post(`/user/work/${id}/comment`, data)
  },

  /** 删除评论（本人或作品作者） */
  removeComment(commentId: number): Promise<ApiResponse<null>> {
    return http.delete(`/user/comment/${commentId}`)
  },

  /** 举报评论 */
  reportComment(commentId: number, data: { reason: string, content?: string }): Promise<ApiResponse<{ id: number }>> {
    return http.post(`/user/comment/${commentId}/report`, data)
  },

  /** 举报作品（API.md 1.8） */
  report(id: number, data: { reason: string, content?: string }): Promise<ApiResponse<{ id: number }>> {
    return http.post(`/user/work/${id}/report`, data)
  },
}

export default workApi
