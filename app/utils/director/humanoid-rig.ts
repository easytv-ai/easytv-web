/**
 * 导入模型的人形骨骼识别，以及 Mixamo / VRM / 通用人形的摆姿势。
 *
 * UE4 素体（Bip001）继续走 mannequin-rig 里对过的局部欧拉角。
 * 其他骨架的骨骼朝向各不相同，不能把那套正负号搬过来。这里改用静止姿态下
 * 算出来的角色坐标系：右、上、前。轴向和正负号以 humanoid-rig.test.ts 为准。
 */
import { Quaternion, Vector3, type Bone, type Object3D } from 'three'
import type { CharacterBodyType } from './schema'
import { BONE_MAP, dropHipsForPose, getPoseLimit, lowestWorldY, readBodyOffsetY, type RestPose } from './mannequin-rig'

/** 和素体中立姿态同一量级：空的「站立」不要收成僵硬的 T 字 */
const NEUTRAL_SHOULDER_SPREAD = 25
const NEUTRAL_ELBOW_BEND = 25

export type HumanoidSlot =
  | 'hips'
  | 'spine'
  | 'chest'
  | 'head'
  | 'leftUpperArm'
  | 'leftLowerArm'
  | 'leftHand'
  | 'rightUpperArm'
  | 'rightLowerArm'
  | 'rightHand'
  | 'leftUpperLeg'
  | 'leftLowerLeg'
  | 'leftFoot'
  | 'rightUpperLeg'
  | 'rightLowerLeg'
  | 'rightFoot'

export interface HumanoidBinding {
  rigType: 'ue4-mannequin' | 'mixamo' | 'vrm' | 'custom-humanoid'
  /** UE4 素体用名字表摆姿势，这里留空 */
  bones: Partial<Record<HumanoidSlot, Bone>>
}

const LIMB_TOKENS: Record<string, { part: 'UpperArm' | 'LowerArm' | 'Hand' | 'UpperLeg' | 'LowerLeg' | 'Foot', rank: number }> = {
  upperarm: { part: 'UpperArm', rank: 3 },
  arm: { part: 'UpperArm', rank: 3 },
  shoulder: { part: 'UpperArm', rank: 1 },
  forearm: { part: 'LowerArm', rank: 3 },
  lowerarm: { part: 'LowerArm', rank: 3 },
  hand: { part: 'Hand', rank: 3 },
  upleg: { part: 'UpperLeg', rank: 3 },
  upperleg: { part: 'UpperLeg', rank: 3 },
  thigh: { part: 'UpperLeg', rank: 3 },
  calf: { part: 'LowerLeg', rank: 3 },
  lowerleg: { part: 'LowerLeg', rank: 3 },
  leg: { part: 'LowerLeg', rank: 2 },
  foot: { part: 'Foot', rank: 3 },
}

function isBone(object: Object3D): object is Bone {
  return (object as Bone).isBone === true
}

/** 去掉 Mixamo / VRM / UE 前缀，只留用来对槽位的名字 */
function boneKey(name: string) {
  let key = name.trim().toLowerCase()
  key = key.replace(/^mixamorig[:_]?/, '')
  key = key.replace(/^j_bip_/, '')
  key = key.replace(/^c_/, '')
  key = key.replace(/^bip001/, '')
  key = key.replace(/^bip01/, '')
  return key.replace(/[^a-z0-9]/g, '')
}

function trimDigits(token: string) {
  return token.replace(/^\d+/, '').replace(/\d+$/, '')
}

function splitSide(key: string): { side: 'l' | 'r' | '', token: string } {
  if (key.startsWith('left'))
    return { side: 'l', token: trimDigits(key.slice(4)) }
  if (key.startsWith('right'))
    return { side: 'r', token: trimDigits(key.slice(5)) }

  for (const side of ['l', 'r'] as const) {
    const token = trimDigits(key.slice(1))
    if (key.startsWith(side) && key.length > 2 && LIMB_TOKENS[token])
      return { side, token }
  }
  for (const side of ['l', 'r'] as const) {
    const token = trimDigits(key.slice(0, -1))
    if (key.endsWith(side) && key.length > 2 && LIMB_TOKENS[token])
      return { side, token }
  }
  return { side: '', token: key }
}

