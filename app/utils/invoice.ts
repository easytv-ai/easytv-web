/**
 * 发票（设置 · 发票）的纯函数：发票平台返回值解析、状态 / 票种展示、金额与申请表单校验。
 *
 * 发票平台由浏览器持 accessToken 直调，
 * 返回 {code, message, content, last, totalElements}：code=1 成功，0 暂无数据，<0 出错。
 * 文案一律返回中文原文，组件里再 t() 翻译（key 即中文原文）。
 */

/** 发票平台通用返回 */
export interface InvoicePlatformResponse<T = unknown> {
  code: number
  message: string
  content?: T
  last?: boolean
  totalElements?: number
}

export type InvoiceTitleType = '企业' | '个人'

/** 发票状态色调：待审核 / 开票中 / 已开票 / 失败 / 置灰 */
export type InvoiceTone = 'pending' | 'processing' | 'success' | 'danger' | 'muted'

export interface InvoiceItem {
  category: string
  name: string
  model: string
  unit: string
  number: string
  price: number
  sum: number
  taxRate: number
  tax: number
  preferentialPolicyName: string
}

export interface InvoiceRecord {
  id: string
  outOrderNo: string
  category: string
  purchaserName: string
  purchaserTaxpayerNumber: string
  purchaserAddress: string
  purchaserPhone: string
  purchaserBank: string
  purchaserBankAccount: string
  email: string
  /** 不含税金额 */
  price: number
  tax: number
  addTime: string
  printTime: string
  code: string
  number: string
  allElectronicInvoiceNumber: string
  state: number
  statements: string
  failMsg: string
  consoleReason: string
  downloadUrl: string
  electronicInvoiceImg: string
  remark: string
  items: InvoiceItem[]
}

/** 发票平台托管的企业抬头 */
export interface InvoiceCompany {
  id: number
  name: string
  taxNumber: string
  address: string
  phone: string
  bank: string
  bankAccount: string
  ifDefault: boolean
}

export type InvoiceCompanySuggestion = Omit<InvoiceCompany, 'id' | 'ifDefault'>

/** 发票平台 state → 状态文案（statements 缺失时兜底） */
export const INVOICE_STATE_TEXT: Record<number, string> = {
  0: '待审核',
  4: '开票中',
  1: '已开票',
  2: '已作废',
  3: '已红冲',
  [-1]: '开票失败',
  [-9]: '放弃开票',
}

