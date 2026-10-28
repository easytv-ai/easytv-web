/**
 * 从运镜路径的起止姿态认出推、横移、升降、摇、俯仰、变焦、环绕、滚转、停。
 * 只比较这一镜两端的机位，不看曲线中途，也不渲染。
 * 认出来的 id 交给 previewShotPrompt，文案仍只来自运镜词表。
 *
 * 沿视线走得远算推或拉；横着走算左移或右移；上下走算抬升或下降；
 * 原地转头算左摇或右摇；抬头低头算上摇或下摇；绕视线转算滚筒旋转；
 * fov 变小算变焦推进、变大算拉远；横着走同时往反方向转头（围着注视点转）算环绕；
 * 位移、转角和焦距都很小算固定镜头。
 */
import { Euler, Quaternion, Vector3 } from 'three'
import type { CameraNode, DirectorCameraShot } from '../schema'
import { previewFocalFromFov, previewShotPrompt, previewShotSizeFromFov, type PreviewShotMove } from './preview-move-prompt'

/** 小于这个位移（米）不算在动 */
export const PREVIEW_MOVE_DISTANCE = 0.15
/** 小于这个水平转角（弧度）不算摇 */
export const PREVIEW_YAW_RADIANS = 0.08
/** 小于这个俯仰角（弧度）不算上摇 / 下摇 */
export const PREVIEW_PITCH_RADIANS = 0.08
/** 小于这个垂直 fov（度）不算变焦 */
export const PREVIEW_FOV_DEGREES = 4
/** 小于这个滚转角（弧度）不算滚筒旋转 */
export const PREVIEW_ROLL_RADIANS = 0.08
/** 某一方向的分量要占到位移的这个比例，才写成那一句 */
const ALONG_SHARE = 0.7

function orientationOf(node: CameraNode) {
  return new Quaternion(...node.rotation).normalize()
}

function forwardOf(node: CameraNode) {
  return new Vector3(0, 0, -1).applyQuaternion(orientationOf(node))
}

/** 机位右侧在水平面上的方向。俯仰时仍按左右移，不跟竖轴抢 */
function rightOf(node: CameraNode) {
  const right = new Vector3(1, 0, 0).applyQuaternion(orientationOf(node))
  right.y = 0
  return right.lengthSq() < 1e-8 ? new Vector3() : right.normalize()
}

/** 从起点朝向转到终点朝向的水平角。正值是向左转（镜头左摇） */
function yawDelta(from: CameraNode, to: CameraNode) {
  const a = forwardOf(from)
  const b = forwardOf(to)
  const aLen = Math.hypot(a.x, a.z)
  const bLen = Math.hypot(b.x, b.z)
  if (aLen < 1e-8 || bLen < 1e-8)
    return 0
  const ax = a.x / aLen
  const az = a.z / aLen
  const bx = b.x / bLen
  const bz = b.z / bLen
  return Math.atan2(az * bx - ax * bz, ax * bx + az * bz)
}

/** 视线相对水平面的仰角。正值是抬头 */
function pitchOf(node: CameraNode) {
  const forward = forwardOf(node)
  return Math.atan2(forward.y, Math.hypot(forward.x, forward.z))
}

/** 绕视线的滚转。和落点四元数同一套 YXZ，z 就是滚 */
function rollOf(node: CameraNode) {
  return new Euler().setFromQuaternion(orientationOf(node), 'YXZ').z
}

function wrapAngle(rad: number) {
  const turned = ((rad + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI
  return turned
}

/** 一镜两端。返回词表 id；对不上词表动作时是空数组 */
export function classifyPreviewShotMove(from: CameraNode, to: CameraNode) {
  const delta = new Vector3(...to.position).sub(new Vector3(...from.position))
  const distance = delta.length()
  const along = delta.dot(forwardOf(from))
  const across = delta.dot(rightOf(from))
  const vertical = delta.y
  const yaw = yawDelta(from, to)
  const pitch = pitchOf(to) - pitchOf(from)
  const roll = wrapAngle(rollOf(to) - rollOf(from))
  const fovDelta = to.fov - from.fov
  const moving = distance >= PREVIEW_MOVE_DISTANCE
  const turning = Math.abs(yaw) >= PREVIEW_YAW_RADIANS
  const pitching = Math.abs(pitch) >= PREVIEW_PITCH_RADIANS
  const rolling = Math.abs(roll) >= PREVIEW_ROLL_RADIANS
  const zooming = Math.abs(fovDelta) >= PREVIEW_FOV_DEGREES
  if (!moving && !turning && !pitching && !rolling && !zooming)
    return ['static']

  const alongShare = moving ? Math.abs(along) / distance : 0
  const acrossShare = moving ? Math.abs(across) / distance : 0
  // 右移同时左摇（或左移同时右摇）：围着注视点转，写成环绕，不再拆成横移+摇
  const orbiting = moving && turning && acrossShare >= ALONG_SHARE && alongShare < ALONG_SHARE && across * yaw > 0

  // 前推同时拉远（或后移同时推近）：柯克变焦，不再拆成推+变焦
  const dollyZooming = moving && zooming && alongShare >= ALONG_SHARE && along * fovDelta > 0
  // 环绕同时升降：盘旋，不再拆成环绕+升降
  const lifting = moving && Math.abs(vertical) / distance >= ALONG_SHARE
  const spiraling = orbiting && lifting

  const ids: string[] = []
  if (spiraling)
    ids.push(vertical > 0 ? 'spiral-up' : 'spiral-down')
  else if (orbiting)
    ids.push('orbit')
  else {
    if (alongShare >= ALONG_SHARE && !dollyZooming)
      ids.push(along > 0 ? 'dolly-in' : 'dolly-out')
    if (acrossShare >= ALONG_SHARE)
      ids.push(across > 0 ? 'truck-right' : 'truck-left')
    if (turning)
      ids.push(yaw > 0 ? 'pan-left' : 'pan-right')
  }
  if (lifting && !spiraling)
    ids.push(vertical > 0 ? 'crane-up' : 'crane-down')
  if (pitching)
    ids.push(pitch > 0 ? 'tilt-up' : 'tilt-down')
  if (rolling)
    ids.push('roll')
  if (dollyZooming)
    ids.push('dolly-zoom')
  else if (zooming)
    ids.push(fovDelta < 0 ? 'zoom-in' : 'zoom-out')
  return ids
}

/**
 * 和 previewShotRanges 对齐：相邻两个运镜节点一镜。
 * 只有一个节点时没有位移，记成固定镜头。
 */
export function classifyPreviewMoves(camera: Pick<DirectorCameraShot, 'nodes' | 'segments'>): PreviewShotMove[] {
  const nodes = camera.nodes ?? []
  if (!nodes.length)
    return []
  if (nodes.length === 1)
    return [{ moves: ['static'] }]
  return nodes.slice(0, -1).map((from, index) => ({
    moves: classifyPreviewShotMove(from, nodes[index + 1]!),
  }))
}

/** 每镜一句提示词，下标和 planPreviewFrames 的 shotIndex 一致；景别和焦段取这一镜起点的 fov */
export function previewShotPromptsFromPath(camera: Pick<DirectorCameraShot, 'nodes' | 'segments'>) {
  const nodes = camera.nodes ?? []
  return classifyPreviewMoves(camera).map((shot, index) => {
    const fov = nodes[index]?.fov ?? nodes[0]?.fov ?? 50
    return previewShotPrompt({
      ...shot,
      framing: previewShotSizeFromFov(fov),
      focal: previewFocalFromFov(fov),
    })
  })
}
