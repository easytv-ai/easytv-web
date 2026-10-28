/**
 * 姿势控制量 → 骨骼旋转（复刻自 open-director 的 runtime/ue4Mannequin/，MIT）。
 *
 * 姿势预设里存的是 `leftShoulder.pitch: 20` 这种「人话」，这一层把它翻译成
 * 具体骨骼的欧拉角。每根骨骼的轴向都不一样 —— 模型导出时骨骼的朝向是固定的，
 * 所以哪个控制量对应哪个轴、正负号如何，只能一根根对，不能想当然。
 */
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import type { Bone, Object3D } from 'three'
import type { CharacterBodyType } from './schema'

/** 控制量名 → 模型里的骨骼名 */
export const BONE_MAP = {
  body: 'Bip001_Pelvis_03',
  torso: 'Bip001_Spine1_05',
  head: 'Bip001_Head_055',
  leftShoulder: 'Bip001_L_UpperArm_08',
  rightShoulder: 'Bip001_R_UpperArm_032',
  leftElbow: 'Bip001_L_Forearm_09',
  rightElbow: 'Bip001_R_Forearm_033',
  leftHand: 'Bip001_L_Hand_010',
  rightHand: 'Bip001_R_Hand_034',
  leftHip: 'Bip001_L_Thigh_057',
  rightHip: 'Bip001_R_Thigh_061',
  leftKnee: 'Bip001_L_Calf_058',
  rightKnee: 'Bip001_R_Calf_062',
  leftFoot: 'Bip001_L_Foot_059',
  rightFoot: 'Bip001_R_Foot_063',
} as const

export type BoneRotationMap = Record<string, [number, number, number]>

/** 骨骼的初始姿态，摆姿势前先还原到这里 */
export type RestPose = Record<string, {
  position: [number, number, number]
  quaternion: [number, number, number, number]
  scale: [number, number, number]
}>

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180
}

/**
 * 关节活动范围上限（度）。体型越小给得越紧 ——
 * 二头身的四肢短，同样的角度看起来更夸张，容易穿到身体里。
 */
export function getPoseLimit(bodyType?: CharacterBodyType): number {
  if (bodyType === 'chibi')
    return 58
  if (bodyType === 'child')
    return 72
  return 90
}

function radians(value: number, bodyType?: CharacterBodyType) {
  const limit = getPoseLimit(bodyType)
  return degreesToRadians(Math.min(limit, Math.max(-limit, value)))
}

function read(controls: Record<string, number>, key: string) {
  return controls[key] ?? 0
}

/** 这份素体的骨骼名在文件里是空格，映射表里是下划线，两边都认 */
function boneAlias(name: string) {
  return name.replace(/ /g, '_')
}

// 下面每个函数里轴的顺序和正负号都是按模型骨骼实际朝向定的，改动前先在视口里验
function spineRotation(controls: Record<string, number>, prefix: string, bodyType?: CharacterBodyType): [number, number, number] {
  return [
    radians(read(controls, `${prefix}.yaw`), bodyType),
    radians(read(controls, `${prefix}.roll`), bodyType),
    -radians(read(controls, `${prefix}.pitch`), bodyType),
  ]
}

function headRotation(controls: Record<string, number>, bodyType?: CharacterBodyType): [number, number, number] {
  return [
    radians(read(controls, 'head.yaw'), bodyType),
    radians(read(controls, 'head.roll'), bodyType),
    radians(read(controls, 'head.pitch'), bodyType),
  ]
}

function shoulderRotation(controls: Record<string, number>, prefix: string, bodyType?: CharacterBodyType): [number, number, number] {
  return [
    radians(read(controls, `${prefix}.twist`), bodyType),
    radians(read(controls, `${prefix}.spread`), bodyType),
    -radians(read(controls, `${prefix}.pitch`), bodyType),
  ]
}

/** 髋的 spread 与肩相反：两条腿张开时骨骼朝相反方向转 */
function hipRotation(controls: Record<string, number>, prefix: string, bodyType?: CharacterBodyType): [number, number, number] {
  return [
    radians(read(controls, `${prefix}.twist`), bodyType),
    -radians(read(controls, `${prefix}.spread`), bodyType),
    radians(read(controls, `${prefix}.pitch`), bodyType),
  ]
}

