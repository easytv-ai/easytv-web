/**
 * 机位的几何换算（复刻自 open-director 的 schema/cameraGeometry.ts，MIT）。
 *
 * 机位在场景里是一个带视锥线框的物体，它的「位置」有两个含义：
 * - 机身位置（transform.position）：线框根部，也就是用户拖动的那个点
 * - 取景位置（视锥的远端中心）：真正出画面的相机放在这里
 *
 * 两者差一个视锥深度。面板上填的是机身，渲染和截图用的是取景，所以来回都要换算。
 */
import { Euler, Vector3 } from 'three'
import type { DirectorCameraShot } from './schema'

export interface CameraViewSnapshot {
  fov: number
  position: [number, number, number]
  target: [number, number, number]
}

export const VIEWPORT_CAMERA_ASPECT = 16 / 9
export const VIEWPORT_CAMERA_VISUAL_SCALE = 0.35
export const VIEWPORT_CAMERA_FRUSTUM_DEPTH = 5.2 * VIEWPORT_CAMERA_VISUAL_SCALE
export const VIEWPORT_CAMERA_FRUSTUM_FRAME_WIDTH = 3.2 * VIEWPORT_CAMERA_VISUAL_SCALE

export const DEFAULT_DIRECTOR_CAMERA_VIEW_SNAPSHOT: CameraViewSnapshot = {
  fov: 50,
  position: [0, 1.55, 5.4],
  target: [0, 1.05, 0],
}

/** 机位和注视点重合时方向退化，给一个默认朝向兜住 */
function getForwardDirection(position: [number, number, number], target: [number, number, number]) {
  const direction = new Vector3(...target).sub(new Vector3(...position))
  return direction.lengthSq() === 0 ? new Vector3(0, 0, -1) : direction.normalize()
}

/** 存进 project 的坐标统一收敛到 6 位小数，免得浮点尾巴把 JSON 撑大、diff 变脏 */
function toTuple(vector: Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z].map(value => Number(value.toFixed(6))) as [number, number, number]
}

/** 机身位置 → 取景位置 */
export function getCameraViewSnapshotFromShot(camera: DirectorCameraShot): CameraViewSnapshot {
  const rigPosition = new Vector3(...camera.transform.position)
  const forward = getForwardDirection(camera.transform.position, camera.target)
  const viewPosition = rigPosition.add(forward.multiplyScalar(VIEWPORT_CAMERA_FRUSTUM_DEPTH))

  return {
    fov: camera.fov,
    position: toTuple(viewPosition),
    target: camera.target,
  }
}

/**
 * 机身旋转反推注视点。线框是按 +Z 朝向目标画的，
 * 所以这里用局部 +Z 转出去，再按原来的注视距离落点。
 */
export function getCameraTargetFromRigRotation(
  position: [number, number, number],
  rotation: [number, number, number],
  distance: number,
): [number, number, number] {
  const origin = new Vector3(...position)
  const forward = new Vector3(0, 0, 1).applyEuler(new Euler(...rotation))
  return toTuple(origin.add(forward.multiplyScalar(Math.max(distance, 0.001))))
}

/** 取景位置 → 机身位置 */
export function getCameraRigPositionFromViewSnapshot(snapshot: CameraViewSnapshot): [number, number, number] {
  const viewPosition = new Vector3(...snapshot.position)
  const forward = getForwardDirection(snapshot.position, snapshot.target)
  const rigPosition = viewPosition.sub(forward.multiplyScalar(VIEWPORT_CAMERA_FRUSTUM_DEPTH))

  return toTuple(rigPosition)
}
