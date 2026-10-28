import { describe, expect, it } from 'vitest'
import { Bone, Group, Vector3, type Object3D } from 'three'
import { BONE_MAP, captureRestPose } from './mannequin-rig'
import { lookupPosePreset } from './pose-presets'
import { applyHumanoidPose, matchHumanoid } from './humanoid-rig'

function addBone(parent: Object3D, name: string, x: number, y: number, z: number) {
  const bone = new Bone()
  bone.name = name
  bone.position.set(x, y, z)
  parent.add(bone)
  return bone
}

/** Mixamo 命名的 T 字骨架，脸朝 +Z，左臂在 -X */
function buildMixamoTPose() {
  const root = new Group()
  const hips = addBone(root, 'mixamorigHips', 0, 1, 0)
  const spine = addBone(hips, 'mixamorigSpine', 0, 0.15, 0)
  const spine2 = addBone(spine, 'mixamorigSpine2', 0, 0.2, 0)
  const head = addBone(spine2, 'mixamorigHead', 0, 0.25, 0)
  addBone(head, 'noseMarker', 0, 0.05, 0.2)
  const leftArm = addBone(spine2, 'mixamorigLeftArm', -0.15, 0.05, 0)
  const leftFore = addBone(leftArm, 'mixamorigLeftForeArm', -0.3, 0, 0)
  const leftHand = addBone(leftFore, 'mixamorigLeftHand', -0.25, 0, 0)
  addBone(leftHand, 'leftFingerTip', -0.12, 0, 0)
  addBone(leftHand, 'leftPalmTip', 0, 0.1, 0)
  addBone(spine2, 'mixamorigLeftShoulder', -0.08, 0.08, 0)
  const rightArm = addBone(spine2, 'mixamorigRightArm', 0.15, 0.05, 0)
  const rightFore = addBone(rightArm, 'mixamorigRightForeArm', 0.3, 0, 0)
  const rightHand = addBone(rightFore, 'mixamorigRightHand', 0.25, 0, 0)
  addBone(rightHand, 'rightFingerTip', 0.12, 0, 0)
  addBone(rightHand, 'rightPalmTip', 0, 0.1, 0)
  const leftUp = addBone(hips, 'mixamorigLeftUpLeg', -0.1, -0.05, 0)
  const leftLeg = addBone(leftUp, 'mixamorigLeftLeg', 0, -0.4, 0)
  const leftFoot = addBone(leftLeg, 'mixamorigLeftFoot', 0, -0.4, 0)
  addBone(leftFoot, 'leftToeTip', 0, 0, 0.12)
  const rightUp = addBone(hips, 'mixamorigRightUpLeg', 0.1, -0.05, 0)
  const rightLeg = addBone(rightUp, 'mixamorigRightLeg', 0, -0.4, 0)
  const rightFoot = addBone(rightLeg, 'mixamorigRightFoot', 0, -0.4, 0)
  addBone(rightFoot, 'rightToeTip', 0, 0, 0.12)
  root.updateMatrixWorld(true)
  return root
}

function buildVrmTPose() {
  const root = new Group()
  const hips = addBone(root, 'J_Bip_C_Hips', 0, 1, 0)
  addBone(hips, 'J_Bip_C_Spine', 0, 0.2, 0)
  const chest = addBone(hips, 'J_Bip_C_Chest', 0, 0.35, 0)
  addBone(chest, 'J_Bip_C_Head', 0, 0.25, 0)
  addBone(chest, 'J_Bip_L_UpperArm', -0.2, 0.1, 0)
  addBone(chest, 'J_Bip_R_UpperArm', 0.2, 0.1, 0)
  addBone(hips, 'J_Bip_L_UpperLeg', -0.1, -0.05, 0)
  addBone(hips, 'J_Bip_R_UpperLeg', 0.1, -0.05, 0)
  root.updateMatrixWorld(true)
  return root
}

function worldOf(root: Object3D, name: string) {
  root.updateMatrixWorld(true)
  const bone = root.getObjectByName(name)
  if (!bone)
    throw new Error(`missing ${name}`)
  return bone.getWorldPosition(new Vector3())
}

function posed(controls: Record<string, number>, bodyType?: 'chibi') {
  const root = buildMixamoTPose()
  const binding = matchHumanoid(root)
  if (!binding)
    throw new Error('mixamo skeleton should match')
  applyHumanoidPose(root, captureRestPose(root), binding, controls, bodyType)
  return root
}

