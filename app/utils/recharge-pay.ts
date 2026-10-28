import type { PayIntent, RechargePayMethod, RechargePayResult } from '~/types/creative'

export const RECHARGE_TRADE_KEY = 'easytv-recharge-trade'
const RECHARGE_EXPIRE_SEC = 15 * 60

export function rememberRechargeTrade(tradeNo: string) {
  if (!import.meta.client || !tradeNo)
    return
  sessionStorage.setItem(RECHARGE_TRADE_KEY, tradeNo)
}

export function readRechargeTrade() {
  if (!import.meta.client)
    return ''
  return sessionStorage.getItem(RECHARGE_TRADE_KEY)?.trim() || ''
}

export function clearRechargeTrade() {
  if (!import.meta.client)
    return
  sessionStorage.removeItem(RECHARGE_TRADE_KEY)
}

export function toRechargePayIntent(res: RechargePayResult, method: RechargePayMethod): PayIntent {
  return {
    payment_method: method,
    code_url: res.code_url || '',
    qr_code: res.qr_code,
    payment_url: res.payment_url,
    trade_no: res.trade_no,
    expires_at: Math.floor(Date.now() / 1000) + RECHARGE_EXPIRE_SEC,
  }
}

export function payQrContent(pay: PayIntent | null | undefined) {
  return String(pay?.code_url || pay?.qr_code || '').trim()
}

/** 电脑网站支付：新窗口打开，当前页不动。noopener 不能写在 window.open 特性里，否则成功也会返回 null。 */
export function openPayPage(url: string) {
  const href = String(url || '').trim()
  if (!href || !import.meta.client)
    return false
  const win = window.open(href, '_blank')
  if (win)
    win.opener = null
  return Boolean(win)
}

export function isPagePay(pay: PayIntent | null | undefined) {
  return Boolean(pay?.payment_url) && !payQrContent(pay)
}

export function payMethodLabel(method: string, t: (key: string) => string) {
  if (method === 'alipay_f2f' || method === 'alipay_pc')
    return t('支付宝')
  if (method === 'wechat_native')
    return t('微信')
  return method || t('支付')
}

export function payMethodBrand(method: string) {
  if (method === 'wechat_native')
    return 'wechat'
  if (method.startsWith('alipay'))
    return 'alipay'
  return 'other'
}

export function payMethodHint(method: string, t: (key: string) => string) {
  if (method === 'alipay_pc')
    return t('电脑网站支付')
  return t('扫码支付')
}