function centerSlot(token: string): { slot: HumanoidSlot, rank: number } | null {
  const bare = trimDigits(token)
  if (token === 'hips' || bare === 'hips' || token === 'pelvis' || bare === 'pelvis')
    return { slot: 'hips', rank: 2 }
  if (token === 'head' || bare === 'head')
    return { slot: 'head', rank: 2 }
  if (token === 'upperchest' || token === 'chest' || token === 'spine2' || token === 'spine02')
    return { slot: 'chest', rank: 2 }
  if (token === 'spine' || token === 'spine1' || token === 'spine01')
    return { slot: 'spine', rank: token === 'spine' ? 2 : 1 }
  return null
}

function inferRigType(bones: Bone[]): HumanoidBinding['rigType'] {
  const blob = bones.map(bone => bone.name).join('\n').toLowerCase()
  if (blob.includes('mixamorig'))
    return 'mixamo'
  if (blob.includes('j_bip_') || blob.includes('vroid'))
    return 'vrm'
  return 'custom-humanoid'
}

/**
 * 从克隆出来的模型上认人形槽位。
 * 至少要有髋、两条上臂、两条大腿，否则当道具，不给姿势滑块。
 */
export function matchHumanoid(root: Object3D): HumanoidBinding | null {
  const bones: Bone[] = []
  root.traverse((object) => {
    if (isBone(object))
      bones.push(object)
  })
  if (!bones.length)
    return null

  const names = new Set(bones.map(bone => bone.name))
  if ((Object.values(BONE_MAP) as string[]).every(name => names.has(name)))
    return { rigType: 'ue4-mannequin', bones: {} }

  const best = new Map<HumanoidSlot, { bone: Bone, rank: number }>()
  const consider = (slot: HumanoidSlot, bone: Bone, rank: number) => {
    const prev = best.get(slot)
    if (!prev || rank > prev.rank)
      best.set(slot, { bone, rank })
  }

  for (const bone of bones) {
    const key = boneKey(bone.name)
    if (!key)
      continue
    const { side, token } = splitSide(key)
    if (!side) {
      const center = centerSlot(token)
      if (center)
        consider(center.slot, bone, center.rank)
      continue
    }
    const limb = LIMB_TOKENS[token]
    if (!limb)
      continue
    const slot = `${side === 'l' ? 'left' : 'right'}${limb.part}` as HumanoidSlot
    consider(slot, bone, limb.rank)
  }

  const slots = Object.fromEntries([...best].map(([slot, item]) => [slot, item.bone])) as HumanoidBinding['bones']
  if (!slots.hips || !slots.leftUpperArm || !slots.rightUpperArm || !slots.leftUpperLeg || !slots.rightUpperLeg)
    return null

  return { rigType: inferRigType(bones), bones: slots }
}

function radiansOf(controls: Record<string, number>, key: string, bodyType?: CharacterBodyType, extra = 0) {
  const limit = getPoseLimit(bodyType)
  const raw = (controls[key] ?? 0) + extra
  const clamped = Math.min(limit, Math.max(-limit, raw))
  return (clamped * Math.PI) / 180
}

interface PoseScratch {
  a: Vector3
  b: Vector3
  spin: Vector3
  axis: Vector3
  parentQuat: Quaternion
  worldQuat: Quaternion
  delta: Quaternion
}

function createScratch(): PoseScratch {
  return {
    a: new Vector3(),
    b: new Vector3(),
    spin: new Vector3(),
    axis: new Vector3(),
    parentQuat: new Quaternion(),
    worldQuat: new Quaternion(),
    delta: new Quaternion(),
  }
}

function restoreRest(root: Object3D, restPose: RestPose) {
  root.traverse((object) => {
    if (!isBone(object))
      return
    const rest = restPose[object.name]
    if (!rest)
      return
    object.position.set(rest.position[0], rest.position[1], rest.position[2])
    object.quaternion.set(rest.quaternion[0], rest.quaternion[1], rest.quaternion[2], rest.quaternion[3])
    object.scale.set(rest.scale[0], rest.scale[1], rest.scale[2])
  })
}

/** 让子骨骼往 desired 方向动的转轴。手臂和腿的铰链都从当前朝向现算。 */
function hingeAxis(bone: Bone, child: Bone, desired: Vector3, scratch: PoseScratch) {
  bone.updateWorldMatrix(true, true)
  const origin = bone.getWorldPosition(scratch.a)
  const dest = child.getWorldPosition(scratch.b).sub(origin)
  if (dest.lengthSq() < 1e-8)
    return null
  scratch.axis.crossVectors(dest.normalize(), desired)
  if (scratch.axis.lengthSq() < 1e-8)
    return null
  return scratch.axis.normalize()
}

