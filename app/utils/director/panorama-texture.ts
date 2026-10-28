/**
 * 全景纹理的参数与朝向（复刻自 open-director 的 ViewportBackground.tsx
 * 与 panoramaMath.ts，MIT）。
 *
 * 两种投影方式的纹理参数完全不同，混用会得到一张左右翻转或接缝对不上的天空，
 * 所以这几行单独抽出来测。
 */
import {
  BackSide,
  ClampToEdgeWrapping,
  EquirectangularReflectionMapping,
  LinearFilter,
  SRGBColorSpace,
  type Texture,
} from 'three'
import type { PanoramaProjectionMode } from './schema'

export { BackSide }

/** 全景图的正前方和三的默认朝向差 90 度，不补这一下导入后画面会侧过来 */
const FORWARD_ALIGNMENT_DEGREES = 90

/** 有全景时地面必须压得很淡，否则会在天空上糊一大片灰 */
const GROUND_OPACITY_CAP = 0.1

/** 球半径下限：比这更小的话相机会穿到球外面，天空直接消失 */
export const MIN_PANORAMA_RADIUS = 10

export function getPanoramaRotationRadians(yaw: number): number {
  return ((yaw + FORWARD_ALIGNMENT_DEGREES) * Math.PI) / 180
}

export function getEffectiveGroundOpacity(baseOpacity: number, hasPanorama: boolean): number {
  if (!hasPanorama)
    return baseOpacity
  return Math.min(baseOpacity, GROUND_OPACITY_CAP)
}

export function getPanoramaRadius(radius: number): number {
  return Math.max(MIN_PANORAMA_RADIUS, radius)
}

/**
 * 按投影方式配好纹理。
 *
 * equirectangular 交给渲染器当环境贴图，三自己会做球面映射；
 * backdrop 是我们自己画一个内翻的球，贴图要横向翻一次（repeat.x = -1），
 * 因为从球内侧看出去左右是反的。
 */
export function configurePanoramaTexture(
  texture: Texture,
  projectionMode: PanoramaProjectionMode = 'equirectangular',
): Texture {
  texture.colorSpace = SRGBColorSpace

  if (projectionMode === 'equirectangular') {
    texture.mapping = EquirectangularReflectionMapping
    texture.repeat.set(1, 1)
    texture.offset.set(0, 0)
  }
  else {
    // 夹到边缘：重复采样会让极点附近出现一圈鬼影
    texture.wrapS = ClampToEdgeWrapping
    texture.wrapT = ClampToEdgeWrapping
    texture.minFilter = LinearFilter
    texture.magFilter = LinearFilter
    texture.repeat.set(-1, 1)
    texture.offset.set(1, 0)
  }

  texture.needsUpdate = true
  return texture
}
