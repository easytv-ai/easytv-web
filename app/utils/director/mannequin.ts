/**
 * UE4 素体模型的加载与整备（复刻自 open-director 的 runtime/UE4MannequinModel.tsx，MIT）。
 *
 * 模型本身是一份 glb，多个角色共用同一次加载结果，各自克隆一套骨架 ——
 * 直接复用同一个实例的话，一个角色摆姿势会把所有角色一起带动。
 *
 * 模型与授权见 public/director-assets/（Sketchfab Standard，署名须保留）。
 */
import { Box3, Color, Matrix4, Mesh, MeshStandardMaterial, Vector2, Vector3 } from 'three'
import type { Group, Material, Object3D, SkinnedMesh, Texture, WebGLProgramParametersWithUniforms } from 'three'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { CharacterBodyType } from './schema'

export const MANNEQUIN_MODEL_URL = '/director-assets/ue-mannequin.glb'

/** 胸口那块 logo 材质保留原样，染色会把它糊掉 */
const CHEST_LOGO_MATERIAL = 'SK_Mannequin_M_UE4Man_ChestLogo'
export const LOOK_PLATE_NAME = 'director-look-plate'

function isSkinnedMesh(object: Object3D): object is SkinnedMesh {
  return 'isSkinnedMesh' in object && (object as { isSkinnedMesh?: boolean }).isSkinnedMesh === true
}

function cloneMaterial(material: Material | Material[]) {
  return Array.isArray(material) ? material.map(item => item.clone()) : material.clone()
}

function tint(material: Material | Material[], color: string) {
  const list = Array.isArray(material) ? material : [material]
  const next = new Color(color)

  for (const item of list) {
    if (item instanceof MeshStandardMaterial && item.name !== CHEST_LOGO_MATERIAL) {
      item.color.copy(next)
      item.roughness = 0.68
      item.metalness = 0.04
      item.needsUpdate = true
    }
  }
}

/**
 * 按对象配色给模型上色。
 * 材质要先克隆一份再改：glb 里的材质是共享的，直接改会让所有角色变成同一个颜色。
 */
export function tintMannequin(scene: Object3D, color: string) {
  scene.traverse((object) => {
    // 骨骼动起来之后包围盒会失真，关掉视锥剔除免得角色在画面边缘凭空消失
    object.frustumCulled = false

    if (isSkinnedMesh(object)) {
      object.castShadow = true
      object.receiveShadow = true

      if (!object.userData.isolatedMaterial) {
        object.material = cloneMaterial(object.material)
        object.userData.isolatedMaterial = true
      }
      tint(object.material, color)
    }
  })
}

/** 物体在父级局部坐标系里的包围盒 */
function getBoundsInParentLocal(object: Object3D) {
  ;(object.parent ?? object).updateMatrixWorld(true)

  const worldBounds = new Box3().setFromObject(object, true)
  if (!object.parent || worldBounds.isEmpty())
    return worldBounds

  const parentInverse = new Matrix4().copy(object.parent.matrixWorld).invert()
  const bounds = new Box3().makeEmpty()
  const vertex = new Vector3()

  for (const x of [worldBounds.min.x, worldBounds.max.x]) {
    for (const y of [worldBounds.min.y, worldBounds.max.y]) {
      for (const z of [worldBounds.min.z, worldBounds.max.z]) {
        bounds.expandByPoint(vertex.set(x, y, z).applyMatrix4(parentInverse))
      }
    }
  }

  return bounds
}

/**
 * 把模型压到地面上。
 *
 * 迭代几次：挪动模型会改变它的世界矩阵，包围盒跟着变，一次算不准 ——
 * 摆了姿势之后尤其明显（抬腿会让最低点从脚底变成另一只脚）。
 * 收敛得很快，五次是留足余量。
 */
export function alignMannequinToGround(scene: Object3D) {
  const { x, z } = scene.position
  scene.position.set(x, 0, z)

  for (let attempt = 0; attempt < 5; attempt++) {
    const bounds = getBoundsInParentLocal(scene)
    const correction = bounds.isEmpty() || !Number.isFinite(bounds.min.y) ? 0 : -bounds.min.y
    if (Math.abs(correction) < 0.00001)
      break
    scene.position.set(x, scene.position.y + correction, z)
  }

  ;(scene.parent ?? scene).updateMatrixWorld(true)
  return scene.position.y
}