/** 肘和膝只能单向弯，一个轴就够 */
function bendRotation(controls: Record<string, number>, key: string, bodyType?: CharacterBodyType): [number, number, number] {
  return [0, 0, -radians(read(controls, key), bodyType)]
}

function extremityRotation(controls: Record<string, number>, prefix: string, bodyType?: CharacterBodyType): [number, number, number] {
  return [
    radians(read(controls, `${prefix}.twist`), bodyType),
    radians(read(controls, `${prefix}.roll`), bodyType),
    radians(read(controls, `${prefix}.pitch`), bodyType),
  ]
}

export function getPoseBoneRotations(
  controls: Record<string, number>,
  bodyType?: CharacterBodyType,
): BoneRotationMap {
  return {
    [BONE_MAP.body]: spineRotation(controls, 'body', bodyType),
    [BONE_MAP.torso]: spineRotation(controls, 'torso', bodyType),
    [BONE_MAP.head]: headRotation(controls, bodyType),
    [BONE_MAP.leftShoulder]: shoulderRotation(controls, 'leftShoulder', bodyType),
    [BONE_MAP.rightShoulder]: shoulderRotation(controls, 'rightShoulder', bodyType),
    [BONE_MAP.leftElbow]: bendRotation(controls, 'leftElbow.bend', bodyType),
    [BONE_MAP.rightElbow]: bendRotation(controls, 'rightElbow.bend', bodyType),
    [BONE_MAP.leftHand]: extremityRotation(controls, 'leftHand', bodyType),
    [BONE_MAP.rightHand]: extremityRotation(controls, 'rightHand', bodyType),
    [BONE_MAP.leftHip]: hipRotation(controls, 'leftHip', bodyType),
    [BONE_MAP.rightHip]: hipRotation(controls, 'rightHip', bodyType),
    [BONE_MAP.leftKnee]: bendRotation(controls, 'leftKnee.bend', bodyType),
    [BONE_MAP.rightKnee]: bendRotation(controls, 'rightKnee.bend', bodyType),
    [BONE_MAP.leftFoot]: extremityRotation(controls, 'leftFoot', bodyType),
    [BONE_MAP.rightFoot]: extremityRotation(controls, 'rightFoot', bodyType),
  }
}

/**
 * 中立姿态：模型自带的是 T 形（手臂完全水平），直接用会显得很僵。
 * 这里把手臂放下一些、肘部微屈，作为所有姿势的起点 —— 也就是「站立」的样子。
 */
export function getNeutralBoneRotations(): BoneRotationMap {
  return {
    [BONE_MAP.leftShoulder]: [0, degreesToRadians(25), 0],
    [BONE_MAP.rightShoulder]: [0, degreesToRadians(-25), 0],
    [BONE_MAP.leftElbow]: [0, 0, degreesToRadians(25)],
    [BONE_MAP.rightElbow]: [0, 0, degreesToRadians(25)],
  }
}

function isBone(object: Object3D): object is Bone {
  return (object as { isBone?: boolean }).isBone === true
}

/** 记下骨架的初始状态，之后每次摆姿势都从这里重新开始，避免旋转累积 */
export function captureRestPose(scene: Object3D): RestPose {
  const restPose: RestPose = {}

  scene.traverse((object) => {
    if (!isBone(object))
      return
    restPose[object.name] = {
      position: [object.position.x, object.position.y, object.position.z],
      quaternion: [object.quaternion.x, object.quaternion.y, object.quaternion.z, object.quaternion.w],
      scale: [object.scale.x, object.scale.y, object.scale.z],
    }
  })

  return restPose
}

function findMappedBone(scene: Object3D, mappedName: string) {
  let found: Object3D | undefined
  scene.traverse((object) => {
    if (!found && isBone(object) && boneAlias(object.name) === mappedName)
      found = object
  })
  return found
}

export function lowestWorldY(bones: Object3D[]) {
  const point = new Vector3()
  let min = Number.POSITIVE_INFINITY
  for (const bone of bones) {
    bone.updateWorldMatrix(true, false)
    min = Math.min(min, bone.getWorldPosition(point).y)
  }
  return min
}

/**
 * 把姿势应用到骨架。
 *
 * 每次都从静止姿态重新算，而不是在当前姿态上叠加 —— 叠加会让误差累积，
 * 连续调几次之后角色就扭曲了。顺序是：还原静止 → 记下站立脚高 → 叠中立姿态 →
 * 叠用户的控制量 → 按预设把骨盆往下带，但脚不超过站立时的高度。
 */
