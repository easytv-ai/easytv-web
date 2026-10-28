/**
 * 登录态标记 cookie：只写「已登录」这一位，不放令牌。
 * 令牌与用户信息仍在 localStorage；这个 cookie 让服务端渲染时也知道该出创作台外壳还是落地页，
 * 避免首页服务端按未登录渲染、客户端再跳创作台造成的 hydration 错位。
 */
export const AUTH_SESSION_COOKIE = 'easytv_session'

/**
 * 登录标记是否有效。useCookie 会把 "1" 解析成数字，所以不要用 === '1'。
 * 没有这个标记时，服务端应把受保护页直接送到登录页，避免先画出页面再跳走。
 */
export function hasAuthSessionMarker(value: unknown) {
  return String(value ?? '') === '1'
}

const MAX_AGE = 60 * 60 * 24 * 30

/** 客户端写入 / 清除登录标记（不依赖 Nuxt 上下文，setUser 在事件回调里也能调） */
export function writeAuthSessionCookie(loggedIn: boolean) {
  if (!import.meta.client || typeof document === 'undefined')
    return
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = loggedIn
    ? `${AUTH_SESSION_COOKIE}=1; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax${secure}`
    : `${AUTH_SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`
}
