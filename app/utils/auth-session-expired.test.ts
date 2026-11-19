import { describe, expect, it } from 'vitest'
import { isSessionExpiredResponse } from './auth-session-expired'

describe('登录凭证失效', () => {
  it('带 invalid_token 的响应要退出重登，不能当成普通 message 错误', () => {
    expect(isSessionExpiredResponse({
      success: false,
      message: '无效的登录凭证',
      data: null,
      code: 'invalid_token',
    })).toBe(true)
  })

  it('只有一句 message、没有 code 的旧响应同样算失效', () => {
    expect(isSessionExpiredResponse({
      success: false,
      message: '无效的登录凭证',
    })).toBe(true)
  })

  it('普通业务失败不退出', () => {
    expect(isSessionExpiredResponse({
      success: false,
      message: '加载失败',
      data: null,
    })).toBe(false)
  })
})
