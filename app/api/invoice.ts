import http from '~/api/http'
import {
  type InvoiceApplyBody,
  type InvoicePlatformResponse,
  withInvoiceTokenRetry,
} from '~/utils/invoice'

/** GET /user/invoice/summary（金额口径均为人民币元） */
export interface InvoiceSummary {
  enabled: boolean
  /** 已支付订单金额（不含手动补单、已退款） */
  paid: number
  /** 已申请 / 开出（审核中、开票中、已开票）的发票金额 */
  invoiced: number
  /** 可开票金额 */
  available: number
  /** 非空时说明开票通道暂不可用，申请按钮置灰 */
  invoice_error: string
  tax_rate: string
  item_name: string
  category: string
  service_url: string
}

export interface InvoiceAccessToken {
  access_token: string
  username: string
  service_url: string
}

export function normalizeInvoiceSummary(raw: any): InvoiceSummary {
  const n = (v: unknown) => Number(v) || 0
  return {
    enabled: raw?.enabled === true,
    paid: n(raw?.paid),
    invoiced: n(raw?.invoiced),
    available: n(raw?.available),
    invoice_error: String(raw?.invoice_error ?? '').trim(),
    tax_rate: String(raw?.tax_rate ?? ''),
    item_name: String(raw?.item_name ?? ''),
    category: String(raw?.category ?? ''),
    service_url: String(raw?.service_url ?? '').trim(),
  }
}

/** 我方后端的发票接口（走 http.ts，带登录态） */
export const invoiceApi = {
  summary() {
    return http.get('/user/invoice/summary')
  },

  accessToken() {
    return http.get('/user/invoice/access-token')
  },

  /** 成功 data: {out_order_no, content}；失败 success=false + message */
  apply(body: InvoiceApplyBody) {
    return http.post('/user/invoice/apply', body)
  },
}

type Query = Record<string, string | number | boolean | undefined>

/**
 * 发票平台直调（浏览器 → 发票平台，已放开 CORS）。
 * 不能走 http.ts：那里会带上我方的登录头。accessToken 过期时静默换新再试一次。
 */
export function createInvoicePlatform() {
  let token = ''
  let serviceUrl = ''
  let pending: Promise<string> | null = null
  /** 最近一次换 token 失败的原因（后端 message），列表报错时给用户看，而不是当成「没有记录」 */
  let tokenError = ''

  async function fetchToken(): Promise<string> {
    const res = await invoiceApi.accessToken()
    if (!res?.success) {
      tokenError = String(res?.message || '')
      return ''
    }
    tokenError = ''
    const data = (res.data ?? {}) as Partial<InvoiceAccessToken>
    token = String(data.access_token ?? '').trim()
    const url = String(data.service_url ?? '').trim().replace(/\/+$/, '')
    if (url)
      serviceUrl = url
    return serviceUrl ? token : ''
  }

  function refreshToken(): Promise<string> {
    if (!pending) {
      pending = fetchToken()
        .catch(() => '')
        .finally(() => {
          pending = null
        })
    }
    return pending
  }

  async function getToken(): Promise<string> {
    return token && serviceUrl ? token : refreshToken()
  }

  async function call<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    build: (accessToken: string) => { query?: Query, body?: Record<string, unknown> },
  ): Promise<InvoicePlatformResponse<T>> {
    const res = await withInvoiceTokenRetry(async (accessToken) => {
      const { query, body } = build(accessToken)
      try {
        return await $fetch<InvoicePlatformResponse<T>>(`${serviceUrl}${path}`, {
          method,
          query,
          body,
          timeout: 30000,
        })
      }
      catch (error: unknown) {
        // 平台出错时也常带 {code, message} 的 JSON
        const data = (error as { data?: unknown })?.data
        if (data && typeof data === 'object' && 'code' in data)
          return data as InvoicePlatformResponse<T>
        return { code: -1, message: '' } as InvoicePlatformResponse<T>
      }
    }, { getToken, refreshToken })
    return res ?? { code: -1, message: tokenError }
  }

  return {
    /** 预热 token（进入发票页时调用） */
    ensureToken: getToken,

    /** summary 里也带 service_url，access-token 没给时兜底 */
    setServiceUrl(url: string) {
      const next = String(url ?? '').trim().replace(/\/+$/, '')
      if (next && !serviceUrl)
        serviceUrl = next
    },

    list(page: number, size: number) {
      return call<unknown[]>('GET', '/invoices', accessToken => ({ query: { accessToken, page, size } }))
    },

    detail(id: string | number) {
      return call<unknown>('GET', `/invoice/${encodeURIComponent(String(id))}`, accessToken => ({ query: { accessToken } }))
    },

    /** 票种：fieldValue 为 JSON 字符串数组 */
    categories() {
      return call<unknown[]>('GET', '/setting/find', accessToken => ({
        query: { fieldKeys: 'h5_pc_invoice_categories', accessToken, size: 100 },
      }))
    },

    /** 企业名称联想 */
    companyCodes(name: string) {
      return call<unknown[]>('GET', '/company/codes', accessToken => ({ query: { name, accessToken } }))
    },

    companies() {
      return call<unknown[]>('GET', '/companies', accessToken => ({ query: { accessToken } }))
    },

    createCompany(data: InvoiceCompanyPayload) {
      return call<unknown>('POST', '/company', accessToken => ({ body: { accessToken, ...data } }))
    },

    updateCompany(id: number, data: InvoiceCompanyPayload) {
      return call<unknown>('PUT', `/company/${id}`, accessToken => ({ body: { accessToken, ...data } }))
    },

    deleteCompany(id: number) {
      return call<unknown>('DELETE', `/company/${id}`, accessToken => ({ query: { accessToken } }))
    },
  }
}

export interface InvoiceCompanyPayload {
  name: string
  taxNumber: string
  address?: string
  phone?: string
  bank?: string
  bankAccount?: string
  ifDefault: boolean
}

export type InvoicePlatform = ReturnType<typeof createInvoicePlatform>

export default invoiceApi
