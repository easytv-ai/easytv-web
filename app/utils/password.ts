export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 20
export const PASSWORD_LENGTH_HINT = `${PASSWORD_MIN}-${PASSWORD_MAX} 位`

/** 校验通过返回 null，否则返回错误文案 */
export function validatePasswordLength(password: string, label = '密码'): string | null {
  const len = password.length
  if (len < PASSWORD_MIN || len > PASSWORD_MAX)
    return `${label}长度为 ${PASSWORD_LENGTH_HINT}`
  return null
}
