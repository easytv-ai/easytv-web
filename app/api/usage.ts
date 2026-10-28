import http from '~/api/http'
import type { ApiResponse } from '~/types/creative'

/** 套餐额度与用量（API.md 6.9） */
export type UsageView = {
  plan: { name: string, edition: 'free' | 'creator' | 'team', seats: number, is_member: boolean, scope: 'self' | 'team' }
  concurrent: { used: number, limit: number }
  storage: { used_bytes: number, limit_bytes: number }
}

export type TeamUsageMember = {
  user_id: number
  nickname: string
  role: 'owner' | 'member' | ''
  tasks_30d: number
  points_30d: number
  storage_bytes: number
  active_tasks: number
}

export type TeamUsageView = {
  members: TeamUsageMember[]
  totals: { tasks_30d: number, points_30d: number, storage_bytes: number, active_tasks: number }
  concurrent: { used: number, limit: number }
  storage: { used_bytes: number, limit_bytes: number }
  pool_balance: number
}

export const usageApi = {
  mine(): Promise<ApiResponse<UsageView>> {
    return http.get('/user/usage')
  },
  team(): Promise<ApiResponse<TeamUsageView>> {
    return http.get('/user/team/usage')
  },
}

export default usageApi
