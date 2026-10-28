import http from '~/api/http'
import type { ApiResponse, GenerationModel, GenerationModelDetail, GenerationTask, PageQuery, Paged, TaskInput, TaskStatus, TaskSummary, TaskType } from '~/types/creative'

/** 生成任务：API.md 1.4 / 2.1 */
export const taskApi = {
  /** 可用模型（匿名）。Inspector 的模型下拉应改为读取此接口。 */
  models(): Promise<ApiResponse<GenerationModel[]>> {
    return http.get('/generation/models')
  },

  /**
   * 模型详情（匿名，API.md 28）：本地积分定价 + 网关展示元数据。
   * Accept-Language 由 http 层自动带上；gateway_available=false 时仍返回定价。
   */
  modelDetail(model: string): Promise<ApiResponse<GenerationModelDetail>> {
    return http.get('/generation/models/detail', { model })
  },

  create(data: {
    type: TaskType
    model: string
    prompt: string
    params?: Record<string, unknown>
    inputs?: TaskInput[]
    canvas_id?: number
    node_id?: string
    project_id?: number
    /** 使用的技能（API.md 1.6）：type=text 时服务端注入该技能的执行契约，并按 T26 给作者记分成 */
    skill_id?: number
    /** 引用主体（API.md 10.2），最多 4 个：服务端把主体参考图并入 inputs 并把 look 追加到提示词 */
    subject_ids?: number[]
    /** 锁定的主体版本 { 主体 id: 版本 }（API.md 14.2），缺省用最新 */
    subject_versions?: Record<string, number>
    /** 音频任务（API.md 10.4）：按语种先翻译台词再 TTS */
    lang?: string
    /** 音频任务音色 */
    voice?: string
  }): Promise<ApiResponse<GenerationTask>> {
    return http.post('/user/task', data)
  },

  list(query: PageQuery & { canvas_id?: number, status?: TaskStatus, type?: TaskType, keyword?: string, active?: 1 } = {}): Promise<ApiResponse<Paged<GenerationTask>>> {
    return http.get('/user/task', query)
  },

  /** 任务中心概览 */
  summary(): Promise<ApiResponse<TaskSummary>> {
    return http.get('/user/task/summary')
  },

  /** 重试失败 / 已取消的任务：按原参数新建一条 */
  retry(id: number): Promise<ApiResponse<GenerationTask>> {
    return http.post(`/user/task/${id}/retry`)
  },

  /** 前端轮询用 */
  get(id: number): Promise<ApiResponse<GenerationTask>> {
    return http.get(`/user/task/${id}`)
  },

  cancel(id: number): Promise<ApiResponse<null>> {
    return http.post(`/user/task/${id}/cancel`)
  },

  /** 片段重拍（API.md 10.3）：同参数重跑，新任务的 retake_of 记原任务 */
  retake(id: number): Promise<ApiResponse<GenerationTask>> {
    return http.post(`/user/task/${id}/retake`)
  },

  /** 续写（API.md 10.3）：取原视频末帧作首帧建新视频任务，parent_task_id 记原任务；model 可选，指定续写用的视频模型 */
  extend(id: number, body: { prompt?: string, seconds?: number, node_id?: string, model?: string } = {}): Promise<ApiResponse<GenerationTask>> {
    return http.post(`/user/task/${id}/extend`, body)
  },

  /** 素材续写（API.md 30）：没有来源任务的视频资产取末帧续写；模型不传由服务端按成片默认视频模型挑 */
  extendAsset(assetId: number, body: { model?: string, prompt?: string, seconds?: number, node_id?: string, canvas_id?: number } = {}): Promise<ApiResponse<GenerationTask>> {
    return http.post(`/user/asset/${assetId}/extend`, body)
  },

  /** 超分（API.md 10.3）：没有已定价的超分模型时 success=false，message 为「暂无可用的超分模型」 */
  upscale(id: number): Promise<ApiResponse<GenerationTask>> {
    return http.post(`/user/task/${id}/upscale`)
  },

  /** 素材超分（API.md 30）：没有来源任务的视频资产 */
  upscaleAsset(assetId: number, body: { model?: string, resolution?: string, scale?: number } = {}): Promise<ApiResponse<GenerationTask>> {
    return http.post(`/user/asset/${assetId}/upscale`, body)
  },
}

export default taskApi