/** 体型靠整体缩放模拟，成年的几种共用原尺寸 */
export function getMannequinScale(bodyType?: CharacterBodyType): [number, number, number] {
  if (bodyType === 'teen')
    return [0.88, 0.88, 0.88]
  if (bodyType === 'child')
    return [0.72, 0.72, 0.72]
  if (bodyType === 'chibi')
    return [0.56, 0.56, 0.56]
  return [1, 1, 1]
}

/** 克隆一套独立的骨架，供单个角色使用 */
export function cloneMannequin(source: Group): Group {
  return cloneSkeleton(source) as Group
}

function disposePlate(plate: Mesh) {
  plate.geometry.dispose()
  const material = plate.material
  if (Array.isArray(material))
    material.forEach(item => item.dispose())
  else
    material.dispose()
}

function isMesh(object: Object3D): object is Mesh {
  return 'isMesh' in object && (object as Mesh).isMesh === true
}

/** 素体包围盒（场景局部坐标），不算以前那张悬浮牌 */
export function getMannequinBodyBounds(scene: Object3D) {
  scene.updateMatrixWorld(true)
  const world = new Box3()
  scene.traverse((object) => {
    if (object.name === LOOK_PLATE_NAME || !isMesh(object))
      return
    world.expandByObject(object, true)
  })

  if (world.isEmpty())
    return world

  const local = new Box3()
  const vertex = new Vector3()
  const inverse = new Matrix4().copy(scene.matrixWorld).invert()
  for (const x of [world.min.x, world.max.x]) {
    for (const y of [world.min.y, world.max.y]) {
      for (const z of [world.min.z, world.max.z])
        local.expandByPoint(vertex.set(x, y, z).applyMatrix4(inverse))
    }
  }
  return local
}

export function getLookProjectionLayout(scene: Object3D) {
  const bounds = getMannequinBodyBounds(scene)
  if (bounds.isEmpty()) {
    return {
      center: [0, 1.35, 0] as [number, number, number],
      size: [0.72, 0.9] as [number, number],
    }
  }

  const height = Math.max(bounds.max.y - bounds.min.y, 1.1)
  return {
    center: [
      (bounds.min.x + bounds.max.x) / 2,
      bounds.min.y + height * 0.72,
      (bounds.min.z + bounds.max.z) / 2,
    ] as [number, number, number],
    size: [
      Math.max(height * 0.42, 0.55),
      Math.max(height * 0.52, 0.7),
    ] as [number, number],
  }
}

/** 绕身体水平转角的淡出，和贴图着色器共用。过了侧面就不再出图。 */
const LOOK_YAW_FADE = [1.05, 1.5] as const
/** 朝前法线的淡出。背面法线为负，权重是 0。 */
const LOOK_FRONT_FADE = [0, 0.35] as const

function smoothstep(edge0: number, edge1: number, x: number) {
  const span = edge1 - edge0
  if (span === 0)
    return x < edge0 ? 0 : 1
  const t = Math.min(1, Math.max(0, (x - edge0) / span))
  return t * t * (3 - 2 * t)
}

/**
 * 形象贴在正面曲面上的采样。
 * 水平方向按绕身体的转角展开，竖直方向仍是上半身那一截。
 * 背面转角超出半圈，或者法线朝后，权重为 0。
 */
export function lookSurfaceUv(
  point: readonly [number, number, number],
  normalZ: number,
  center: readonly [number, number, number],
  height: number,
) {
  const yaw = Math.atan2(point[0] - center[0], point[2] - center[2])
  const u = yaw / Math.PI + 0.5
  const v = (point[1] - center[1]) / height + 0.5
  const inside = u >= 0 && u <= 1 && v >= 0 && v <= 1
  const around = 1 - smoothstep(LOOK_YAW_FADE[0], LOOK_YAW_FADE[1], Math.abs(yaw))
  const front = smoothstep(LOOK_FRONT_FADE[0], LOOK_FRONT_FADE[1], normalZ)
  return { u, v, yaw, weight: inside ? around * front : 0 }
}

const LOOK_PROGRAM_KEY = 'director-look-v2'

