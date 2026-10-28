import http from '~/api/http'
import type { ApiResponse, PageQuery, Paged, Skill } from '~/types/creative'

export type MySkillPayload = {
  title?: string
  description?: string
  category?: string
  cover_url?: string
  /** 提示词模板，{{prompt}} 为灵感占位 */
  prompt?: string
  /** 执行契约（API.md 1.6）：只对文本任务注入，拼在提示词最前面 */
  guide?: string
  output_format?: string
  /** 从画布存为 Skill：以该画布为模板；传 0 清除 */
  canvas_id?: number
  scene?: string
  howto?: string
  output?: string
  /** 共享给当前所在团队（API.md 10.10）；不在团队时后端返回 success=false 与提示文案 */
  shared?: boolean
}

/** 技能模板：公开 + 用户侧收藏 / 私有 Skill（API.md 1.6 / 2.1 / 2.2） */
export const skillApi = {
  /** 官方 + 已上架的社区技能，带登录态时附 favorited；source 可筛官方 / 社区（API.md 8.3） */
  list(query: PageQuery & { category?: string, keyword?: string, source?: 'official' | 'community' } = {}): Promise<ApiResponse<Paged<Skill>>> {
    return http.get('/skill', query)
  },

  /** 详情，使用次数 +1 */
  get(id: number): Promise<ApiResponse<Skill>> {
    return http.get(`/skill/${id}`)
  },

  /** 收藏 / 取消收藏（切换） */
  favorite(id: number): Promise<ApiResponse<{ favorited: boolean, stars: number }>> {
    return http.post(`/user/skill/${id}/favorite`)
  },

  favorites(query: PageQuery & { keyword?: string } = {}): Promise<ApiResponse<Paged<Skill>>> {
    return http.get('/user/skill/favorites', query)
  },

  mine(query: PageQuery & { keyword?: string } = {}): Promise<ApiResponse<Paged<Skill>>> {
    return http.get('/user/skill', query)
  },

  /** 我的 Skill 详情（含画布模板），官方技能也可读 */
  mineDetail(id: number): Promise<ApiResponse<Skill>> {
    return http.get(`/user/skill/${id}`)
  },

  create(data: MySkillPayload & { title: string, prompt: string }): Promise<ApiResponse<Skill>> {
    return http.post('/user/skill', data)
  },

  update(id: number, data: MySkillPayload): Promise<ApiResponse<null>> {
    return http.put(`/user/skill/${id}`, data)
  },

  remove(id: number): Promise<ApiResponse<null>> {
    return http.delete(`/user/skill/${id}`)
  },

  /** 提交上架（API.md 8.3）：私有 / 驳回可提交，需有标题、提示词、封面 */
  submit(id: number): Promise<ApiResponse<null>> {
    return http.post(`/user/skill/${id}/submit`)
  },

  /** 撤回：已上架 / 待审 → 私有 */
  withdraw(id: number): Promise<ApiResponse<null>> {
    return http.post(`/user/skill/${id}/withdraw`)
  },
}

export default skillApi
