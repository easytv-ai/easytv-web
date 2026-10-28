import http from '~/api/http'
import type { ApiResponse, CanvasSummary, PageQuery, Paged, Project, ProjectComment } from '~/types/creative'

/** 项目：API.md 2.1 */
export const projectApi = {
  /** 按当前空间列项目（EasyTV-Team 头，API.md 20.4） */
  list(query: PageQuery & { keyword?: string } = {}): Promise<ApiResponse<Paged<Project>>> {
    return http.get('/user/project', query)
  },

  /** 在个人空间与团队空间之间移动（仅作者）：team_id=0 移回个人空间 */
  move(id: number, teamId: number): Promise<ApiResponse<Project>> {
    return http.post(`/user/project/${id}/move`, { team_id: teamId })
  },

  trash(query: PageQuery = {}): Promise<ApiResponse<Paged<Project>>> {
    return http.get('/user/project/trash', query)
  },

  create(data: { name: string, description?: string }): Promise<ApiResponse<Project>> {
    return http.post('/user/project', data)
  },

  get(id: number): Promise<ApiResponse<{ project: Project, canvases: CanvasSummary[] }>> {
    return http.get(`/user/project/${id}`)
  },

  update(id: number, data: { name?: string, description?: string, cover_url?: string }): Promise<ApiResponse<null>> {
    return http.put(`/user/project/${id}`, data)
  },

  remove(id: number): Promise<ApiResponse<null>> {
    return http.delete(`/user/project/${id}`)
  },

  restore(id: number): Promise<ApiResponse<null>> {
    return http.post(`/user/project/${id}/restore`)
  },

  /**
   * 项目评论批注（API.md 10.10）：未解决的排在前面。
   * canvas_id / node_id 都不传就是项目级留言 + 节点批注全量。
   */
  comments(
    projectId: number,
    query: PageQuery & { canvas_id?: number, node_id?: string, only_open?: 1 } = {},
  ): Promise<ApiResponse<Paged<ProjectComment>>> {
    return http.get(`/user/project/${projectId}/comment`, query)
  },

  addComment(
    projectId: number,
    data: { content: string, canvas_id?: number, node_id?: string },
  ): Promise<ApiResponse<ProjectComment>> {
    return http.post(`/user/project/${projectId}/comment`, data)
  },

  /** 标记解决 / 重新打开：批注作者、项目所有者、团队 owner 可操作 */
  setCommentResolved(commentId: number, resolved: boolean): Promise<ApiResponse<null>> {
    return http.put(`/user/project/comment/${commentId}`, { resolved })
  },

  removeComment(commentId: number): Promise<ApiResponse<null>> {
    return http.delete(`/user/project/comment/${commentId}`)
  },
}

export default projectApi
