import http from '~/api/http'
import type { ApiResponse, GenerationTask } from '~/types/creative'

/**
 * AI 对话额度（GET /user/ai-chat/quota）：对话免费后按天计数。
 * free=false 表示没走免费次数（退回积分口径），前端不展示次数。
 */
export type ChatQuota = {
  /** 计数日期（Asia/Shanghai，YYYY-MM-DD） */
  date: string
  /** 平台是否开启对话 */
  enabled: boolean
  /** 是否走免费次数；false 时按积分计费，不展示次数 */
  free: boolean
  is_member: boolean
  /** 会员或次数不限（不限次时 remaining 为 -1） */
  unlimited: boolean
  daily_limit: number
  used: number
  remaining: number
}

/** 对话额度 + 导演助手发送（次数由服务端扣，客户端不许自报免费标记） */
export const aiChatApi = {
  quota(): Promise<ApiResponse<ChatQuota>> {
    return http.get('/user/ai-chat/quota')
  },
  /** 导演台助手：POST /user/ai-chat，和画布对话共用每日次数 */
  create(body: { model: string, prompt: string, canvas_id?: number }): Promise<ApiResponse<GenerationTask>> {
    return http.post('/user/ai-chat', body)
  },
}

export default aiChatApi
