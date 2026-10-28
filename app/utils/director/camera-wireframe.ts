/**
 * 机位在导演视角里的线框形状（复刻自 open-director 的 canvas/SceneRoot.tsx，MIT）。
 *
 * 机位本身不是可见的几何体，靠一组线框表示：机身盒 + 镜头锥 + 两个胶片盘，
 * 外加一个视锥表示它能拍到多大范围。全是纯函数，输出线段数组，
 * 画的事情交给组件。
 *
 * 坐标都在机位自身的局部空间里，+Z 是镜头朝向的反方向
 * （和 three 的相机约定一致：相机看向 -Z，所以视锥往 +Z 画，
 * 组件那边整体转过去）。
 */
import { VIEWPORT_CAMERA_ASPECT, VIEWPORT_CAMERA_FRUSTUM_DEPTH, VIEWPORT_CAMERA_VISUAL_SCALE } from './camera-geometry'

export type WirePoint = [number, number, number]
/** 一条折线；画的时候按相邻点两两连成线段 */
export type WirePolyline = WirePoint[]

const S = VIEWPORT_CAMERA_VISUAL_SCALE

/** 机身盒的中心与尺寸 */
const BODY_CENTER: WirePoint = [0, 0, -0.52 * S]
const BODY_SIZE: WirePoint = [0.4 * S, 0.4 * S, 1 * S]
const BODY_FRONT_Z = BODY_CENTER[2] + BODY_SIZE[2] / 2
/** 镜头尖端，视锥从这里发散 */
export const LENS_TIP: WirePoint = [0, 0, 0.2 * S]

function boxWireframe(center: WirePoint, size: WirePoint): WirePolyline[] {
  const [cx, cy, cz] = center
  const [w, h, d] = size
  const x0 = cx - w / 2
  const x1 = cx + w / 2
  const y0 = cy - h / 2
  const y1 = cy + h / 2
  const z0 = cz - d / 2
  const z1 = cz + d / 2

  // 前后两个方框各画一圈，再用四条棱连起来
  return [
    [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z0]],
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1]],
    [[x0, y0, z0], [x0, y0, z1]],
    [[x1, y0, z0], [x1, y0, z1]],
    [[x1, y1, z0], [x1, y1, z1]],
    [[x0, y1, z0], [x0, y1, z1]],
  ]
}

function circleWireframe(center: WirePoint, radius: number, segments = 32): WirePolyline {
  const [cx, cy, cz] = center
  // 胶片盘立在机身侧面，所以画在 yz 平面上
  return Array.from({ length: segments + 1 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / segments
    return [cx, cy + Math.cos(angle) * radius, cz + Math.sin(angle) * radius] as WirePoint
  })
}

/** 镜头：从机身前脸收缩到一个尖，形状上就是个倒四棱锥 */
function lensWireframe(): WirePolyline[] {
  const r = 0.1 * S
  const backTopLeft: WirePoint = [-r, r, BODY_FRONT_Z]
  const backTopRight: WirePoint = [r, r, BODY_FRONT_Z]
  const backBottomRight: WirePoint = [r, -r, BODY_FRONT_Z]
  const backBottomLeft: WirePoint = [-r, -r, BODY_FRONT_Z]

  return [
    [backTopLeft, backTopRight, backBottomRight, backBottomLeft, backTopLeft],
    [backTopLeft, LENS_TIP],
    [backTopRight, LENS_TIP],
    [backBottomRight, LENS_TIP],
    [backBottomLeft, LENS_TIP],
  ]
}

/** 实心机身，远看也能认出是一台相机，不只靠 1px 线 */
export function getCameraBodySolid() {
  return { center: BODY_CENTER, size: BODY_SIZE }
}

export function getCameraLensSolid() {
  const radius = 0.1 * S
  const z0 = BODY_FRONT_Z
  const z1 = LENS_TIP[2]
  return {
    radius,
    length: z1 - z0,
    position: [0, 0, (z0 + z1) / 2] as WirePoint,
  }
}

/** 视锥远端的取景框，铺一层半透明面，线框在亮底上才不会隐掉 */
export function getCameraFrustumFarPlane(fov: number) {
  const depth = VIEWPORT_CAMERA_FRUSTUM_DEPTH
  const safeFov = Math.min(179, Math.max(1, fov))
  const halfHeight = Math.tan((safeFov * Math.PI) / 360) * depth
  const halfWidth = halfHeight * VIEWPORT_CAMERA_ASPECT
  return {
    position: [0, 0, depth] as WirePoint,
    size: [halfWidth * 2, halfHeight * 2] as [number, number],
  }
}

/** 机身 + 镜头 + 两个胶片盘 */
export function getCameraBodyWireframe(): WirePolyline[] {
  return [
    ...boxWireframe(BODY_CENTER, BODY_SIZE),
    ...lensWireframe(),
    circleWireframe([0, 0.44 * S, -0.78 * S], 0.21 * S),
    circleWireframe([0, 0.44 * S, -0.34 * S], 0.21 * S),
  ]
}

/**
 * 视锥：从镜头尖发散到一个 16:9 的取景框。
 * fov 是垂直视角，越大框越大，所以改焦距时能直观看出取景范围的变化。
 */
export function getCameraFrustumWireframe(fov: number): WirePolyline[] {
  const depth = VIEWPORT_CAMERA_FRUSTUM_DEPTH
  // fov 夹在 1~179：0 会让 tan 退化成 0，180 直接发散
  const safeFov = Math.min(179, Math.max(1, fov))
  const halfHeight = Math.tan((safeFov * Math.PI) / 360) * depth
  const halfWidth = halfHeight * VIEWPORT_CAMERA_ASPECT

  const topLeft: WirePoint = [-halfWidth, halfHeight, depth]
  const topRight: WirePoint = [halfWidth, halfHeight, depth]
  const bottomRight: WirePoint = [halfWidth, -halfHeight, depth]
  const bottomLeft: WirePoint = [-halfWidth, -halfHeight, depth]

  return [
    [LENS_TIP, topLeft],
    [LENS_TIP, topRight],
    [LENS_TIP, bottomRight],
    [LENS_TIP, bottomLeft],
    [topLeft, topRight, bottomRight, bottomLeft, topLeft],
  ]
}

/**
 * 机身的包围盒，用来做点选命中区。
 * 线框太细，直接拿线去命中射线几乎点不中，所以套一个看不见的实体盒子。
 */
export function getCameraHitBox() {
  const points = getCameraBodyWireframe().flat()
  const xs = points.map(p => p[0])
  const ys = points.map(p => p[1])
  const zs = points.map(p => p[2])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const minZ = Math.min(...zs)
  const maxZ = Math.max(...zs)
  const padding = 0.06

  return {
    size: [
      maxX - minX + padding * 2,
      maxY - minY + padding * 2,
      maxZ - minZ + padding * 2,
    ] as WirePoint,
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2] as WirePoint,
  }
}

/** 把折线数组摊平成 LineSegments 要的顶点序列（相邻两点一段） */
export function toLineSegmentPositions(polylines: WirePolyline[]): Float32Array {
  const values: number[] = []
  for (const line of polylines) {
    for (let i = 0; i < line.length - 1; i++) {
      values.push(...line[i]!, ...line[i + 1]!)
    }
  }
  return new Float32Array(values)
}
