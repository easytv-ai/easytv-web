/**
 * 离开导演台时的封面取景：把场上所有看得见的对象收进同一框。
 * 只算位置和体量，不碰 three，方便单测。
 */
import type { DirectorObject } from './schema'

export const DEFAULT_OVERVIEW_POSITION: [number, number, number] = [9, 5.5, 11]
export const DEFAULT_OVERVIEW_TARGET: [number, number, number] = [0, 1, 3]
export const DEFAULT_OVERVIEW_FOV = 45

const OBJECT_RADIUS: Record<string, number> = {
  character: 0.95,
  camera: 0.7,
  prop: 0.8,
  scene: 0.8,
}

function radiusOf(object: DirectorObject) {
  const scale = Math.max(...object.transform.scale, 1)
  return (OBJECT_RADIUS[object.kind] ?? 0.8) * scale
}

export function getVisibleOverviewObjects(objects: DirectorObject[]) {
  return objects.filter(item => item.visible && item.kind !== 'panorama')
}

export function getSceneOverviewPose(objects: DirectorObject[]) {
  const visible = getVisibleOverviewObjects(objects)
  if (!visible.length) {
    return {
      position: DEFAULT_OVERVIEW_POSITION,
      target: DEFAULT_OVERVIEW_TARGET,
      fov: DEFAULT_OVERVIEW_FOV,
    }
  }

  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity

  for (const item of visible) {
    const [x, y, z] = item.transform.position
    const r = radiusOf(item)
    minX = Math.min(minX, x - r)
    minY = Math.min(minY, y)
    minZ = Math.min(minZ, z - r)
    maxX = Math.max(maxX, x + r)
    maxY = Math.max(maxY, y + r * 2)
    maxZ = Math.max(maxZ, z + r)
  }

  const target: [number, number, number] = [
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    (minZ + maxZ) / 2,
  ]
  const span = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ)
  const radius = Math.max(span / 2, 2.4)
  const fov = DEFAULT_OVERVIEW_FOV
  const distance = (radius * 1.45) / Math.tan((fov * Math.PI / 180) / 2)
  const length = Math.hypot(...DEFAULT_OVERVIEW_POSITION) || 1
  const position: [number, number, number] = [
    target[0] + (DEFAULT_OVERVIEW_POSITION[0] / length) * distance,
    target[1] + (DEFAULT_OVERVIEW_POSITION[1] / length) * distance,
    target[2] + (DEFAULT_OVERVIEW_POSITION[2] / length) * distance,
  ]

  return { position, target, fov }
}
