import { describe, expect, it } from 'vitest'
import { isStudioAdmin, normalizeManageUrl, resolveNoModelsHint } from './canvas-no-models'

describe('模型清单为空时的提示对象', () => {
  it('未登录与普通用户看到联系运营的提示，不带后台链接', () => {
    expect(resolveNoModelsHint(null, 'http://localhost:3006')).toEqual({ audience: 'user', manageUrl: '' })
    expect(resolveNoModelsHint({ role: 1 }, 'http://localhost:3006')).toEqual({ audience: 'user', manageUrl: '' })
    expect(resolveNoModelsHint({}, 'http://localhost:3006')).toEqual({ audience: 'user', manageUrl: '' })
  })

  it('管理员与超级管理员看到去后台配置的入口', () => {
    expect(resolveNoModelsHint({ role: 10 }, 'http://localhost:3006')).toEqual({ audience: 'admin', manageUrl: 'http://localhost:3006' })
    expect(resolveNoModelsHint({ role: 100 }, 'http://localhost:3006/')).toEqual({ audience: 'admin', manageUrl: 'http://localhost:3006' })
  })

  it('后台代登的会话不算管理员', () => {
    expect(isStudioAdmin({ role: 100, console_access: true })).toBe(false)
    expect(resolveNoModelsHint({ role: 100, console_access: true }, 'http://localhost:3006')).toEqual({ audience: 'user', manageUrl: '' })
  })

  it('角色字段是字符串数字时照样识别，非数字不算管理员', () => {
    expect(isStudioAdmin({ role: '10' })).toBe(true)
    expect(isStudioAdmin({ role: 'admin' })).toBe(false)
    expect(isStudioAdmin({ role: 9 })).toBe(false)
  })

  it('没有配置后台地址时管理员只有文案没有链接', () => {
    expect(resolveNoModelsHint({ role: 10 }, '')).toEqual({ audience: 'admin', manageUrl: '' })
    expect(resolveNoModelsHint({ role: 10 }, undefined)).toEqual({ audience: 'admin', manageUrl: '' })
  })

  it('后台地址只接受 http(s)，并去掉末尾斜杠', () => {
    expect(normalizeManageUrl(' https://manage.example.test/// ')).toBe('https://manage.example.test')
    expect(normalizeManageUrl('http://localhost:3006/console')).toBe('http://localhost:3006/console')
    expect(normalizeManageUrl('javascript:alert(1)')).toBe('')
    expect(normalizeManageUrl('localhost:3006')).toBe('')
    expect(normalizeManageUrl('http://')).toBe('')
  })
})
