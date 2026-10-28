import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Bone, Group, Vector3 } from 'three'
import { BONE_MAP, applyPose, captureRestPose, getNeutralBoneRotations, getPoseBoneRotations, getPoseLimit, readBodyOffsetY } from './mannequin-rig'
import { MANNEQUIN_POSE_PRESETS } from './pose-presets'

const DEG = Math.PI / 180

describe('关节活动范围', () => {
  it('体型越小限得越紧', () => {
    // 二头身四肢短，同样角度看起来更夸张，容易穿进身体
    expect(getPoseLimit('chibi')).toBeLessThan(getPoseLimit('child'))
    expect(getPoseLimit('child')).toBeLessThan(getPoseLimit('mannequin'))
  })

  it('超出范围的控制量被夹住', () => {
    const rotations = getPoseBoneRotations({ 'leftElbow.bend': 500 }, 'mannequin')
    expect(Math.abs(rotations[BONE_MAP.leftElbow]![2])).toBeCloseTo(90 * DEG, 5)
  })

  it('小体型夹得更早', () => {
    const adult = getPoseBoneRotations({ 'leftElbow.bend': 80 }, 'mannequin')
    const chibi = getPoseBoneRotations({ 'leftElbow.bend': 80 }, 'chibi')
    expect(Math.abs(chibi[BONE_MAP.leftElbow]![2])).toBeLessThan(Math.abs(adult[BONE_MAP.leftElbow]![2]))
  })
})

describe('控制量到骨骼旋转', () => {
  it('每根映射的骨骼都有对应的旋转', () => {
    const rotations = getPoseBoneRotations({}, 'mannequin')
    for (const boneName of Object.values(BONE_MAP))
      expect(rotations[boneName], boneName).toBeDefined()
  })

  it('空控制量得到全零旋转', () => {
    // 用 toBeCloseTo 而不是 toEqual / toBe：取负号的轴会算出 -0，
    // 那两个断言都走 Object.is，会把 -0 和 +0 当成不同的值
    const rotations = getPoseBoneRotations({}, 'mannequin')
    for (const value of Object.values(rotations)) {
      for (const component of value)
        expect(component).toBeCloseTo(0, 10)
    }
  })

  it('左右肩的 spread 方向相反', () => {
    // 两臂同时张开时，左右骨骼要往相反方向转，同号会让一只手插进身体
    const rotations = getPoseBoneRotations({ 'leftShoulder.spread': -70, 'rightShoulder.spread': 70 }, 'mannequin')
    const left = rotations[BONE_MAP.leftShoulder]![1]
    const right = rotations[BONE_MAP.rightShoulder]![1]

    expect(Math.sign(left)).not.toBe(Math.sign(right))
  })

  it('髋的 spread 与肩取反号', () => {
    const shoulder = getPoseBoneRotations({ 'leftShoulder.spread': 30 }, 'mannequin')[BONE_MAP.leftShoulder]![1]
    const hip = getPoseBoneRotations({ 'leftHip.spread': 30 }, 'mannequin')[BONE_MAP.leftHip]![1]

    expect(Math.sign(shoulder)).not.toBe(Math.sign(hip))
  })

  it('肘和膝只用一个轴', () => {
    // 它们只能单向弯，多给轴会拧出反关节
    const rotations = getPoseBoneRotations({ 'leftElbow.bend': 30, 'leftKnee.bend': 30 }, 'mannequin')
    expect(rotations[BONE_MAP.leftElbow]!.slice(0, 2)).toEqual([0, 0])
    expect(rotations[BONE_MAP.leftKnee]!.slice(0, 2)).toEqual([0, 0])
  })

  it('未知的控制量被忽略而不是崩掉', () => {
    expect(() => getPoseBoneRotations({ '不存在的关节.pitch': 30 }, 'mannequin')).not.toThrow()
  })
})

describe('中立姿态', () => {
  it('手臂放下、肘部微屈，不是僵硬的 T 形', () => {
    const neutral = getNeutralBoneRotations()
    expect(neutral[BONE_MAP.leftShoulder]![1]).toBeCloseTo(25 * DEG, 5)
    expect(neutral[BONE_MAP.rightShoulder]![1]).toBeCloseTo(-25 * DEG, 5)
    expect(neutral[BONE_MAP.leftElbow]![2]).toBeCloseTo(25 * DEG, 5)
  })
})

describe('内置姿势能落到骨骼上', () => {
  it('每个预设的控制量都至少命中一根骨骼', () => {
    // 控制量键名写错时不会报错、只是姿势静默不生效，这条卡住它
    for (const preset of MANNEQUIN_POSE_PRESETS) {
      if (!Object.keys(preset.controls).length)
        continue
      const rotations = getPoseBoneRotations(preset.controls, 'mannequin')
      const anyNonZero = Object.values(rotations).some(r => r.some(v => v !== 0))
      expect(anyNonZero, `姿势「${preset.label}」没有产生任何骨骼旋转`).toBe(true)
    }
  })
})

