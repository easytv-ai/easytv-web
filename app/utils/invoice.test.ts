import { describe, expect, it, vi } from 'vitest'
import {
  invoiceCategoryShort,
  invoiceNumbers,
  invoiceShowsReason,
  invoiceTone,
  isInvoiceAccessTokenExpired,
  isInvoiceNoData,
  isSpecialInvoiceCategory,
  mapInvoiceCompany,
  mapInvoiceRecord,
  parseInvoiceAmount,
  parseInvoiceCategories,
  pickDefaultCompanyId,
  resolveInvoiceReason,
  resolveInvoiceStatements,
  validateInvoiceAmount,
  validateInvoiceApply,
  validateInvoiceCompany,
  withInvoiceTokenRetry,
  type InvoiceApplyBody,
} from './invoice'

function body(patch: Partial<InvoiceApplyBody> = {}): InvoiceApplyBody {
  return {
    amount: 100,
    type: '企业',
    category: '全电电子普通发票',
    email: 'a@b.com',
    purchaser_name: '某某科技有限公司',
    purchaser_taxpayer_number: '91330100MA0000000X',
    purchaser_address: '',
    purchaser_phone: '',
    purchaser_bank: '',
    purchaser_bank_account: '',
    remark: '',
    ...patch,
  }
}

describe('发票状态', () => {
  it('statements 优先，缺失时按 state 映射', () => {
    expect(resolveInvoiceStatements({ statements: '审核未通过', state: 0 })).toBe('审核未通过')
    expect(resolveInvoiceStatements({ state: 0 })).toBe('待审核')
    expect(resolveInvoiceStatements({ state: 4 })).toBe('开票中')
    expect(resolveInvoiceStatements({ state: 1 })).toBe('已开票')
    expect(resolveInvoiceStatements({ state: 2 })).toBe('已作废')
    expect(resolveInvoiceStatements({ state: 3 })).toBe('已红冲')
    expect(resolveInvoiceStatements({ state: -1 })).toBe('开票失败')
    expect(resolveInvoiceStatements({ state: -9 })).toBe('放弃开票')
    expect(resolveInvoiceStatements({ state: 99 })).toBe('未知')
    expect(resolveInvoiceStatements(null)).toBe('待审核')
  })

  it('色调按文案归类，未知文案回落到 state', () => {
    expect(invoiceTone('待审核')).toBe('pending')
    expect(invoiceTone('开票中')).toBe('processing')
    expect(invoiceTone('已开票')).toBe('success')
    expect(invoiceTone('开票失败')).toBe('danger')
    expect(invoiceTone('已红冲')).toBe('muted')
    expect(invoiceTone('审核未通过')).toBe('muted')
    expect(invoiceTone('奇怪状态', 1)).toBe('success')
    expect(invoiceTone('奇怪状态', -1)).toBe('danger')
    expect(invoiceTone('奇怪状态')).toBe('muted')
  })

  it('原因：驳回 / 红冲拼 consoleReason，其他取 failMsg', () => {
    expect(resolveInvoiceReason({ statements: '审核未通过', failMsg: '', consoleReason: '抬头有误' })).toBe('抬头有误')
    expect(resolveInvoiceReason({ statements: '已红冲', failMsg: '退款', consoleReason: '客户申请' })).toBe('退款 客户申请')
    expect(resolveInvoiceReason({ statements: '开票失败', failMsg: '税号不存在', consoleReason: '' })).toBe('税号不存在')
    expect(invoiceShowsReason({ statements: '开票失败', failMsg: '税号不存在', consoleReason: '' })).toBe(true)
    expect(invoiceShowsReason({ statements: '已开票', failMsg: 'x', consoleReason: '' })).toBe(false)
    expect(invoiceShowsReason({ statements: '开票失败', failMsg: '', consoleReason: '' })).toBe(false)
  })

  it('mapInvoiceRecord 兼容字段并补状态文案', () => {
    const r = mapInvoiceRecord({
      invoiceId: 12,
      outOrderNo: 'TV123',
      state: -1,
      addTime: '2026-09-01T10:20:30.000+08:00',
      price: '99.5',
      tax: 0.99,
      electronicInvoiceUrl: 'https://x/a.pdf',
      invoiceItems: [{ name: '技术服务费', sum: '99.5', taxRate: 0.01 }],
    })
    expect(r.id).toBe('12')
    expect(r.statements).toBe('开票失败')
    expect(r.addTime).toBe('2026-09-01 10:20:30')
    expect(r.price).toBe(99.5)
    expect(r.downloadUrl).toBe('https://x/a.pdf')
    expect(r.items[0]?.sum).toBe(99.5)
    expect(invoiceNumbers({ code: '', number: '001', allElectronicInvoiceNumber: '001' })).toEqual(['001'])
  })
})