describe('人形骨骼识别', () => {
  it('认出 Mixamo，上臂用手臂而不是锁骨', () => {
    const binding = matchHumanoid(buildMixamoTPose())

    expect(binding?.rigType).toBe('mixamo')
    expect(binding?.bones.leftUpperArm?.name).toBe('mixamorigLeftArm')
    expect(binding?.bones.chest?.name).toBe('mixamorigSpine2')
    expect(binding?.bones.spine?.name).toBe('mixamorigSpine')
    expect(binding?.bones.leftLowerArm?.name).toBe('mixamorigLeftForeArm')
    expect(binding?.bones.leftUpperLeg?.name).toBe('mixamorigLeftUpLeg')
  })

  it('认出 VRM 的 J_Bip 命名', () => {
    const binding = matchHumanoid(buildVrmTPose())

    expect(binding?.rigType).toBe('vrm')
    expect(binding?.bones.hips?.name).toBe('J_Bip_C_Hips')
    expect(binding?.bones.leftUpperArm?.name).toBe('J_Bip_L_UpperArm')
    expect(binding?.bones.chest?.name).toBe('J_Bip_C_Chest')
  })

  it('左右写在名字末尾的也认', () => {
    const root = new Group()
    const hips = addBone(root, 'pelvis', 0, 1, 0)
    addBone(hips, 'upperarm_l', -0.4, 0.2, 0)
    addBone(hips, 'upperarm_r', 0.4, 0.2, 0)
    addBone(hips, 'thigh_l', -0.1, -0.1, 0)
    addBone(hips, 'thigh_r', 0.1, -0.1, 0)
    root.updateMatrixWorld(true)

    const binding = matchHumanoid(root)

    expect(binding?.rigType).toBe('custom-humanoid')
    expect(binding?.bones.leftUpperArm?.name).toBe('upperarm_l')
    expect(binding?.bones.rightUpperLeg?.name).toBe('thigh_r')
  })

  it('完整的 UE4 素体骨骼走原来的摆姿势，不走语义轴', () => {
    const root = new Group()
    for (const name of Object.values(BONE_MAP))
      addBone(root, name, 0, 0, 0)

    expect(matchHumanoid(root)?.rigType).toBe('ue4-mannequin')
    expect(matchHumanoid(root)?.bones).toEqual({})
  })

  it('只有头、或者椅子这种名字，不当成人', () => {
    const headOnly = new Group()
    addBone(headOnly, 'head', 0, 1, 0)
    expect(matchHumanoid(headOnly)).toBeNull()

    const chair = new Group()
    addBone(chair, 'Chair', 0, 0, 0)
    addBone(chair, 'Leg', 0, -1, 0)
    expect(matchHumanoid(chair)).toBeNull()
  })
})

