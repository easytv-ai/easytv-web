/**
 * 归因 cookie `easytv_attr`：落地时从 URL 读 utm_* / ref（邀请码）/ code（口令）/ pcode（渠道伙伴码）写入，30 天有效。
 * 首触归因：已有的非空字段不被后来的值覆盖；空字段允许被新看到的值补上。
 * 注册时通过 buildRegisterAttr() 随 POST /user/register 的 attr 一并提交（API.md 7.2）。
 */
import { getAnonId } from '~/utils/device-id'

export const ATTRIBUTION_COOKIE = 'easytv_attr'
const MAX_AGE = 60 * 60 * 24 * 30
const MAX_LEN = 64

export interface Attribution {
  source: string
  medium: string
  campaign: string
  /** 邀请码（?ref= 或 ?aff=） */
  ref: string
  /** 口令（?code=） */
  code: string
  /** 渠道伙伴专属码（?pcode= 或 /partner/:code 落地，API.md 9.3） */
  pcode: string
}

export type AttributionCookie = Attribution & { ts: number }

const ATTR_KEYS = ['source', 'medium', 'campaign', 'ref', 'code', 'pcode'] as const
const EMPTY: Attribution = { source: '', medium: '', campaign: '', ref: '', code: '', pcode: '' }

function clean(value: unknown): string {
  return String(value ?? '').trim().slice(0, MAX_LEN)
}

function readRawCookie(): AttributionCookie | null {
  if (!import.meta.client || typeof document === 'undefined')
    return null
  const prefix = `${ATTRIBUTION_COOKIE}=`
  const part = document.cookie.split('; ').find(c => c.startsWith(prefix))
  if (!part)
    return null
  try {
    const parsed = JSON.parse(decodeURIComponent(part.slice(prefix.length))) as Partial<AttributionCookie>
    return {
      source: clean(parsed.source),
      medium: clean(parsed.medium),
      campaign: clean(parsed.campaign),
      ref: clean(parsed.ref),
      code: clean(parsed.code),
      pcode: clean(parsed.pcode),
      ts: Number(parsed.ts) || 0,
    }
  }
  catch {
    return null
  }
}

export function readAttribution(): Attribution {
  const raw = readRawCookie()
  if (!raw)
    return { ...EMPTY }
  return { source: raw.source, medium: raw.medium, campaign: raw.campaign, ref: raw.ref, code: raw.code, pcode: raw.pcode }
}

function writeCookie(value: AttributionCookie) {
  if (!import.meta.client || typeof document === 'undefined')
    return
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${ATTRIBUTION_COOKIE}=${encodeURIComponent(JSON.stringify(value))}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax${secure}`
}

/**
 * 合并一次新看到的归因参数：只填空字段，不覆盖已有值。
 * 返回 true 表示 cookie 有变化（首次写入或补上了字段）。
 */
export function mergeAttribution(incoming: Partial<Attribution>): boolean {
  const current = readRawCookie()
  const next: AttributionCookie = {
    ...EMPTY,
    ...(current ?? {}),
    ts: current?.ts || Math.floor(Date.now() / 1000),
  }
  let changed = !current
  for (const key of ATTR_KEYS) {
    const value = clean(incoming[key])
    if (value && !next[key]) {
      next[key] = value
      changed = true
    }
  }
  if (!ATTR_KEYS.some(key => next[key]))
    return false
  if (changed)
    writeCookie(next)
  return changed
}

/**
 * 注册请求 attr 字段：归因六项（含渠道伙伴 pcode）+ 匿名 id（把注册前的匿名事件关联到新用户）。
 * overrides 优先于 cookie（如表单里手填的口令），fallbacks 只在 cookie 为空时补位（如 ?aff= 邀请码）。
 */
export function buildRegisterAttr(
  overrides?: Partial<Attribution>,
  fallbacks?: Partial<Attribution>,
): Attribution & { anon_id: string } {
  const attr = readAttribution()
  for (const key of ATTR_KEYS) {
    const value = clean(overrides?.[key])
    if (value)
      attr[key] = value
    else if (!attr[key])
      attr[key] = clean(fallbacks?.[key])
  }
  return { ...attr, anon_id: getAnonId() }
}
