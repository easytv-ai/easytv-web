import http from '~/api/http'
import type { ApiResponse, CheckinResult, CheckinStatus, GrowthTasks } from '~/types/creative'

/** 增长域用户侧：新手任务 / 签到（API.md 7.3） */
export const growthApi = {
  tasks(): Promise<ApiResponse<GrowthTasks>> {
    return http.get('/user/growth/tasks')
  },

  /** 签到；already=true 表示今日已签，不重复发 */
  checkin(): Promise<ApiResponse<CheckinResult>> {
    return http.post('/user/checkin')
  },

  checkinStatus(): Promise<ApiResponse<CheckinStatus>> {
    return http.get('/user/checkin/status')
  },
}

export default growthApi
