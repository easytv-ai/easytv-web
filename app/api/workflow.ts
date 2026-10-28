import http from '~/api/http'
import type { ApiResponse, PageQuery, Paged } from '~/types/creative'
import type { CanvasWorkflowGraph } from '~/utils/canvas-workflow'

export type CanvasWorkflow = {
  id: number
  name: string
  cover_url: string
  node_count: number
  edge_count: number
  uses: number
  mine?: boolean
  created_at: number
  updated_at: number
  /** 只有详情接口带 */
  graph?: CanvasWorkflowGraph
}

/** 工作流模板：API.md 31.1 */
export const workflowApi = {
  list(query: PageQuery & { keyword?: string } = {}): Promise<ApiResponse<Paged<CanvasWorkflow>>> {
    return http.get('/user/workflow', query)
  },

  /** 带 graph，同时把使用次数 +1 */
  detail(id: number): Promise<ApiResponse<CanvasWorkflow>> {
    return http.get(`/user/workflow/${id}`)
  },

  create(body: { name: string, cover_url?: string, graph: CanvasWorkflowGraph }): Promise<ApiResponse<CanvasWorkflow>> {
    return http.post('/user/workflow', body)
  },

  update(id: number, body: { name?: string, cover_url?: string }): Promise<ApiResponse<CanvasWorkflow>> {
    return http.put(`/user/workflow/${id}`, body)
  },

  remove(id: number): Promise<ApiResponse<null>> {
    return http.delete(`/user/workflow/${id}`)
  },
}

export default workflowApi