describe('身体下移', () => {
  function pelvisAt(y: number, scale = 1) {
    const root = new Group()
    root.scale.setScalar(scale)
    const hips = new Bone()
    hips.name = BONE_MAP.body
    hips.position.set(0, y, 0)
    root.add(hips)
    root.updateMatrixWorld(true)
    return { root, hips }
  }

  it('只认有限的米数，过大的值夹住', () => {
    expect(readBodyOffsetY(undefined)).toBe(0)
    expect(readBodyOffsetY({ 'body.offsetY': Number.NaN })).toBe(0)
    expect(readBodyOffsetY({ 'body.offsetY': -0.43 })).toBeCloseTo(-0.43)
    expect(readBodyOffsetY({ 'body.offsetY': -4 })).toBe(-1)
  })

  it('脚还在地面上时，下移不会把脚踩进去', () => {
    const root = new Group()
    const hips = new Bone()
    hips.name = BONE_MAP.body
    hips.position.set(0, 1, 0)
    const foot = new Bone()
    foot.name = BONE_MAP.leftFoot
    foot.position.set(0, -0.8, 0)
    hips.add(foot)
    root.add(hips)
    root.updateMatrixWorld(true)
    const rest = captureRestPose(root)
    const before = foot.getWorldPosition(new Vector3()).y

    applyPose(root, { controls: { 'body.offsetY': -0.43 }, restPose: rest })

    expect(foot.getWorldPosition(new Vector3()).y).toBeCloseTo(before, 3)
    expect(hips.getWorldPosition(new Vector3()).y).toBeCloseTo(1, 3)
  })

  it('蹲下把骨盆往下带，再摆一次不会叠', () => {
    const { root, hips } = pelvisAt(1)
    const rest = captureRestPose(root)

    applyPose(root, { controls: { 'body.offsetY': -0.43 }, restPose: rest })
    applyPose(root, { controls: { 'body.offsetY': -0.43 }, restPose: rest })

    expect(hips.getWorldPosition(new Vector3()).y).toBeCloseTo(0.57, 3)
  })

  it('厘米模型和外层体型缩放都按 0.43 米落地，不重复乘', () => {
    const tiny = pelvisAt(100, 0.01)
    applyPose(tiny.root, { controls: { 'body.offsetY': -0.43 }, restPose: captureRestPose(tiny.root) })
    expect(tiny.hips.getWorldPosition(new Vector3()).y).toBeCloseTo(0.57, 3)

    const { root, hips } = pelvisAt(1)
    const rest = captureRestPose(root)
    const wrapper = new Group()
    wrapper.scale.setScalar(0.56)
    wrapper.add(root)
    wrapper.updateMatrixWorld(true)
    applyPose(root, { controls: { 'body.offsetY': -0.43 }, restPose: rest })

    expect(hips.position.y).toBeCloseTo(0.57, 3)
    expect(hips.getWorldPosition(new Vector3()).y).toBeCloseTo(0.57 * 0.56, 3)
  })

  it('素体蹲下后脚相对站立高度', () => {
    const bytes = readFileSync('public/director-assets/ue-mannequin.glb')
    const jsonLength = bytes.readUInt32LE(12)
    const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8')) as {
      nodes: Array<{ name?: string, translation?: number[], rotation?: number[], scale?: number[], children?: number[] }>
      scenes?: Array<{ nodes?: number[] }>
    }
    const nodes = json.nodes
    const bones = nodes.map((node) => {
      const bone = new Bone()
      bone.name = node.name ?? ''
      if (node.translation)
        bone.position.fromArray(node.translation)
      if (node.rotation)
        bone.quaternion.fromArray(node.rotation)
      if (node.scale)
        bone.scale.fromArray(node.scale)
      return bone
    })
    nodes.forEach((node, index) => {
      for (const child of node.children ?? [])
        bones[index]!.add(bones[child]!)
    })
    const root = new Group()
    for (const index of json.scenes?.[0]?.nodes ?? [0])
      root.add(bones[index]!)
    root.updateMatrixWorld(true)
    const rest = captureRestPose(root)
    const named = (mapped: string) => {
      let found: Bone | undefined
      root.traverse((object) => {
        if (!found && object.name.replace(/ /g, '_') === mapped)
          found = object as Bone
      })
      return found
    }
    const foot = () => {
      const point = new Vector3()
      let min = Number.POSITIVE_INFINITY
      for (const name of [BONE_MAP.leftFoot, BONE_MAP.rightFoot]) {
        const bone = named(name)
        if (bone)
          min = Math.min(min, bone.getWorldPosition(point).y)
      }
      return min
    }
    const hip = () => named(BONE_MAP.body)!.getWorldPosition(new Vector3()).y
    const standFoot = foot()
    const standHip = hip()

    for (const id of ['crouch', 'kneel-one', 'throw', 'push'] as const) {
      const controls = MANNEQUIN_POSE_PRESETS.find(item => item.id === id)!.controls
      applyPose(root, { controls, restPose: rest })
      expect(foot(), id).toBeGreaterThanOrEqual(standFoot - 0.01)
      expect(hip(), id).toBeLessThan(standHip - 0.05)
    }

    const kneel = MANNEQUIN_POSE_PRESETS.find(item => item.id === 'kneel-two')!.controls
    applyPose(root, { controls: kneel, restPose: rest })
    expect(hip()).toBeLessThan(standHip - 0.2)
    expect(foot()).toBeGreaterThan(standFoot)

    const wrapper = new Group()
    wrapper.scale.setScalar(0.56)
    wrapper.add(root)
    wrapper.updateMatrixWorld(true)
    applyPose(root, { controls: MANNEQUIN_POSE_PRESETS.find(item => item.id === 'crouch')!.controls, restPose: rest })
    expect(foot()).toBeGreaterThanOrEqual(standFoot * 0.56 - 0.01)
    expect(hip()).toBeLessThan(standHip * 0.56 - 0.02)
  })
})
