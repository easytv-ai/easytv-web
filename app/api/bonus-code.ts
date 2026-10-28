import http from '~/api/http'

/** 口令类型，与后端 bonus_code.kind 对齐（API.md 7.1） */
export const BONUS_CODE_KIND = {
  /** 首充加赠 */
  FIRST_RECHARGE: 1,
  /** 定额积分 */
  POINTS: 2,
  /** 会员天数 */
  MEMBER_DAYS: 3,
} as const

/** 领取记录中的绑定结果，与后端 model.BonusBindResult* 对齐 */
export const BONUS_BIND_RESULT = {
  NEW_BIND: 1,
  SAME_OWNER: 2,
} as const

/** 首充权益状态，与后端 model.BonusRewardStatus* 对齐：0 待生效 1 已发 -1 过期 -2 不符合 */
export const BONUS_REWARD_STATUS = {
  PENDING: 0,
  GRANTED: 1,
  EXPIRED: -1,
  INELIGIBLE: -2,
} as const

/** GET /bonus-code/preview 返回：口令可用时的展示信息（匿名可调） */
export interface BonusCodePreview {
  code: string
  kind: number
  /** 归属渠道名，用于让用户确认来源 */
  partner_name: string
  /** 注册红包积分 */
  bonus_points: number
  /** 首充赠送比例，0.2 = 多送 20% */
  first_recharge_rate: number
  /** 首充赠送封顶（积分） */
  first_recharge_cap_points: number
  /** 首充权益有效期（天），0=不过期 */
  reward_valid_days: number
  /** 赠送会员天数 */
  member_days: number
}

/** POST /user/bonus-code/claim 返回 */
export interface BonusCodeClaimResult {
  bonus_points: number
  partner_name: string
  bind_result: number
  reward_rate: number
  reward_cap_points: number
  /** 首充权益过期时间（Unix 秒），0=不过期 */
  reward_expire_at: number
  reward_status: number
  member_days: number
}

/** GET /user/bonus-code/record 返回，未使用过口令时为 null */
export interface BonusCodeRecord {
  id: number
  user_id: number
  bonus_code_id: number
  code: string
  partner_id: number
  bind_result: number
  bonus_points: number
  reward_rate: number
  reward_cap_points: number
  reward_expire_at: number
  reward_status: number
  /** 首充已发的加赠积分 */
  reward_points: number
  rewarded_at: number
  member_days: number
  created_at: number
}

/** 领取记录 → 弹窗成功态用的结果结构（注册后自动领取的场景只拿得到记录） */
export function claimResultFromRecord(record: BonusCodeRecord, partnerName = ''): BonusCodeClaimResult {
  return {
    bonus_points: Number(record.bonus_points) || 0,
    partner_name: partnerName,
    bind_result: Number(record.bind_result) || 0,
    reward_rate: Number(record.reward_rate) || 0,
    reward_cap_points: Number(record.reward_cap_points) || 0,
    reward_expire_at: Number(record.reward_expire_at) || 0,
    reward_status: Number(record.reward_status) || 0,
    member_days: Number(record.member_days) || 0,
  }
}

/** 后端「每个账号只能领取一次口令」的判定，用于把二次领取当作已领取处理 */
export function isBonusCodeAlreadyClaimedMessage(message: unknown): boolean {
  const text = String(message ?? '')
  return text.includes('只能领取一次') || text.includes('已领取')
}

export const bonusCodeApi = {
  /** 校验口令（无副作用，未登录也可调用，用于注册页实时回显） */
  preview(code: string): Promise<any> {
    return http.get('/bonus-code/preview', { code })
  },

  /** 领取口令：绑定归属 + 到账红包积分 + 建立首充权益 / 会员天数 */
  claim(code: string): Promise<any> {
    return http.post('/user/bonus-code/claim', { code })
  },

  /** 我的口令使用记录（展示首充权益状态） */
  record(): Promise<any> {
    return http.get('/user/bonus-code/record')
  },
}

export default bonusCodeApi
