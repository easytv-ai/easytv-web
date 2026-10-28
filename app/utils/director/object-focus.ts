/**
 * 对象的对焦点（复刻自 open-director 的 schema/cameraTarget.ts，MIT）。
 *
 * 机位锁定某个对象时，注视的不是它的原点（那在脚底），而是身体或体积的中部。
 * 这里算的就是那个点。
 *
 * 角色的高度来自 runtime 的体型表，那部分还没搬，所以做成可注入：
 * 传了 labelYOf 就用真实体型高度，没传就退到一个通用值。等 runtime 搬完之后
 * 由上层统一注入，这里不留假数据。
 */
import { Euler, Vector3 } from 'three'
import type { DirectorObject, GeometryPrimitiveType } from './schema'

/** 没有体型表时角色的兜底对焦高度（大致是成年人腰腹的位置） */
const DEFAULT_CHARACTER_FOCUS_OFFSET_Y = 0.9

/** 导入的模型形状未知，统一按 1 米高对焦 */
const IMPORTED_MODEL_FOCUS_OFFSET_Y = 1

/** 各基础几何体的对焦高度，按它们自身的形状定 */
const GEOMETRY_FOCUS_OFFSET_Y: Record<GeometryPrimitiveType, number> = {
  box: 0.5,
  sphere: 0.55,
  cylinder: 0.6,
  torus: 0.14,
  cone: 0.55,
  pyramid: 0.55,
}

/** 角色体型 → 头顶标签高度的查找函数，由 runtime 层提供 */
export type LabelYLookup = (bodyType: string | null | undefined, rigType: string | undefined) => number | null

/** 机位能锁定的对象：看不见的、机位本身和全景都不算 */
export function isCameraFocusableObject(object: DirectorObject) {
  return object.visible && object.kind !== 'camera' && object.kind !== 'panorama'
}

/** 场景树里那台机位对象锁了：属性 / 时间线 / 路径都不能改它 */
export function isLinkedCameraLocked(objects: DirectorObject[], cameraId?: string | null) {
  if (!cameraId)
    return false
  return Boolean(objects.find(item => item.linkedCameraId === cameraId)?.locked)
}

export function getDirectorObjectFocusOffsetY(object: DirectorObject, labelYOf?: LabelYLookup) {
  if (object.assetRefId)
    return IMPORTED_MODEL_FOCUS_OFFSET_Y

  if (object.kind === 'character') {
    const labelY = labelYOf?.(object.bodyType, object.characterRig?.rigType) ?? null
    // 标签浮在头顶，取一半大致就是身体中部
    return labelY === null ? DEFAULT_CHARACTER_FOCUS_OFFSET_Y : labelY / 2
  }

  if (object.geometryType)
    return GEOMETRY_FOCUS_OFFSET_Y[object.geometryType]

  return IMPORTED_MODEL_FOCUS_OFFSET_Y
}

function roundTuple(vector: Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z].map(value => Number(value.toFixed(6))) as [number, number, number]
}

/**
 * 对焦点 = 对象位置 + 偏移，偏移要先跟着对象自身的缩放和旋转走，
 * 否则被放大或转倒的角色，机位会瞄到身体外面去。
 */
export function getDirectorObjectFocusTarget(
  object: DirectorObject,
  labelYOf?: LabelYLookup,
): [number, number, number] {
  const [scaleX, scaleY, scaleZ] = object.transform.scale
  const offset = new Vector3(0, getDirectorObjectFocusOffsetY(object, labelYOf), 0)
    .multiply(new Vector3(scaleX, scaleY, scaleZ))
    .applyEuler(new Euler(...object.transform.rotation))

  return roundTuple(new Vector3(...object.transform.position).add(offset))
}
