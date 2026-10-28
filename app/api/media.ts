import http from '~/api/http'
import type { ApiResponse, MediaAction, MediaJob, PageQuery, Paged } from '~/types/creative'

/** 媒体工具（API.md 23）：本地 ffmpeg 动作与按能力位接模型的后处理动作 */
export const mediaApi = {
  /** 动作清单与可用性，工具条据此决定按钮能不能点 */
  async actions(): Promise<ApiResponse<MediaAction[]>> {
    const res = await http.get('/user/media/actions') as ApiResponse<{ actions?: MediaAction[] } | MediaAction[]>
    if (!res?.success)
      return { success: false, message: res?.message }
    const raw = res.data
    const list = Array.isArray(raw) ? raw : raw?.actions
    return { success: true, message: res.message, data: Array.isArray(list) ? list : [] }
  },

  /** 创建作业；asset_id 与 task_id 二选一。模型动作会同步提交生成任务，计费失败时直接报错 */
  async create(body: {
    action: string
    asset_id?: number
    task_id?: number
    params?: Record<string, unknown>
    node_id?: string
    canvas_id?: number
    project_id?: number
    /** 模型动作可指定模型，留空自动挑 */
    model?: string
  }): Promise<ApiResponse<MediaJob>> {
    const res = await http.post('/user/media/jobs', body) as ApiResponse<{ job?: MediaJob }>
    if (!res?.success)
      return { success: false, message: res?.message }
    return { success: true, message: res.message, data: res.data?.job }
  },

  list(query: PageQuery & { canvas_id?: number, project_id?: number, asset_id?: number, action?: string, active?: 1 } = {}): Promise<ApiResponse<Paged<MediaJob>>> {
    return http.get('/user/media/jobs', query)
  },

  /** 轮询用：模型动作的状态由生成任务实时映射 */
  async get(id: number): Promise<ApiResponse<MediaJob>> {
    const res = await http.get(`/user/media/jobs/${id}`) as ApiResponse<{ job?: MediaJob }>
    if (!res?.success)
      return { success: false, message: res?.message }
    return { success: true, message: res.message, data: res.data?.job }
  },
}

export default mediaApi
