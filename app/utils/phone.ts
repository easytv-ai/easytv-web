/** 中国大陆 11 位手机号：1 开头，第二位 3–9 */
export const CN_MOBILE_RE = /^1[3-9]\d{9}$/

export function digitsOnly(value: string, maxLen?: number): string {
  const digits = String(value ?? '').replace(/\D/g, '')
  return maxLen != null ? digits.slice(0, maxLen) : digits
}

export function normalizeMobile(value: string): string {
  return digitsOnly(value, 11)
}

export function isValidCnMobile(value: string): boolean {
  return CN_MOBILE_RE.test(normalizeMobile(value))
}

/** 校验通过返回 null，否则返回错误文案 */
export function cnMobileError(value: string): string | null {
  const mobile = normalizeMobile(value)
  if (!mobile)
    return '请输入手机号'
  if (!CN_MOBILE_RE.test(mobile))
    return '请输入11位有效手机号'
  return null
}