function rotateWorld(bone: Bone, worldAxis: Vector3, radians: number, scratch: PoseScratch) {
  if (!radians)
    return
  bone.updateWorldMatrix(true, false)
  const parent = bone.parent
  if (parent)
    parent.getWorldQuaternion(scratch.parentQuat)
  else
    scratch.parentQuat.identity()
  bone.getWorldQuaternion(scratch.worldQuat)
  scratch.delta.setFromAxisAngle(scratch.spin.copy(worldAxis).normalize(), radians)
  scratch.delta.multiply(scratch.worldQuat)
  bone.quaternion.copy(scratch.parentQuat.invert().multiply(scratch.delta))
}

function swing(bone: Bone | undefined, child: Bone | undefined, desired: Vector3, radians: number, scratch: PoseScratch) {
  if (!bone || !child || !radians)
    return
  const axis = hingeAxis(bone, child, desired, scratch)
  if (!axis)
    return
  rotateWorld(bone, axis, radians, scratch)
}

function rotateFrame(bone: Bone | undefined, axis: Vector3, radians: number, scratch: PoseScratch) {
  if (!bone || !radians)
    return
  rotateWorld(bone, axis, radians, scratch)
}

/**
 * 把手或脚的长轴往目标方向掰。轴是「骨头朝外」和目标的叉积，
 * 左右手臂朝向相反，同一个目标方向会自然对称。
 */
function hingeOutward(bone: Bone | undefined, desired: Vector3, radians: number, scratch: PoseScratch) {
  const parent = bone?.parent
  if (!bone || !parent || !radians)
    return
  bone.updateWorldMatrix(true, false)
  const outward = bone.getWorldPosition(scratch.b).sub(parent.getWorldPosition(scratch.a))
  if (outward.lengthSq() < 1e-8)
    return
  const axis = scratch.axis.crossVectors(outward.normalize(), desired)
  if (axis.lengthSq() < 1e-8)
    return
  rotateWorld(bone, axis.normalize(), radians, scratch)
}

/** 绕这根骨头相对父级的方向转。手腕和脚踝没有子骨骼时也能拧。 */
function twistSelf(bone: Bone | undefined, radians: number, scratch: PoseScratch) {
  const parent = bone?.parent
  if (!bone || !parent || !radians)
    return
  bone.updateWorldMatrix(true, false)
  const dir = bone.getWorldPosition(scratch.b).sub(parent.getWorldPosition(scratch.a))
  if (dir.lengthSq() < 1e-8)
    return
  rotateWorld(bone, dir.normalize(), radians, scratch)
}

/** 绕肢体自身方向转。手和脚在这根轴上，位置几乎不动。 */
function twistAround(bone: Bone | undefined, child: Bone | undefined, radians: number, scratch: PoseScratch) {
  if (!bone || !child || !radians)
    return
  bone.updateWorldMatrix(true, true)
  const dir = child.getWorldPosition(scratch.b).sub(bone.getWorldPosition(scratch.a))
  if (dir.lengthSq() < 1e-8)
    return
  rotateWorld(bone, dir.normalize(), radians, scratch)
}

/**
 * 把姿势滑块应用到导入的人形骨架。
 * 每次从静止姿态重算，避免滑块来回拖时旋转叠加上去。
 */
