import http from '~/api/http'
import type { ApiResponse, CanvasDetail, CanvasGraph, CanvasShare, CanvasSummary, CanvasVersion, GenerationTask, PageQuery, Paged, SharedCanvas } from '~/types/creative'
import type { AgentPlan, AssistNodeSummary, AssistPlan } from '~/utils/canvas-assist'

/** 画布：API.md 2.1 */
export const canvasApi = {
  list(query: PageQuery & { project_id?: number } = {}): Promise<ApiResponse<Paged<CanvasSummary>>> {
    return http.get('/user/canvas', query)
  },

  /** 不传 project_id 时后端自动新建同名项目 */
  create(data: { name: string, project_id?: number, graph?: CanvasGraph }): Promise<ApiResponse<CanvasDetail>> {
    return http.post('/user/canvas', data)
  },

  get(id: number): Promise<ApiResponse<CanvasDetail>> {
    return http.get(`/user/canvas/${id}`)
  },

  /** 乐观锁保存，version 必填；snapshot=true 表示用户主动保存，单独记一条版本 */
  save(
    id: number,
    data: { version: number, name?: string, graph?: CanvasGraph, thumbnail_url?: string, snapshot?: boolean, note?: string },
  ): Promise<ApiResponse<{ id: number, version: number, updated_at: number }>> {
    return http.put(`/user/canvas/${id}`, data)
  },

  /** 版本历史（不含 graph），最新在前，最多 50 条 */
  versions(id: number): Promise<ApiResponse<Paged<CanvasVersion>>> {
    return http.get(`/user/canvas/${id}/versions`)
  },

  /** 单个版本（含 graph） */
  version(id: number, vid: number): Promise<ApiResponse<CanvasVersion & { graph: CanvasGraph }>> {
    return http.get(`/user/canvas/${id}/versions/${vid}`)
  },

  /** 只读分享状态 */
  share(id: number): Promise<ApiResponse<CanvasShare>> {
    return http.get(`/user/canvas/${id}/share`)
  },

  setShare(id: number, enabled: boolean): Promise<ApiResponse<CanvasShare>> {
    return http.put(`/user/canvas/${id}/share`, { enabled })
  },

  /** 分享页（匿名） */
  shared(token: string): Promise<ApiResponse<SharedCanvas>> {
    return http.get(`/share/canvas/${token}`)
  },

  /** 复制分享的画布到我的项目 */
  copyShared(token: string): Promise<ApiResponse<CanvasDetail>> {
    return http.post(`/user/share/canvas/${token}/copy`)
  },

  /** 回滚到某版本，返回最新画布详情（含 graph 与新 version） */
  restoreVersion(id: number, vid: number): Promise<ApiResponse<CanvasDetail>> {
    return http.post(`/user/canvas/${id}/versions/${vid}/restore`)
  },

  remove(id: number): Promise<ApiResponse<null>> {
    return http.delete(`/user/canvas/${id}`)
  },

  trash(query: PageQuery = {}): Promise<ApiResponse<Paged<CanvasSummary & { deleted_at: number }>>> {
    return http.get('/user/canvas/trash', query)
  },

  restore(id: number): Promise<ApiResponse<null>> {
    return http.post(`/user/canvas/${id}/restore`)
  },

  /** 画布助手（API.md 16）：按一次文本任务计费，返回任务，轮询完成后取方案 */
  assist(id: number, body: { question: string, model?: string, nodes: AssistNodeSummary[], history: { role: 'user' | 'assistant', content: string }[] }): Promise<ApiResponse<GenerationTask>> {
    return http.post(`/user/canvas/${id}/assist`, body)
  },

  assistPlan(id: number, taskId: number): Promise<ApiResponse<AssistPlan>> {
    return http.get(`/user/canvas/${id}/assist/${taskId}`)
  },

  /**
   * 对话式工作流生成（API.md 32，契约 8.1）：服务端跑多轮 ReAct，一个文本任务里出完整计划。
   * 与 assist 一样按任务计费，返回任务后轮询，完成再取计划。
   */
  agent(
    id: number,
    body: {
      question: string
      /** generate = 从零搭一张图；patch = 在现有画布上小改（缺省） */
      mode?: 'generate' | 'patch'
      model?: string
      nodes?: AssistNodeSummary[]
      history?: { role: 'user' | 'assistant', content: string }[]
      max_rounds?: number
    },
  ): Promise<ApiResponse<GenerationTask>> {
    return http.post(`/user/canvas/${id}/agent`, body)
  },

  /** 读取 agent 计划：changes 里可能带 apply_graph，另有 steps 与 validate 报告 */
  agentPlan(id: number, taskId: number): Promise<ApiResponse<AgentPlan>> {
    return http.get(`/user/canvas/${id}/agent/${taskId}`)
  },

  /** 基于上一轮再跑一次（省一次全量上下文），note 是用户的补充说明 */
  agentRetry(id: number, taskId: number, body: { note?: string, max_rounds?: number } = {}): Promise<ApiResponse<GenerationTask>> {
    return http.post(`/user/canvas/${id}/agent/${taskId}/retry`, body)
  },

  /**
   * 右侧对话会话（API.md 2.1）。历史列表不含正文；打开某一段再取消息。
   * 时间是 Unix 秒。空消息、进行中的气泡会被服务端拒绝或丢掉。
   */
  chat: {
    list(id: number) {
      return http.get(`/user/canvas/${id}/chat`)
    },
    detail(id: number, sid: number) {
      return http.get(`/user/canvas/${id}/chat/${sid}`)
    },
    create(id: number, body: { title: string, messages: unknown[] }) {
      return http.post(`/user/canvas/${id}/chat`, body)
    },
    update(id: number, sid: number, body: { title: string, messages: unknown[] }) {
      return http.put(`/user/canvas/${id}/chat/${sid}`, body)
    },
    delete(id: number, sid: number) {
      return http.delete(`/user/canvas/${id}/chat/${sid}`)
    },
    clear(id: number) {
      return http.delete(`/user/canvas/${id}/chat`)
    },
  },
}

export default canvasApi
