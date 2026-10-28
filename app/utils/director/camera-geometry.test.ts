import { describe, expect, it } from 'vitest'
import {
  getCameraRigPositionFromViewSnapshot,
  getCameraTargetFromRigRotation,
  getCameraViewSnapshotFromShot,
  VIEWPORT_CAMERA_FRUSTUM_DEPTH,
  VIEWPORT_CAMERA_FRUSTUM_FRAME_WIDTH,
  VIEWPORT_CAMERA_VISUAL_SCALE,
} from './camera-geometry'
import { createDefaultDirectorProject } from './default-project'

describe('机位的机身位置与取景位置换算', () => {
  it('取景点落在机身前方一个视锥深度处', () => {
    const camera = createDefaultDirectorProject().cameras[0]!
    const snapshot = getCameraViewSnapshotFromShot(camera)

    // 默认机位在 +Z 看向原点，取景点应该比机身更靠近原点
    expect(snapshot.position[2]).toBeLessThan(camera.transform.position[2])
    expect(snapshot.target).toEqual(camera.target)
    expect(snapshot.fov).toBe(camera.fov)
  })

  it('由取景点反推机身位置时往后退同样的深度', () => {
    const snapshot = {
      fov: 50,
      position: [0, 1.62, 3.8] as [number, number, number],
      target: [0, 1.2, 0] as [number, number, number],
    }
    const rigPosition = getCameraRigPositionFromViewSnapshot(snapshot)

    expect(rigPosition[2]).toBeGreaterThan(snapshot.position[2])
    expect(rigPosition[2] - snapshot.position[2]).toBeGreaterThan(VIEWPORT_CAMERA_FRUSTUM_DEPTH * 0.9)
  })

  it('来回换算能回到原点', () => {
    // 这条是上游没有的：两个方向互为逆运算，任何一边改了系数都会在这里炸
    const camera = createDefaultDirectorProject().cameras[0]!
    const snapshot = getCameraViewSnapshotFromShot(camera)
    const backToRig = getCameraRigPositionFromViewSnapshot(snapshot)

    for (let i = 0; i < 3; i++)
      expect(backToRig[i]).toBeCloseTo(camera.transform.position[i]!, 5)
  })

  it('机身零旋转时注视点在 +Z 上', () => {
    expect(getCameraTargetFromRigRotation([0, 1, 0], [0, 0, 0], 5)).toEqual([0, 1, 5])
  })

  it('视锥的尺寸都由同一个视觉缩放系数推出来', () => {
    expect(VIEWPORT_CAMERA_VISUAL_SCALE).toBeCloseTo(0.35)
    expect(VIEWPORT_CAMERA_FRUSTUM_DEPTH).toBeCloseTo(5.2 * VIEWPORT_CAMERA_VISUAL_SCALE)
    expect(VIEWPORT_CAMERA_FRUSTUM_FRAME_WIDTH).toBeCloseTo(3.2 * VIEWPORT_CAMERA_VISUAL_SCALE)
  })
})