export function applyHumanoidPose(
  root: Object3D,
  restPose: RestPose,
  binding: HumanoidBinding,
  controls: Record<string, number> = {},
  bodyType?: CharacterBodyType,
) {
  if (binding.rigType === 'ue4-mannequin')
    return
  const bones = binding.bones
  const hips = bones.hips
  const leftArm = bones.leftUpperArm
  const rightArm = bones.rightUpperArm
  if (!hips || !leftArm || !rightArm)
    return

  restoreRest(root, restPose)
  root.updateMatrixWorld(true)
  const feet = [bones.leftFoot, bones.rightFoot].filter(bone => bone != null)
  const standingFootY = lowestWorldY(feet)

  const scratch = createScratch()
  const right = new Vector3()
  const up = new Vector3(0, 1, 0)
  const forward = new Vector3()
  const back = new Vector3()
  const down = new Vector3()

  right.subVectors(rightArm.getWorldPosition(scratch.a), leftArm.getWorldPosition(scratch.b))
  if (right.lengthSq() < 1e-8)
    return
  right.normalize()

  if (bones.head) {
    const bridge = bones.head.getWorldPosition(scratch.a).sub(hips.getWorldPosition(scratch.b))
    if (Math.abs(bridge.z) > Math.abs(bridge.y) && Math.abs(bridge.z) > Math.abs(bridge.x))
      up.set(0, 0, Math.sign(bridge.z) || 1)
  }
  right.addScaledVector(up, -right.dot(up))
  if (right.lengthSq() < 1e-8)
    return
  right.normalize()
  forward.crossVectors(right, up).normalize()
  back.copy(forward).negate()
  down.copy(up).negate()

  const rad = (key: string, extra = 0) => radiansOf(controls, key, bodyType, extra)
  const torso = bones.chest ?? bones.spine

  rotateFrame(hips, right, rad('body.pitch'), scratch)
  // three.js 绕世界上轴的正角度会把鼻子转到角色右侧，转身取反才是转向左侧
  rotateFrame(hips, up, -rad('body.yaw'), scratch)
  rotateFrame(hips, forward, rad('body.roll'), scratch)
  rotateFrame(torso, right, rad('torso.pitch'), scratch)
  rotateFrame(torso, up, -rad('torso.yaw'), scratch)
  rotateFrame(torso, forward, rad('torso.roll'), scratch)
  rotateFrame(bones.head, right, rad('head.pitch'), scratch)
  rotateFrame(bones.head, up, -rad('head.yaw'), scratch)
  rotateFrame(bones.head, forward, rad('head.roll'), scratch)

  const leftLower = bones.leftLowerArm ?? bones.leftHand
  const rightLower = bones.rightLowerArm ?? bones.rightHand
  swing(leftArm, leftLower, forward, rad('leftShoulder.pitch'), scratch)
  // 预设里左右外展符号相反，同样的动作才对称：T 型是左 -70、右 +70
  swing(leftArm, leftLower, down, rad('leftShoulder.spread', NEUTRAL_SHOULDER_SPREAD), scratch)
  twistAround(leftArm, leftLower, rad('leftShoulder.twist'), scratch)
  swing(rightArm, rightLower, forward, rad('rightShoulder.pitch'), scratch)
  swing(rightArm, rightLower, up, rad('rightShoulder.spread', -NEUTRAL_SHOULDER_SPREAD), scratch)
  twistAround(rightArm, rightLower, rad('rightShoulder.twist'), scratch)

  swing(bones.leftLowerArm, bones.leftHand, forward, rad('leftElbow.bend', NEUTRAL_ELBOW_BEND), scratch)
  swing(bones.rightLowerArm, bones.rightHand, forward, rad('rightElbow.bend', NEUTRAL_ELBOW_BEND), scratch)

  const leftLeg = bones.leftLowerLeg ?? bones.leftFoot
  const rightLeg = bones.rightLowerLeg ?? bones.rightFoot
  swing(bones.leftUpperLeg, leftLeg, forward, rad('leftHip.pitch'), scratch)
  // 和肩一样：左负右正才是两条腿同时外展
  swing(bones.leftUpperLeg, leftLeg, right, rad('leftHip.spread'), scratch)
  twistAround(bones.leftUpperLeg, leftLeg, rad('leftHip.twist'), scratch)
  swing(bones.rightUpperLeg, rightLeg, forward, rad('rightHip.pitch'), scratch)
  swing(bones.rightUpperLeg, rightLeg, right, rad('rightHip.spread'), scratch)
  twistAround(bones.rightUpperLeg, rightLeg, rad('rightHip.twist'), scratch)

  swing(bones.leftLowerLeg, bones.leftFoot, back, rad('leftKnee.bend'), scratch)
  swing(bones.rightLowerLeg, bones.rightFoot, back, rad('rightKnee.bend'), scratch)

  // 手和脚：点头两边同号同向；翻滚、扭转和肩外展一样，左右要反号才对称
  const poseEnd = (bone: Bone | undefined, side: 'left' | 'right', prefix: string, rollToward: Vector3) => {
    if (!bone)
      return
    const mirror = side === 'left' ? -1 : 1
    hingeOutward(bone, forward, rad(`${prefix}.pitch`), scratch)
    hingeOutward(bone, rollToward, rad(`${prefix}.roll`) * mirror, scratch)
    twistSelf(bone, rad(`${prefix}.twist`) * mirror, scratch)
  }
  poseEnd(bones.leftHand, 'left', 'leftHand', up)
  poseEnd(bones.rightHand, 'right', 'rightHand', up)
  poseEnd(bones.leftFoot, 'left', 'leftFoot', right)
  poseEnd(bones.rightFoot, 'right', 'rightFoot', right)

  dropHipsForPose(root, hips, feet, standingFootY, readBodyOffsetY(controls))

  root.updateMatrixWorld(true)
}
