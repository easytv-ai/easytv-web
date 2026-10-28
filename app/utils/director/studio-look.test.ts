import { describe, expect, it } from 'vitest'
import {
  DIRECTOR_STUDIO_DARK,
  DIRECTOR_STUDIO_LIGHT,
  isThemeLinkedBackground,
  resolveDirectorStudioLook,
} from './studio-look'

describe('isThemeLinkedBackground', () => {
  it('默认黑和空值跟着主题走', () => {
    expect(isThemeLinkedBackground('#000000')).toBe(true)
    expect(isThemeLinkedBackground('#000')).toBe(true)
    expect(isThemeLinkedBackground('')).toBe(true)
    expect(isThemeLinkedBackground(null)).toBe(true)
  })

  it('用户选过的颜色不跟主题', () => {
    expect(isThemeLinkedBackground('#1d4ed8')).toBe(false)
    expect(isThemeLinkedBackground('#e4e4e7')).toBe(false)
  })
})

describe('resolveDirectorStudioLook', () => {
  it('默认天空按亮暗主题换影棚色', () => {
    expect(resolveDirectorStudioLook(true, '#000000').sky).toBe(DIRECTOR_STUDIO_DARK.sky)
    expect(resolveDirectorStudioLook(false, '#000000').sky).toBe(DIRECTOR_STUDIO_LIGHT.sky)
    expect(resolveDirectorStudioLook(false, '#000000').ground).toBe(DIRECTOR_STUDIO_LIGHT.ground)
  })

  it('自定义天空只改天，地面仍跟主题', () => {
    const look = resolveDirectorStudioLook(false, '#88aaff')
    expect(look.sky).toBe('#88aaff')
    expect(look.ground).toBe(DIRECTOR_STUDIO_LIGHT.ground)
  })

  it('机位线色跟着亮暗主题走，亮底用深色', () => {
    expect(resolveDirectorStudioLook(false).cameraLine).toBe(DIRECTOR_STUDIO_LIGHT.cameraLine)
    expect(resolveDirectorStudioLook(true).cameraLine).toBe(DIRECTOR_STUDIO_DARK.cameraLine)
  })
})
