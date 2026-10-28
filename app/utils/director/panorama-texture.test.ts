import { describe, expect, it } from 'vitest'
import {
  EquirectangularReflectionMapping,
  ClampToEdgeWrapping,
  SRGBColorSpace,
  Texture,
} from 'three'
import {
  configurePanoramaTexture,
  getEffectiveGroundOpacity,
  getPanoramaRadius,
  getPanoramaRotationRadians,
  MIN_PANORAMA_RADIUS,
} from './panorama-texture'

describe('getPanoramaRotationRadians', () => {
  it('yaw 为 0 时补 90 度 —— 全景图的正前方和三的默认朝向差这么多', () => {
    expect(getPanoramaRotationRadians(0)).toBeCloseTo(Math.PI / 2, 10)
  })

  it('转多少度就在 90 度基础上加多少', () => {
    expect(getPanoramaRotationRadians(30)).toBeCloseTo((120 * Math.PI) / 180, 10)
    expect(getPanoramaRotationRadians(-90)).toBeCloseTo(0, 10)
  })
})

describe('getEffectiveGroundOpacity', () => {
  it('没有全景时原样返回', () => {
    expect(getEffectiveGroundOpacity(0.8, false)).toBe(0.8)
  })

  it('有全景时压到上限，不然地面会在天空上糊一片灰', () => {
    expect(getEffectiveGroundOpacity(0.8, true)).toBe(0.1)
  })

  it('本来就比上限低时不动它', () => {
    expect(getEffectiveGroundOpacity(0.05, true)).toBe(0.05)
  })
})

describe('getPanoramaRadius', () => {
  it('太小的半径会让相机穿到球外面，夹住', () => {
    expect(getPanoramaRadius(1)).toBe(MIN_PANORAMA_RADIUS)
    expect(getPanoramaRadius(-5)).toBe(MIN_PANORAMA_RADIUS)
  })

  it('正常半径原样返回', () => {
    expect(getPanoramaRadius(60)).toBe(60)
  })
})

describe('configurePanoramaTexture', () => {
  it('equirectangular：交给渲染器做球面映射，不翻转', () => {
    const texture = configurePanoramaTexture(new Texture(), 'equirectangular')

    expect(texture.mapping).toBe(EquirectangularReflectionMapping)
    expect(texture.repeat.x).toBe(1)
    expect(texture.offset.x).toBe(0)
    expect(texture.colorSpace).toBe(SRGBColorSpace)
  })

  it('backdrop：横向翻一次，因为是从球内侧往外看', () => {
    const texture = configurePanoramaTexture(new Texture(), 'backdrop')

    expect(texture.repeat.x).toBe(-1)
    expect(texture.offset.x).toBe(1)
    expect(texture.wrapS).toBe(ClampToEdgeWrapping)
  })

  it('不传投影方式时按 equirectangular 处理', () => {
    expect(configurePanoramaTexture(new Texture()).mapping).toBe(EquirectangularReflectionMapping)
  })

  it('配完标记 needsUpdate，否则改动不会生效', () => {
    // Texture 的 needsUpdate 是个只写属性，读它恒为 false，所以看版本号
    const texture = new Texture()
    const before = texture.version
    configurePanoramaTexture(texture, 'backdrop')
    expect(texture.version).toBeGreaterThan(before)
  })
})
