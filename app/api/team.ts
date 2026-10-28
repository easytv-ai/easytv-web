import http from '~/api/http'
import type { ApiResponse } from '~/types/creative'

export type TeamMember = {
  id: number
  team_id: number
  user_id: number
  role: 'owner' | 'member'
  /** 成员权限（API.md 15）：admin 管理员 / editor 编辑者 / viewer 查看者；owner 恒为管理员 */
  permission?: TeamPermission
  joined_at: number
  nickname: string
  /** 每月积分上限，null / 0 表示不限（API.md 10.5） */
  points_limit: number | null
  /** 当月已用积分 */
  points_used: number
  /** 当月剩余，null 表示不限 */
  points_left: number | null
}

/** PUT /user/team/member/:uid/limit 的返回 */
export type TeamMemberLimit = {
  points_limit: number | null
  points_used: number
  points_left: number | null
}

export type TeamPermission = 'admin' | 'editor' | 'viewer'

export type TeamView = {
  id: number
  name: string
  owner_id: number
  seats: number
  used_seats: number
  role: 'owner' | 'member'
  /** 我在团队里的权限 */
  permission?: TeamPermission
  members: TeamMember[]
  active: boolean
  expires_at: number
  plan_name?: string
  pool_balance: number
  invite_code: string
  invite_expiry: number
}

/** 工作空间切换器里的团队（GET /user/team/mine，API.md 20） */
export type TeamSpace = {
  id: number
  name: string
  role: 'owner' | 'member'
  permission: TeamPermission
  member_count: number
  /** 负责人的团队版会员是否有效；过期时团队积分不可用 */
  edition_active: boolean
  expires_at: number
}

/** 团队版会员：API.md 6.7 */
export const teamApi = {
  /** 可切换的团队空间（目前一个用户最多一个团队） */
  spaces(): Promise<ApiResponse<{ items: TeamSpace[] }>> {
    return http.get('/user/team/mine')
  },
  mine(): Promise<ApiResponse<TeamView | null>> {
    return http.get('/user/team')
  },
  rename(name: string): Promise<ApiResponse<null>> {
    return http.put('/user/team', { name })
  },
  regenerateInvite(): Promise<ApiResponse<{ code: string, expires_at: number }>> {
    return http.post('/user/team/invite')
  },
  join(code: string): Promise<ApiResponse<{ team_id: number, name: string }>> {
    return http.post('/user/team/join', { code })
  },
  quit(): Promise<ApiResponse<null>> {
    return http.post('/user/team/quit')
  },
  kick(userId: number): Promise<ApiResponse<null>> {
    return http.delete(`/user/team/member/${userId}`)
  },

  /** 所有者 / 管理员调整成员权限；只有所有者能设管理员（API.md 15） */
  setMemberPermission(userId: number, permission: TeamPermission): Promise<ApiResponse<{ permission: TeamPermission }>> {
    return http.put(`/user/team/member/${userId}/permission`, { permission })
  },

  /** 所有者 / 管理员设成员每月积分上限，0 = 不限（API.md 10.5） */
  setMemberLimit(userId: number, pointsLimit: number): Promise<ApiResponse<TeamMemberLimit>> {
    return http.put(`/user/team/member/${userId}/limit`, { points_limit: pointsLimit })
  },
}

export default teamApi