describe('票种', () => {
  it('识别专用发票', () => {
    expect(isSpecialInvoiceCategory('增值税专用发票')).toBe(true)
    expect(isSpecialInvoiceCategory('增值税电子专用发票')).toBe(true)
    expect(isSpecialInvoiceCategory('全电电子专用发票')).toBe(true)
    expect(isSpecialInvoiceCategory('数电专用发票')).toBe(true)
    expect(isSpecialInvoiceCategory('专票')).toBe(true)
    expect(isSpecialInvoiceCategory('全电电子普通发票')).toBe(false)
    expect(isSpecialInvoiceCategory('增值税普通发票')).toBe(false)
    expect(isSpecialInvoiceCategory('')).toBe(false)
    expect(isSpecialInvoiceCategory(undefined)).toBe(false)
  })

  it('简称', () => {
    expect(invoiceCategoryShort('全电电子普通发票')).toBe('数电普')
    expect(invoiceCategoryShort('其他发票')).toBe('其他发票')
  })

  it('解析 h5_pc_invoice_categories', () => {
    const res = { code: 1, content: [{ fieldKey: 'h5_pc_invoice_categories', fieldValue: '["全电电子普通发票","全电电子专用发票","全电电子普通发票"]' }] }
    expect(parseInvoiceCategories(res)).toEqual(['全电电子普通发票', '全电电子专用发票'])
    expect(parseInvoiceCategories({ code: 1, content: [{ fieldKey: 'h5_pc_invoice_categories', fieldValue: 'oops' }] })).toEqual([])
    expect(parseInvoiceCategories({ code: 0, message: '暂无数据' })).toEqual([])
  })
})

describe('开票金额', () => {
  it('parse', () => {
    expect(parseInvoiceAmount('12.34')).toBe(12.34)
    expect(parseInvoiceAmount(5)).toBe(5)
    expect(parseInvoiceAmount('')).toBeNaN()
    expect(parseInvoiceAmount('-1')).toBeNaN()
    expect(parseInvoiceAmount('abc')).toBeNaN()
  })

  it('validate', () => {
    expect(validateInvoiceAmount('', 100)).toBe('empty')
    expect(validateInvoiceAmount('abc', 100)).toBe('invalid')
    expect(validateInvoiceAmount('-5', 100)).toBe('invalid')
    expect(validateInvoiceAmount('0', 100)).toBe('min')
    expect(validateInvoiceAmount('0.001', 100)).toBe('precision')
    expect(validateInvoiceAmount('0.01', 100)).toBeNull()
    expect(validateInvoiceAmount('100', 100)).toBeNull()
    expect(validateInvoiceAmount(100.01, 100)).toBe('exceed')
    // 浮点：0.1 + 0.2 这类可开票金额也按分比较
    expect(validateInvoiceAmount('0.3', 0.1 + 0.2)).toBeNull()
  })
})

