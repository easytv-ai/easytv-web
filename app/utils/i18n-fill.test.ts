import { describe, expect, it } from 'vitest'
import { fillI18n } from './i18n-fill'

describe('fillI18n', () => {
  it('把槽位换成数字', () => {
    expect(fillI18n('30 秒内 {a} 积分', { a: 12 })).toBe('30 秒内 12 积分')
  })

  it('已经插过值的不再改', () => {
    expect(fillI18n('30 秒内 12 积分', { a: 99 })).toBe('30 秒内 12 积分')
  })

  it('{cap} 被编译成 {capper} 时也能填', () => {
    expect(fillI18n('上限 {capper} 积分', { cap: 500 })).toBe('上限 500 积分')
  })

  it('{n} 也能换成数字', () => {
    expect(fillI18n('一共生成 {n} 条', { n: 6 })).toBe('一共生成 6 条')
    expect(fillI18n('角色 {n} 张', { n: 2 })).toBe('角色 2 张')
  })
})