describe('导入人形的摆姿势', () => {
  it('空的站立会把手臂放下来，而不是停在 T 字', () => {
    const raw = buildMixamoTPose()
    const rawLeft = worldOf(raw, 'mixamorigLeftHand').y
    const rawRight = worldOf(raw, 'mixamorigRightHand').y
    const stood = posed({})

    expect(worldOf(stood, 'mixamorigLeftHand').y).toBeLessThan(rawLeft - 0.05)
    expect(worldOf(stood, 'mixamorigRightHand').y).toBeLessThan(rawRight - 0.05)
  })

  it('肩前摆把手送到身前', () => {
    const stood = posed({})
    const pitched = posed({ 'leftShoulder.pitch': 50, 'rightShoulder.pitch': 50 })

    expect(worldOf(pitched, 'mixamorigLeftHand').z).toBeGreaterThan(worldOf(stood, 'mixamorigLeftHand').z + 0.05)
    expect(worldOf(pitched, 'mixamorigRightHand').z).toBeGreaterThan(worldOf(stood, 'mixamorigRightHand').z + 0.05)
  })

  it('外展和素体同一套左右符号，T 型会把两边手臂抬起来', () => {
    const stood = posed({})
    const spread = posed({ 'leftShoulder.spread': 40, 'rightShoulder.spread': 40 })
    const tpose = posed({ 'leftShoulder.spread': -70, 'rightShoulder.spread': 70 })

    expect(worldOf(spread, 'mixamorigLeftHand').y).toBeLessThan(worldOf(stood, 'mixamorigLeftHand').y - 0.04)
    expect(worldOf(spread, 'mixamorigRightHand').y).toBeGreaterThan(worldOf(stood, 'mixamorigRightHand').y + 0.04)
    expect(worldOf(tpose, 'mixamorigLeftHand').y).toBeGreaterThan(worldOf(stood, 'mixamorigLeftHand').y + 0.05)
    expect(worldOf(tpose, 'mixamorigRightHand').y).toBeGreaterThan(worldOf(stood, 'mixamorigRightHand').y + 0.05)
  })

  it('髋外展左负右正时两脚向外', () => {
    const stood = posed({})
    const apart = posed({ 'leftHip.spread': -30, 'rightHip.spread': 30 })

    expect(worldOf(apart, 'mixamorigLeftFoot').x).toBeLessThan(worldOf(stood, 'mixamorigLeftFoot').x - 0.02)
    expect(worldOf(apart, 'mixamorigRightFoot').x).toBeGreaterThan(worldOf(stood, 'mixamorigRightFoot').x + 0.02)
  })

  it('屈肘让手往身前收，抬腿往前、屈膝往后', () => {
    const stood = posed({})
    const bent = posed({ 'leftElbow.bend': 50, 'rightElbow.bend': 50 })
    const step = posed({ 'leftHip.pitch': 40, 'rightHip.pitch': 40 })
    const knee = posed({ 'leftKnee.bend': 50, 'rightKnee.bend': 50 })

    expect(worldOf(bent, 'mixamorigLeftHand').z).toBeGreaterThan(worldOf(stood, 'mixamorigLeftHand').z + 0.05)
    expect(worldOf(bent, 'mixamorigRightHand').z).toBeGreaterThan(worldOf(stood, 'mixamorigRightHand').z + 0.05)
    expect(worldOf(step, 'mixamorigLeftFoot').z).toBeGreaterThan(worldOf(stood, 'mixamorigLeftFoot').z + 0.05)
    expect(worldOf(step, 'mixamorigRightFoot').z).toBeGreaterThan(worldOf(stood, 'mixamorigRightFoot').z + 0.05)
    expect(worldOf(knee, 'mixamorigLeftFoot').z).toBeLessThan(worldOf(stood, 'mixamorigLeftFoot').z - 0.05)
    expect(worldOf(knee, 'mixamorigRightFoot').z).toBeLessThan(worldOf(stood, 'mixamorigRightFoot').z - 0.05)
  })

  it('身体前倾让头往前，转头让鼻子转向角色左侧', () => {
    const stood = posed({})
    const lean = posed({ 'body.pitch': 30 })
    const look = posed({ 'head.yaw': 40 })

    expect(worldOf(lean, 'mixamorigHead').z).toBeGreaterThan(worldOf(stood, 'mixamorigHead').z + 0.02)
    expect(worldOf(look, 'noseMarker').x).toBeLessThan(worldOf(stood, 'noseMarker').x - 0.02)
  })

  it('扭转肩膀时手几乎留在原地', () => {
    const stood = posed({})
    const twisted = posed({ 'leftShoulder.twist': 60 })
    const before = worldOf(stood, 'mixamorigLeftHand')
    const after = worldOf(twisted, 'mixamorigLeftHand')

    expect(after.distanceTo(before)).toBeLessThan(0.08)
    expect(twisted.getObjectByName('mixamorigLeftArm')!.quaternion.angleTo(
      stood.getObjectByName('mixamorigLeftArm')!.quaternion,
    )).toBeGreaterThan(0.2)
  })

  it('同一个姿势摆两次不会叠角度，清空后又回到站立', () => {
    const root = buildMixamoTPose()
    const binding = matchHumanoid(root)!
    const rest = captureRestPose(root)
    applyHumanoidPose(root, rest, binding, { 'leftElbow.bend': 40 })
    const once = worldOf(root, 'mixamorigLeftHand').z
    applyHumanoidPose(root, rest, binding, { 'leftElbow.bend': 40 })
    expect(worldOf(root, 'mixamorigLeftHand').z).toBeCloseTo(once, 4)

    const stood = posed({})
    applyHumanoidPose(root, rest, binding, {})
    expect(worldOf(root, 'mixamorigLeftHand').z).toBeCloseTo(worldOf(stood, 'mixamorigLeftHand').z, 4)
  })

  it('脚尖同号上抬，指尖同号往身前，手的翻滚要左右反号', () => {
    const stood = posed({})
    const feet = posed({ 'leftFoot.pitch': 45, 'rightFoot.pitch': 45 })
    const hands = posed({ 'leftHand.pitch': 50, 'rightHand.pitch': 50 })
    const rolled = posed({ 'leftHand.roll': -40, 'rightHand.roll': 40 })

    expect(worldOf(feet, 'leftToeTip').y).toBeGreaterThan(worldOf(stood, 'leftToeTip').y + 0.02)
    expect(worldOf(feet, 'rightToeTip').y).toBeGreaterThan(worldOf(stood, 'rightToeTip').y + 0.02)
    expect(worldOf(hands, 'leftFingerTip').z).toBeGreaterThan(worldOf(stood, 'leftFingerTip').z + 0.02)
    expect(worldOf(hands, 'rightFingerTip').z).toBeGreaterThan(worldOf(stood, 'rightFingerTip').z + 0.02)

    const leftPalm = worldOf(rolled, 'leftFingerTip').y - worldOf(stood, 'leftFingerTip').y
    const rightPalm = worldOf(rolled, 'rightFingerTip').y - worldOf(stood, 'rightFingerTip').y
    expect(leftPalm * rightPalm).toBeGreaterThan(0)
    expect(Math.abs(leftPalm)).toBeGreaterThan(0.02)
  })

  it('拧手腕时手掌转开，手腕几乎不动；没有手脚的模型会跳过', () => {
    const stood = posed({})
    const twisted = posed({ 'leftHand.twist': 70 })

    expect(worldOf(twisted, 'mixamorigLeftHand').distanceTo(worldOf(stood, 'mixamorigLeftHand'))).toBeLessThan(0.02)
    expect(worldOf(twisted, 'leftPalmTip').distanceTo(worldOf(stood, 'leftPalmTip'))).toBeGreaterThan(0.02)

    const root = buildVrmTPose()
    const binding = matchHumanoid(root)!
    applyHumanoidPose(root, captureRestPose(root), binding, {
      'leftHand.pitch': 40,
      'rightFoot.pitch': 40,
    })
    expect(worldOf(root, 'J_Bip_C_Hips').y).toBeCloseTo(1, 4)
  })

  it('单膝跪地会用上脚的点头，后脚抬得更多', () => {
    const preset = lookupPosePreset('kneel-one')!
    const plain = posed({ ...preset, 'leftFoot.pitch': 0, 'rightFoot.pitch': 0 })
    const knelt = posed(preset)
    const leftLift = worldOf(knelt, 'leftToeTip').y - worldOf(plain, 'leftToeTip').y
    const rightLift = worldOf(knelt, 'rightToeTip').y - worldOf(plain, 'rightToeTip').y

    expect(leftLift).toBeGreaterThan(0.01)
    expect(rightLift).toBeGreaterThan(leftLift)
  })

  it('蹲下预设把骨盆往下带，脚不低于站立高度', () => {
    const crouch = lookupPosePreset('crouch')!
    const { 'body.offsetY': offsetY, ...bent } = crouch
    const stood = posed({})
    const folded = posed(bent)
    const dropped = posed(crouch)

    expect(offsetY).toBeLessThan(0)
    expect(worldOf(dropped, 'mixamorigHips').y).toBeLessThan(worldOf(folded, 'mixamorigHips').y - 0.2)
    expect(worldOf(dropped, 'mixamorigLeftFoot').y).toBeLessThan(worldOf(folded, 'mixamorigLeftFoot').y - 0.2)
    expect(worldOf(dropped, 'mixamorigLeftFoot').y).toBeGreaterThanOrEqual(worldOf(stood, 'mixamorigLeftFoot').y - 0.02)
    expect(worldOf(dropped, 'mixamorigRightFoot').y).toBeGreaterThanOrEqual(worldOf(stood, 'mixamorigRightFoot').y - 0.02)
  })

  it('二头身会把过大的角度收进来', () => {
    const capped = posed({ 'leftShoulder.pitch': 90 }, 'chibi')
    const limit = posed({ 'leftShoulder.pitch': 58 }, 'chibi')

    expect(worldOf(capped, 'mixamorigLeftHand').distanceTo(worldOf(limit, 'mixamorigLeftHand'))).toBeLessThan(1e-4)
  })
})
