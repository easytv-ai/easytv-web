/**
 * 自备密钥类型预留。没有对应 API、设置页也不挂入口；先不要按这些类型做产品面。
 */
import type { ByokProviderSlug } from '~/constants/byokProviders'

export const BYOK_DEFAULT_PRIORITY = 1
export const BYOK_DEFAULT_WEIGHT = 100
export const BYOK_WEIGHT_MIN = 1
export const BYOK_WEIGHT_MAX = 999

export interface ByokKeyStats {
  todayCalls: number
  totalCalls: number
  successRate: number
  avgResponseMs: number
  calls7d: number[]
  hasError?: boolean
}

export interface ByokKeyRecord {
  id: number
  providerSlug: ByokProviderSlug
  keyMask: string
  /** 中转站地址（预定义服务商为官方地址或空） */
  baseUrl: string
  /** 模型列表（逗号分隔；中转站由用户自填） */
  models: string
  remark: string
  enabled: boolean
  priority: number
  weight: number
  createdAt: number
  stats: ByokKeyStats
}
