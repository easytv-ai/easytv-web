import http from '~/api/http'
import type { ApiResponse, BatchAction, BatchItemRequest, GenerationBatch } from '~/types/creative'

/** 服务端批量生成：API.md 13 */
export const batchApi = {
  /** 同一画布同时只能有一个进行中的批次；budget_points=0 不限 */
  create(canvasId: number, body: { budget_points?: number, items: BatchItemRequest[] }): Promise<ApiResponse<GenerationBatch>> {
    return http.post(`/user/canvas/${canvasId}/batch`, body)
  },

  /** 画布最近一个批次（含条目）；没有时 data=null */
  latest(canvasId: number): Promise<ApiResponse<GenerationBatch | null>> {
    return http.get(`/user/canvas/${canvasId}/batch`)
  },

  action(id: number, action: BatchAction): Promise<ApiResponse<GenerationBatch>> {
    return http.post(`/user/batch/${id}/${action}`)
  },
}
