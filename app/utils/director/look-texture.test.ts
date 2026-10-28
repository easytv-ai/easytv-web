import { describe, expect, it } from 'vitest'
import { lookTextureNeedsCors } from './look-texture'

describe('lookTextureNeedsCors', () => {
  it('blob 和 data 不当跨域', () => {
    expect(lookTextureNeedsCors('blob:http://localhost/1', 'http://localhost:3005')).toBe(false)
    expect(lookTextureNeedsCors('data:image/png;base64,xx', 'http://localhost:3005')).toBe(false)
  })

  it('同源不当跨域', () => {
    expect(lookTextureNeedsCors('http://localhost:3005/a.jpg', 'http://localhost:3005')).toBe(false)
    expect(lookTextureNeedsCors('/images/a.jpg', 'http://localhost:3005')).toBe(false)
  })

  it('资产库地址要走跨域', () => {
    expect(lookTextureNeedsCors('https://tv-api.easyapi.com/upload/a.jpg', 'http://localhost:3005')).toBe(true)
  })
})
