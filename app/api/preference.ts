import http from '~/api/http'
import type { ApiResponse } from '~/types/creative'

/** 用户偏好（API.md 33）：前端自定义的小块状态跨设备同步，值是 JSON 文本，后端只存不解释 */
export const preferenceApi = {
  all(): Promise<ApiResponse<Record<string, string>>> {
    return http.get('/user/preference')
  },
  /** value 为空串 = 删除该键 */
  set(key: string, value: string): Promise<ApiResponse<{ key: string, value: string }>> {
    return http.put(`/user/preference/${encodeURIComponent(key)}`, { value })
  },
}

export default preferenceApi