describe('申请表单校验', () => {
  it('合法企业申请通过', () => {
    expect(validateInvoiceApply(body())).toBeNull()
  })

  it('个人抬头', () => {
    expect(validateInvoiceApply(body({ type: '个人', purchaser_name: '', purchaser_taxpayer_number: '' }))).toBe('请填写抬头名称')
    expect(validateInvoiceApply(body({ type: '个人', purchaser_name: '张三', purchaser_taxpayer_number: '' }))).toBeNull()
  })

  it('企业抬头需要名称与税号', () => {
    expect(validateInvoiceApply(body({ purchaser_name: '' }))).toBe('请选择或添加企业抬头')
    expect(validateInvoiceApply(body({ purchaser_taxpayer_number: ' ' }))).toBe('企业抬头需要填写税号')
  })

  it('专票需要企业税号', () => {
    expect(validateInvoiceApply(body({ category: '全电电子专用发票' }))).toBeNull()
    expect(validateInvoiceApply(body({ category: '全电电子专用发票', type: '个人', purchaser_taxpayer_number: '' }))).toBe('专用发票仅支持企业抬头')
  })

  it('票种、邮箱、备注、金额', () => {
    expect(validateInvoiceApply(body({ category: '' }))).toBe('请选择发票类型')
    expect(validateInvoiceApply(body({ email: '' }))).toBe('请填写接收邮箱')
    expect(validateInvoiceApply(body({ email: 'not-mail' }))).toBe('邮箱格式不正确')
    expect(validateInvoiceApply(body({ remark: 'a'.repeat(201) }))).toBe('备注最多 200 字')
    expect(validateInvoiceApply(body({ remark: 'a'.repeat(200) }))).toBeNull()
    expect(validateInvoiceApply(body({ amount: 0 }))).toBe('请输入正确的开票金额')
  })

  it('抬头表单', () => {
    expect(validateInvoiceCompany({ name: '', taxNumber: 'x' })).toBe('请填写抬头名称')
    expect(validateInvoiceCompany({ name: 'x', taxNumber: '' })).toBe('请填写税号')
    expect(validateInvoiceCompany({ name: 'x', taxNumber: 'y' })).toBeNull()
  })
})

describe('抬头', () => {
  it('默认选中 ifDefault，否则第一条，保留仍存在的当前选择', () => {
    const list = [
      mapInvoiceCompany({ companyId: 1, name: 'A', taxNumber: '1' }),
      mapInvoiceCompany({ companyId: 2, name: 'B', taxNumber: '2', ifDefault: true }),
    ]
    expect(pickDefaultCompanyId(list)).toBe(2)
    expect(pickDefaultCompanyId(list, 1)).toBe(1)
    expect(pickDefaultCompanyId(list, 9)).toBe(2)
    expect(pickDefaultCompanyId([list[0]!])).toBe(1)
    expect(pickDefaultCompanyId([])).toBeNull()
  })
})

describe('发票平台 accessToken', () => {
  it('识别过期与暂无数据', () => {
    expect(isInvoiceAccessTokenExpired({ code: -1, message: 'accessToken已过期' })).toBe(true)
    expect(isInvoiceAccessTokenExpired({ code: -1, message: 'access token expired' })).toBe(true)
    expect(isInvoiceAccessTokenExpired({ code: -1, message: '参数错误' })).toBe(false)
    expect(isInvoiceAccessTokenExpired(null)).toBe(false)
    expect(isInvoiceNoData({ code: 0, message: '暂无数据' })).toBe(true)
    expect(isInvoiceNoData({ code: -1, message: '暂无数据' })).toBe(true)
    expect(isInvoiceNoData({ code: 1 })).toBe(false)
  })

  it('过期时换新 token 重试一次', async () => {
    const request = vi.fn(async (token: string) => token === 'new'
      ? { code: 1, message: 'ok' }
      : { code: -1, message: 'accessToken已过期' })
    const refreshToken = vi.fn(async () => 'new')
    const res = await withInvoiceTokenRetry(request, { getToken: async () => 'old', refreshToken })
    expect(res).toEqual({ code: 1, message: 'ok' })
    expect(request).toHaveBeenCalledTimes(2)
    expect(refreshToken).toHaveBeenCalledTimes(1)
  })

  it('没拿到 token 返回 null；未过期不重试', async () => {
    const request = vi.fn(async () => ({ code: 1, message: '' }))
    expect(await withInvoiceTokenRetry(request, { getToken: async () => '', refreshToken: async () => '' })).toBeNull()
    expect(request).not.toHaveBeenCalled()
    await withInvoiceTokenRetry(request, { getToken: async () => 't', refreshToken: async () => 'x' })
    expect(request).toHaveBeenCalledTimes(1)
  })
})