function str(value: unknown): string {
  return value == null ? '' : String(value).trim()
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** 状态文案：优先平台给的 statements，否则按 state 兜底 */
export function resolveInvoiceStatements(row: { statements?: unknown, state?: unknown } | null | undefined): string {
  const text = str(row?.statements)
  if (text)
    return text
  return INVOICE_STATE_TEXT[Number(row?.state ?? 0)] ?? '未知'
}

/** 状态色调：按 statements 文案归类，文案未知时按 state */
export function invoiceTone(statements: string, state?: number): InvoiceTone {
  if (['待审核', '作废审核中', '红冲审核中', '待抓取'].includes(statements))
    return 'pending'
  if (['开票中', '红冲中', '作废中'].includes(statements))
    return 'processing'
  if (statements === '已开票')
    return 'success'
  if (statements === '开票失败')
    return 'danger'
  if (['审核未通过', '已作废', '已红冲', '未开票', '放弃开票'].includes(statements))
    return 'muted'
  switch (state) {
    case 0: return 'pending'
    case 4: return 'processing'
    case 1: return 'success'
    case -1: return 'danger'
    default: return 'muted'
  }
}

/** 失败 / 驳回 / 红冲原因（列表 tooltip 与详情用） */
export function resolveInvoiceReason(row: Pick<InvoiceRecord, 'failMsg' | 'consoleReason' | 'statements'>): string {
  const fail = str(row.failMsg)
  const reason = str(row.consoleReason)
  if ((row.statements === '已红冲' || row.statements === '审核未通过') && reason)
    return fail && fail !== reason ? `${fail} ${reason}` : reason
  return fail || reason
}

/** 列表里需要展示原因提示的状态 */
export function invoiceShowsReason(row: Pick<InvoiceRecord, 'failMsg' | 'consoleReason' | 'statements'>): boolean {
  return ['开票失败', '审核未通过', '开票中', '已红冲'].includes(row.statements) && !!resolveInvoiceReason(row)
}

/** 专用发票（专票 / 电专 / 数电专）必须有企业税号 */
export function isSpecialInvoiceCategory(category: string | null | undefined): boolean {
  const text = str(category)
  return /专用发票|专票/.test(text)
}

/** 票种简称，列表里用小标签展示 */
export function invoiceCategoryShort(category: string | null | undefined): string {
  const text = str(category)
  const map: Record<string, string> = {
    增值税电子普通发票: '电普',
    增值税普通发票: '普票',
    增值税电子专用发票: '电专',
    增值税专用发票: '专票',
    全电电子普通发票: '数电普',
    数电普通发票: '数电普',
    全电电子专用发票: '数电专',
    数电专用发票: '数电专',
  }
  return map[text] ?? text
}

/** 平台时间 → "YYYY-MM-DD HH:mm:ss"，空值返回空串 */
export function normalizeInvoiceTime(value: unknown): string {
  return str(value).replace('T', ' ').slice(0, 19)
}

/** 时间拆成日期 / 时刻两行 */
export function splitInvoiceTime(value: string): { date: string, time: string } {
  const text = normalizeInvoiceTime(value)
  if (!text)
    return { date: '', time: '' }
  return { date: text.slice(0, 10), time: text.slice(11, 19) }
}

/** 发票号码：代码 / 号码 / 数电票号，去空 */
export function invoiceNumbers(row: Pick<InvoiceRecord, 'code' | 'number' | 'allElectronicInvoiceNumber'>): string[] {
  const out: string[] = []
  for (const v of [row.code, row.number, row.allElectronicInvoiceNumber]) {
    if (v && !out.includes(v))
      out.push(v)
  }
  return out
}

export function mapInvoiceItems(raw: unknown): InvoiceItem[] {
  const list = Array.isArray((raw as any)?.invoiceItems) ? (raw as any).invoiceItems as any[] : []
  return list.map(item => ({
    category: str(item?.category),
    name: str(item?.name),
    model: str(item?.model),
    unit: str(item?.unit),
    number: str(item?.number),
    price: num(item?.price),
    sum: num(item?.sum),
    taxRate: num(item?.taxRate),
    tax: num(item?.tax),
    preferentialPolicyName: str(item?.preferentialPolicyName),
  }))
}

/** 发票平台发票记录 → 前端结构（列表与详情共用） */
export function mapInvoiceRecord(row: any, index = 0): InvoiceRecord {
  const state = Number(row?.state ?? 0)
  const electronicInvoiceUrl = str(row?.electronicInvoiceUrl)
  const record: InvoiceRecord = {
    id: str(row?.invoiceId ?? row?.id) || String(index),
    outOrderNo: str(row?.outOrderNo),
    category: str(row?.category),
    purchaserName: str(row?.purchaserName),
    purchaserTaxpayerNumber: str(row?.purchaserTaxpayerNumber),
    purchaserAddress: str(row?.purchaserAddress),
    purchaserPhone: str(row?.purchaserPhone),
    purchaserBank: str(row?.purchaserBank),
    purchaserBankAccount: str(row?.purchaserBankAccount),
    email: str(row?.email),
    price: num(row?.price),
    tax: num(row?.tax),
    addTime: normalizeInvoiceTime(row?.addTime),
    printTime: normalizeInvoiceTime(row?.printTime),
    code: str(row?.code),
    number: str(row?.number),
    allElectronicInvoiceNumber: str(row?.allElectronicInvoiceNumber),
    state: Number.isFinite(state) ? state : 0,
    statements: '',
    failMsg: str(row?.failMsg),
    consoleReason: str(row?.consoleReason),
    downloadUrl: electronicInvoiceUrl || str(row?.downloadUrl),
    electronicInvoiceImg: str(row?.electronicInvoiceImg),
    remark: str(row?.remark),
    items: mapInvoiceItems(row),
  }
  record.statements = resolveInvoiceStatements({ statements: row?.statements, state: record.state })
  return record
}

export function mapInvoiceCompany(row: any, index = 0): InvoiceCompany {
  return {
    id: Number(row?.companyId ?? row?.id ?? index + 1),
    name: str(row?.name ?? row?.companyName),
    taxNumber: str(row?.taxNumber ?? row?.taxNo ?? row?.creditCode),
    address: str(row?.address),
    phone: str(row?.phone ?? row?.mobile),
    bank: str(row?.bank ?? row?.bankName),
    bankAccount: str(row?.bankAccount),
    ifDefault: row?.ifDefault === true || row?.ifDefault === 1 || row?.ifDefault === '1' || row?.ifDefault === 'true',
  }
}

export function mapCompanySuggestion(row: any): InvoiceCompanySuggestion {
  const c = mapInvoiceCompany(row)
  return {
    name: c.name,
    taxNumber: c.taxNumber || str(row?.code),
    address: c.address,
    phone: c.phone,
    bank: c.bank,
    bankAccount: c.bankAccount,
  }
}

/** 保存的抬头里默认选中哪一个：ifDefault 优先，否则第一条 */
export function pickDefaultCompanyId(list: InvoiceCompany[], current?: number | null): number | null {
  if (current != null && list.some(c => c.id === current))
    return current
  return list.find(c => c.ifDefault)?.id ?? list[0]?.id ?? null
}

/** 发票平台返回里取数组（content / data / 本身） */
export function platformList(res: unknown): any[] {
  const r = res as any
  if (Array.isArray(r?.content))
    return r.content
  if (Array.isArray(r?.data))
    return r.data
  return Array.isArray(r) ? r : []
}

/** /setting/find?fieldKeys=h5_pc_invoice_categories → 票种数组（fieldValue 是 JSON 字符串数组） */
export function parseInvoiceCategories(res: unknown, fieldKey = 'h5_pc_invoice_categories'): string[] {
  const hit = platformList(res).find(item => item?.fieldKey === fieldKey)
  const raw = hit?.fieldValue
  let list: unknown = []
  if (Array.isArray(raw))
    list = raw
  else {
    try {
      list = JSON.parse(String(raw ?? '[]'))
    }
    catch {
      list = []
    }
  }
  if (!Array.isArray(list))
    return []
  const out: string[] = []
  for (const v of list) {
    const s = str(v)
    if (s && !out.includes(s))
      out.push(s)
  }
  return out
}

/** 发票平台提示 accessToken 已过期（如 {"code":-1,"message":"accessToken已过期"}） */
export function isInvoiceAccessTokenExpired(res: unknown): boolean {
  if (!res || typeof res !== 'object')
    return false
  const r = res as Record<string, unknown>
  const message = String(r.message ?? r.msg ?? '')
  return /accessToken\s*已过期|access[_\s-]?token\s*(?:is\s*)?expired/i.test(message)
}

/** 暂无数据：code=0，或 message 带「暂无数据」 */
export function isInvoiceNoData(res: unknown): boolean {
  const r = res as any
  if (!r || typeof r !== 'object')
    return false
  if (Number(r.code) === 0)
    return true
  return Number(r.code) !== 1 && /暂无数据/.test(String(r.message ?? ''))
}

/**
 * 持 accessToken 调发票平台：token 过期时静默换新 token 重试一次。
 * getToken 取缓存（没有就换取），refreshToken 强制换新；两者都拿不到时返回 null。
 */
export async function withInvoiceTokenRetry<T>(
  request: (token: string) => Promise<T>,
  tokens: { getToken: () => Promise<string>, refreshToken: () => Promise<string> },
): Promise<T | null> {
  const token = await tokens.getToken()
  if (!token)
    return null
  const res = await request(token)
  if (!isInvoiceAccessTokenExpired(res))
    return res
  const next = await tokens.refreshToken()
  if (!next)
    return res
  return request(next)
}

/* ── 金额 ── */

/** 分为单位取整，避免 0.1 + 0.2 */
export function roundCents(value: number): number {
  return Math.round(value * 100) / 100
}

export function formatInvoiceMoney(value: number): string {
  const n = Number(value)
  return `¥${(Number.isFinite(n) ? n : 0).toFixed(2)}`
}

export type InvoiceAmountError = 'empty' | 'invalid' | 'min' | 'precision' | 'exceed'

/** 输入框里的金额 → 数字；非法返回 NaN */
export function parseInvoiceAmount(input: string | number | null | undefined): number {
  if (input == null)
    return Number.NaN
  const text = String(input).trim()
  if (!text)
    return Number.NaN
  if (!/^\d+(?:\.\d+)?$/.test(text))
    return Number.NaN
  return Number(text)
}

/** 校验申请金额：≥0.01、最多两位小数、不超过可开票金额 */
export function validateInvoiceAmount(input: string | number | null | undefined, available: number): InvoiceAmountError | null {
  if (input == null || String(input).trim() === '')
    return 'empty'
  const amount = parseInvoiceAmount(input)
  if (!Number.isFinite(amount))
    return 'invalid'
  if (!/^\d+(?:\.\d{1,2})?$/.test(String(input).trim()))
    return 'precision'
  if (amount < 0.01)
    return 'min'
  if (roundCents(amount) > roundCents(Number(available) || 0))
    return 'exceed'
  return null
}

/** 金额错误 → 中文原文 key（exceed 带 {amount} 占位） */
export const INVOICE_AMOUNT_ERROR_TEXT: Record<InvoiceAmountError, string> = {
  empty: '请输入开票金额',
  invalid: '请输入正确的开票金额',
  min: '开票金额需大于 0',
  precision: '开票金额最多两位小数',
  exceed: '开票金额不能超过可开票金额 {amount}',
}

/* ── 申请表单 ── */

export interface InvoiceApplyBody {
  amount: number
  type: InvoiceTitleType
  category: string
  email: string
  purchaser_name: string
  purchaser_taxpayer_number: string
  purchaser_address: string
  purchaser_phone: string
  purchaser_bank: string
  purchaser_bank_account: string
  remark: string
}

export const INVOICE_REMARK_MAX = 200

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidInvoiceEmail(email: string): boolean {
  return EMAIL_RE.test(str(email))
}

/**
 * 与后端 POST /user/invoice/apply 的校验保持一致。返回中文原文错误（组件 t() 翻译），通过返回 null。
 * 金额另用 validateInvoiceAmount 校验（需要可开票金额）。
 */
export function validateInvoiceApply(body: InvoiceApplyBody): string | null {
  if (!(Number(body.amount) >= 0.01))
    return '请输入正确的开票金额'
  if (body.type !== '企业' && body.type !== '个人')
    return '请选择抬头类型'
  if (!str(body.purchaser_name))
    return body.type === '企业' ? '请选择或添加企业抬头' : '请填写抬头名称'
  if (body.type === '企业' && !str(body.purchaser_taxpayer_number))
    return '企业抬头需要填写税号'
  if (!str(body.category))
    return '请选择发票类型'
  if (isSpecialInvoiceCategory(body.category)) {
    if (body.type !== '企业')
      return '专用发票仅支持企业抬头'
    if (!str(body.purchaser_taxpayer_number))
      return '专用发票需要填写企业税号'
  }
  if (!str(body.email))
    return '请填写接收邮箱'
  if (!isValidInvoiceEmail(body.email))
    return '邮箱格式不正确'
  if (str(body.remark).length > INVOICE_REMARK_MAX)
    return '备注最多 200 字'
  return null
}

/** 抬头表单校验（保存到发票平台前） */
export function validateInvoiceCompany(form: Pick<InvoiceCompany, 'name' | 'taxNumber'>): string | null {
  if (!str(form.name))
    return '请填写抬头名称'
  if (!str(form.taxNumber))
    return '请填写税号'
  return null
}
