import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  isApiFailure,
  isLoginApiSuccess,
  parseStoredAuthUser,
  userFromLoginResponse,
} from './auth-login-parse'
import { hasAuthSessionMarker } from './auth-session-cookie'

describe('登录响应', () => {
  it('只有 success === true 算登录成功', () => {
    expect(isLoginApiSuccess({ success: true })).toBe(true)
    expect(isLoginApiSuccess({ success: false })).toBe(false)
    expect(isLoginApiSuccess({ success: 'true' })).toBe(false)
    expect(isLoginApiSuccess(null)).toBe(false)
    expect(isLoginApiSuccess(undefined)).toBe(false)
  })

  it('业务失败和 HTTP 4xx 算失败，空响应不算', () => {
    expect(isApiFailure(null)).toBe(false)
    expect(isApiFailure(undefined)).toBe(false)
    expect(isApiFailure({ error: true })).toBe(true)
    expect(isApiFailure({ statusCode: 401 })).toBe(true)
    expect(isApiFailure({ statusCode: 200, success: true })).toBe(false)
    expect(isApiFailure({ success: false })).toBe(true)
  })

  it('从 content.user 或 data 里取出 token，并写成 access_token 和 token', () => {
    const fromContent = userFromLoginResponse({
      success: true,
      content: { user: { id: 7, username: 'ada', access_token: 'tok-a' } },
    }, 'fallback')
    expect(fromContent.username).toBe('ada')
    expect(fromContent.id).toBe(7)
    expect(fromContent.access_token).toBe('tok-a')
    expect(fromContent.token).toBe('tok-a')

    const fromData = userFromLoginResponse({
      success: true,
      data: { username: 'bea', token: 'tok-b', user_id: 'u2' },
    }, 'fallback')
    expect(fromData.username).toBe('bea')
    expect(fromData.access_token).toBe('tok-b')
    expect(fromData.id).toBe('u2')

    const fromIdToken = userFromLoginResponse({
      success: true,
      data: { accessToken: 'tok-c' },
    }, 'mobile')
    expect(fromIdToken.username).toBe('mobile')
    expect(fromIdToken.access_token).toBe('tok-c')
  })

  it('没有用户名时用调用方给的回退名，空白 token 不当成已登录', () => {
    const user = userFromLoginResponse({ success: true, data: { access_token: '  ' } }, 'phone')
    expect(user.username).toBe('phone')
    expect(user.access_token).toBeUndefined()
  })
})

describe('本地登录信息', () => {
  it('坏 JSON、数组和空串都当成未登录', () => {
    expect(parseStoredAuthUser(null)).toBeNull()
    expect(parseStoredAuthUser('')).toBeNull()
    expect(parseStoredAuthUser('{')).toBeNull()
    expect(parseStoredAuthUser('[]')).toBeNull()
    expect(parseStoredAuthUser('"ada"')).toBeNull()
    expect(parseStoredAuthUser('{"username":"ada","access_token":"tok"}')?.access_token).toBe('tok')
  })
})

describe('登录标记 cookie', () => {
  it('字符串 1 和被 useCookie 转成的数字 1 都算已登录', () => {
    expect(hasAuthSessionMarker('1')).toBe(true)
    expect(hasAuthSessionMarker(1)).toBe(true)
    expect(hasAuthSessionMarker('0')).toBe(false)
    expect(hasAuthSessionMarker(null)).toBe(false)
    expect(hasAuthSessionMarker(undefined)).toBe(false)
    expect(hasAuthSessionMarker('')).toBe(false)
  })

  it('受保护页在服务端按登录标记决定，不再一律放行', () => {
    const src = readFileSync(new URL('../middleware/auth.ts', import.meta.url), 'utf8')
    expect(src).toContain('hasAuthSessionMarker')
    expect(src).not.toMatch(/if \(import\.meta\.server\)\s*return/)
  })
})
