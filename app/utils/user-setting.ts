/** 解析 GET /user/self 返回的 setting JSON（可能是字符串或对象）。 */
export function parseUserSetting(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw))
    return { ...(raw as Record<string, unknown>) }
  if (typeof raw !== 'string' || !raw.trim())
    return {}
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      return parsed as Record<string, unknown>
  }
  catch {
    // 非 JSON 的历史数据忽略
  }
  return {}
}

export function readSettingAvatar(raw: unknown, fallback = ''): string {
  const direct = fallback.trim()
  const fromSetting = String(parseUserSetting(raw).avatar ?? '').trim()
  return fromSetting || direct
}

export function writeSettingAvatar(raw: unknown, avatar: string): string {
  return JSON.stringify({ ...parseUserSetting(raw), avatar })
}
