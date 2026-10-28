import http from '~/api/http'
import type { ApiResponse, PageQuery, Paged, Style } from '~/types/creative'

/** 风格库（API.md 34）：匿名可看，套用时记一次（需登录） */
export default {
  list(query: PageQuery & { keyword?: string, tag?: string, category?: string, kind?: 'image' | 'video' } = {}): Promise<ApiResponse<Paged<Style>>> {
    return http.get('/style', query)
  },

  categories(): Promise<ApiResponse<string[]>> {
    return http.get('/style/categories')
  },

  /** 套用一次 uses +1（官方上架、已收录、本人私有风格都可） */
  use(id: number): Promise<ApiResponse<{ id: number, uses: number }>> {
    return http.post(`/style/${id}/use`, {})
  },

  /** 我的风格（API.md 34.5，需登录）：私有 + 待审核 + 已收录，全部状态 */
  mine(query: PageQuery & { keyword?: string, kind?: 'image' | 'video' } = {}): Promise<ApiResponse<Paged<Style>>> {
    return http.get('/user/style', query)
  },

  create(data: MyStylePayload & { name: string, prompt: string }): Promise<ApiResponse<Style>> {
    return http.post('/user/style', data)
  },

  /** 仅本人；已收录的风格改动后自动回到待审核 */
  update(id: number, data: MyStylePayload): Promise<ApiResponse<Style | null>> {
    return http.put(`/user/style/${id}`, data)
  },

  remove(id: number): Promise<ApiResponse<null>> {
    return http.delete(`/user/style/${id}`)
  },

  /** 投稿进官方风格库：status 1 → 3，需要封面 */
  submit(id: number): Promise<ApiResponse<Style | null>> {
    return http.post(`/user/style/${id}/submit`, {})
  },

  /** 撤回投稿 / 撤下已收录：3 或 4 → 1 */
  withdraw(id: number): Promise<ApiResponse<Style | null>> {
    return http.post(`/user/style/${id}/withdraw`, {})
  },
}

/** POST / PUT /user/style 的 body；PUT 时字段可选，只更新传了的 */
export type MyStylePayload = {
  name?: string
  prompt?: string
  cover_url?: string
  negative?: string
  tags?: string[]
  category?: string
  kinds?: Array<'image' | 'video'>
  source_asset_id?: number
}
