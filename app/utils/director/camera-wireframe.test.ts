import { describe, expect, it } from 'vitest'
import {
  getCameraBodySolid,
  getCameraBodyWireframe,
  getCameraFrustumFarPlane,
  getCameraFrustumWireframe,
  getCameraHitBox,
  getCameraLensSolid,
  LENS_TIP,
  toLineSegmentPositions,
} from './camera-wireframe'
import { VIEWPORT_CAMERA_ASPECT, VIEWPORT_CAMERA_FRUSTUM_DEPTH } from './camera-geometry'

describe('机身线框', () => {
  it('每条折线至少两个点，摊平后没有落单的顶点', () => {
    const lines = getCameraBodyWireframe()
    for (const line of lines)
      expect(line.length).toBeGreaterThanOrEqual(2)

    const positions = toLineSegmentPositions(lines)
    // LineSegments 按两点一段消费，顶点数必须是 6 的倍数（每段两点、每点三个分量）
    expect(positions.length % 6).toBe(0)
  })

  it('所有坐标都是有限值', () => {
    for (const value of toLineSegmentPositions(getCameraBodyWireframe()))
      expect(Number.isFinite(value)).toBe(true)
  })
})

describe('视锥', () => {
  it('fov 越大取景框越大', () => {
    const narrow = getCameraFrustumWireframe(20)
    const wide = getCameraFrustumWireframe(80)
    const halfHeightOf = (lines: ReturnType<typeof getCameraFrustumWireframe>) => lines[0]![1]![1]

    expect(halfHeightOf(wide)).toBeGreaterThan(halfHeightOf(narrow))
  })

  it('取景框是 16:9', () => {
    const lines = getCameraFrustumWireframe(50)
    const corner = lines[0]![1]!
    expect(Math.abs(corner[0]) / Math.abs(corner[1])).toBeCloseTo(VIEWPORT_CAMERA_ASPECT, 5)
  })

  it('远端落在视锥深度上', () => {
    expect(getCameraFrustumWireframe(50)[0]![1]![2]).toBeCloseTo(VIEWPORT_CAMERA_FRUSTUM_DEPTH, 5)
  })

  it('四条棱都从镜头尖发出', () => {
    const lines = getCameraFrustumWireframe(50)
    for (let i = 0; i < 4; i++)
      expect(lines[i]![0]).toEqual(LENS_TIP)
  })

  it('极端 fov 被夹住，不会算出无穷大', () => {
    // 0 会让 tan 退化，180 直接发散
    for (const fov of [0, -30, 180, 999]) {
      for (const line of getCameraFrustumWireframe(fov)) {
        for (const point of line)
          expect(point.every(Number.isFinite), `fov=${fov}`).toBe(true)
      }
    }
  })
})

describe('实心机身', () => {
  it('机身盒包在线框范围内', () => {
    const { center, size } = getCameraBodySolid()
    const points = getCameraBodyWireframe().flat()
    for (const axis of [0, 1, 2] as const) {
      const values = points.map(p => p[axis])
      expect(center[axis] - size[axis] / 2).toBeGreaterThanOrEqual(Math.min(...values) - 1e-6)
      expect(center[axis] + size[axis] / 2).toBeLessThanOrEqual(Math.max(...values) + 1e-6)
    }
  })

  it('镜头实心落在机身和镜头尖之间', () => {
    const lens = getCameraLensSolid()
    expect(lens.length).toBeGreaterThan(0)
    expect(lens.position[2]).toBeGreaterThan(getCameraBodySolid().center[2])
    expect(lens.position[2]).toBeLessThan(LENS_TIP[2])
  })
})

describe('视锥取景面', () => {
  it('远端尺寸和线框四角对得上', () => {
    const plane = getCameraFrustumFarPlane(50)
    const corner = getCameraFrustumWireframe(50)[0]![1]!
    expect(plane.position[2]).toBeCloseTo(VIEWPORT_CAMERA_FRUSTUM_DEPTH, 5)
    expect(plane.size[0] / 2).toBeCloseTo(Math.abs(corner[0]!), 5)
    expect(plane.size[1] / 2).toBeCloseTo(Math.abs(corner[1]!), 5)
  })
})

describe('命中盒', () => {
  it('包住整个机身线框并留出余量', () => {
    const points = getCameraBodyWireframe().flat()
    const box = getCameraHitBox()

    for (let axis = 0; axis < 3; axis++) {
      const values = points.map(p => p[axis]!)
      const extent = Math.max(...values) - Math.min(...values)
      expect(box.size[axis]).toBeGreaterThan(extent)
    }
  })
})