interface LookUniforms {
  uLookMap: { value: Texture | null }
  uLookCenter: { value: Vector3 }
  uLookSize: { value: Vector2 }
}

function eachStandardMaterial(scene: Object3D, fn: (material: MeshStandardMaterial) => void) {
  scene.traverse((object) => {
    if (!isMesh(object))
      return
    const list = Array.isArray(object.material) ? object.material : [object.material]
    for (const item of list) {
      if (item instanceof MeshStandardMaterial)
        fn(item)
    }
  })
}

function compileLookShader(shader: WebGLProgramParametersWithUniforms, uniforms: LookUniforms) {
  shader.uniforms.uLookMap = uniforms.uLookMap
  shader.uniforms.uLookCenter = uniforms.uLookCenter
  shader.uniforms.uLookSize = uniforms.uLookSize
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vLookPos;\nvarying vec3 vLookNormal;')
    .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvLookNormal = objectNormal;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLookPos = position;')
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
uniform sampler2D uLookMap;
uniform vec3 uLookCenter;
uniform vec2 uLookSize;
varying vec3 vLookPos;
varying vec3 vLookNormal;`,
    )
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
{
  vec3 lookDelta = vLookPos - uLookCenter;
  float yaw = atan(lookDelta.x, lookDelta.z);
  vec2 lookUv = vec2(yaw / 3.14159265 + 0.5, lookDelta.y / uLookSize.y + 0.5);
  float inside = step(0.0, lookUv.x) * step(lookUv.x, 1.0) * step(0.0, lookUv.y) * step(lookUv.y, 1.0);
  if (inside > 0.0) {
    vec4 lookTex = texture2D(uLookMap, lookUv);
    float edge = smoothstep(0.0, 0.06, lookUv.x) * smoothstep(1.0, 0.94, lookUv.x)
      * smoothstep(0.0, 0.06, lookUv.y) * smoothstep(1.0, 0.94, lookUv.y);
    float around = 1.0 - smoothstep(${LOOK_YAW_FADE[0]}, ${LOOK_YAW_FADE[1]}, abs(yaw));
    float front = smoothstep(${LOOK_FRONT_FADE[0]}, ${LOOK_FRONT_FADE[1]}, vLookNormal.z);
    diffuseColor.rgb = mix(diffuseColor.rgb, lookTex.rgb, edge * around * front * lookTex.a);
  }
}`,
    )
}

function applyLookMaterial(material: MeshStandardMaterial, texture: Texture, layout: ReturnType<typeof getLookProjectionLayout>) {
  const existing = material.userData.directorLook as LookUniforms | undefined
  if (existing?.uLookCenter.value instanceof Vector3) {
    existing.uLookMap.value = texture
    existing.uLookCenter.value.set(...layout.center)
    existing.uLookSize.value.set(...layout.size)
    return
  }

  const uniforms: LookUniforms = {
    uLookMap: { value: texture },
    uLookCenter: { value: new Vector3(...layout.center) },
    uLookSize: { value: new Vector2(...layout.size) },
  }
  material.userData.directorLook = uniforms
  material.onBeforeCompile = shader => compileLookShader(shader, uniforms)
  material.customProgramCacheKey = () => LOOK_PROGRAM_KEY
  material.needsUpdate = true
}

function clearLookMaterial(material: MeshStandardMaterial) {
  if (!material.userData.directorLook)
    return
  delete material.userData.directorLook
  material.onBeforeCompile = () => {}
  material.customProgramCacheKey = () => ''
  material.needsUpdate = true
}

function stripLegacyLookPlate(scene: Object3D) {
  const existing = scene.getObjectByName(LOOK_PLATE_NAME) as Mesh | undefined
  if (!existing)
    return
  existing.parent?.remove(existing)
  disposePlate(existing)
}

/**
 * 把形象图贴到素体正面曲面的上半身。背面不再印同一张，也不再单独挂一张牌。
 */
export function setMannequinLookPlate(scene: Object3D, texture: Texture | null) {
  stripLegacyLookPlate(scene)
  if (!texture) {
    eachStandardMaterial(scene, clearLookMaterial)
    return
  }

  const layout = getLookProjectionLayout(scene)
  eachStandardMaterial(scene, material => applyLookMaterial(material, texture, layout))
}