export function applyPose(
  scene: Object3D,
  options: { bodyType?: CharacterBodyType, controls: Record<string, number>, restPose: RestPose },
) {
  const { bodyType, controls, restPose } = options
  const neutral = getNeutralBoneRotations()
  const pose = getPoseBoneRotations(controls, bodyType)
  const euler = new Euler()
  const extra = new Quaternion()

  const restore = (object: Object3D) => {
    if (!isBone(object))
      return
    const rest = restPose[object.name]
    if (!rest)
      return
    object.position.set(...rest.position)
    object.quaternion.set(...rest.quaternion)
    object.scale.set(...rest.scale)
  }

  scene.traverse(restore)
  scene.updateWorldMatrix(true, true)
  const feet = [findMappedBone(scene, BONE_MAP.leftFoot), findMappedBone(scene, BONE_MAP.rightFoot)].filter(bone => bone != null)
  const standingFootY = lowestWorldY(feet)

  scene.traverse((object) => {
    if (!isBone(object) || !restPose[object.name])
      return

    const neutralRotation = neutral[object.name] ?? neutral[boneAlias(object.name)]
    if (neutralRotation) {
      euler.set(...neutralRotation)
      object.quaternion.multiply(extra.setFromEuler(euler))
    }

    const poseRotation = pose[object.name] ?? pose[boneAlias(object.name)]
    if (poseRotation) {
      euler.set(...poseRotation)
      object.quaternion.multiply(extra.setFromEuler(euler))
    }
  })

  dropHipsForPose(scene, findMappedBone(scene, BONE_MAP.body), feet, standingFootY, readBodyOffsetY(controls))
}

/** 姿势面板和预设共用的下移，单位米。异常值夹住，避免把角色弹出地面。 */
export function readBodyOffsetY(controls: Record<string, number> | undefined) {
  const value = Number(controls?.['body.offsetY'] ?? 0)
  if (!Number.isFinite(value))
    return 0
  return Math.min(1, Math.max(-1, value))
}

/**
 * 预设要求下移时，把骨盆往下带。脚已经悬空就跟着落，但不会低于站立时的脚高。
 * 双膝跪这类姿势脚本来就抬着，下移量用预设里的米数，不会为了贴地再往下压。
 */
function ancestorScaleY(root: Object3D) {
  root.updateWorldMatrix(true, false)
  const worldScale = Math.abs(root.getWorldScale(new Vector3()).y)
  const ownScale = Math.abs(root.scale.y) > 1e-8 ? Math.abs(root.scale.y) : 1
  if (!root.parent || worldScale < 1e-8)
    return 1
  return worldScale / ownScale
}

export function dropHipsForPose(
  root: Object3D,
  hips: Object3D | undefined,
  feet: Object3D[],
  standingFootY: number,
  offsetY: number,
) {
  if (!hips || !offsetY)
    return

  let drop = offsetY
  if (drop < 0 && feet.length && Number.isFinite(standingFootY)) {
    // 脚高是世界坐标，下移量是模型自己的米。外层体型缩放要先除掉，否则小人落不够。
    const untilGround = (standingFootY - lowestWorldY(feet)) / ancestorScaleY(root)
    drop = Math.max(drop, Math.min(0, untilGround))
  }
  dropHipsAlongRootUp(root, hips, drop)
}

/**
 * 沿模型根节点的竖直方向挪动骨盆，孩子（腿和上身）一起走。
 *
 * 用根节点自己的缩放换算，不把外层体型缩放再乘一遍：
 * 第一次摆姿势时模型可能还没挂到场景上，之后微调才有父级，两次结果要一样。
 * 导入模型如果是厘米单位，根节点上的缩放会把这 0.43 米换回骨骼本地单位。
 */
export function dropHipsAlongRootUp(root: Object3D, hips: Object3D, offsetY: number) {
  if (!offsetY || !hips.parent)
    return

  root.updateWorldMatrix(true, true)
  const rootInverse = new Matrix4().copy(root.matrixWorld).invert()
  const local = hips.getWorldPosition(new Vector3()).applyMatrix4(rootInverse)
  const scaleY = Math.abs(root.scale.y) > 1e-8 ? Math.abs(root.scale.y) : 1
  local.y += offsetY / scaleY
  root.localToWorld(local)
  hips.parent.worldToLocal(local)
  hips.position.copy(local)
}
