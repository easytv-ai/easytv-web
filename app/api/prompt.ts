import http from '~/api/http'
import type { ApiResponse, PageQuery, Paged, Prompt, PromptSourceBrief } from '~/types/creative'

/** 提示词库（API.md 1.11）：匿名可看，列表不含正文，详情才返回并记一次复制 */
export default {
  list(query: PageQuery & { keyword?: string, tag?: string, category?: string, source_id?: number } = {}): Promise<ApiResponse<Paged<Prompt>>> {
    return http.get('/prompt', query)
  },

  tags(): Promise<ApiResponse<string[]>> {
    return http.get('/prompt/tags')
  },

  sources(): Promise<ApiResponse<PromptSourceBrief[]>> {
    return http.get('/prompt/sources')
  },

  /** 详情：返回 content，同时服务端把 uses +1 */
  get(id: number): Promise<ApiResponse<Prompt>> {
    return http.get(`/prompt/${id}`)
  },
}
