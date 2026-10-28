import { describe, expect, it } from 'vitest'
import {
  CAMERA_GLIDE_MAX_MS,
  CAMERA_GLIDE_MIN_MS,
  CAMERA_GLIDE_MS,
  CAMERA_GLIDE_MS_PER_PX,
  canvasApproachFactor,
  canvasEaseOutCubic,
  canvasRevealShift,
  canvasTweenDuration,
  canvasViewportAt,
  canvasViewportSettled,
  prefersReducedMotion,
} from './canvas-viewport-tween'

describe('canvasEaseOutCubic', () => {
  it('两端精确：t=0 → 0、t=1 → 1', () => {
    expect(canvasEaseOutCubic(0)).toBe(0)
    expect(canvasEaseOutCubic(1)).toBe(1)
  })

  it('越界的 t 夹到 [0,1]（补间最后几帧可能因为时钟精度超过 1）', () => {
    expect(canvasEaseOutCubic(-0.4)).toBe(0)
    expect(canvasEaseOutCubic(1.4)).toBe(1)
  })

  it('单调递增，中点 = 1-(1-0.5)^3', () => {
    expect(canvasEaseOutCubic(0.5)).toBeCloseTo(0.875, 10)
    let last = -1
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const value = canvasEaseOutCubic(t)
      expect(value).toBeGreaterThanOrEqual(last)
      last = value
    }
  })
})

describe('canvasViewportAt', () => {
  const from = { x: 0, y: 0, zoom: 1 }
  const to = { x: 200, y: -100, zoom: 1 }

  it('t=0 落在起点、t=1 落在终点（收尾不留亚像素误差）', () => {
    expect(canvasViewportAt(from, to, 0)).toEqual(from)
    expect(canvasViewportAt(from, to, 1)).toEqual(to)
  })

  it('中途按 easeOutCubic 插值：0.5 处已经走了 87.5%', () => {
    expect(canvasViewportAt(from, to, 0.5)).toEqual({ x: 175, y: -87.5, zoom: 1 })
  })

  it('zoom 也走同一条插值（跟练两处调用 zoom 恒等，这里只保证函数自洽）', () => {
    expect(canvasViewportAt({ x: 0, y: 0, zoom: 1 }, { x: 0, y: 0, zoom: 2 }, 1)).toEqual({ x: 0, y: 0, zoom: 2 })
  })
})

describe('canvasTweenDuration', () => {
  it('位移为 0 也夹到下限 200ms，不会退化成瞬移', () => {
    expect(canvasTweenDuration({ x: 0, y: 0, zoom: 1 }, { x: 0, y: 0, zoom: 1 })).toBe(CAMERA_GLIDE_MIN_MS)
    expect(CAMERA_GLIDE_MIN_MS).toBe(200)
  })

  it('典型位移按 160 + 0.25px：400px → 260ms', () => {
    expect(canvasTweenDuration({ x: 0, y: 0, zoom: 1 }, { x: 400, y: 0, zoom: 1 })).toBe(260)
    expect(CAMERA_GLIDE_MS_PER_PX).toBe(0.25)
  })

  it('位移取 x/y 的欧氏距离，斜向不按分量之和算', () => {
    expect(canvasTweenDuration({ x: 0, y: 0, zoom: 1 }, { x: 300, y: 400, zoom: 1 })).toBe(285)
  })

  it('超远位移夹到上限 420ms', () => {
    expect(canvasTweenDuration({ x: 0, y: 0, zoom: 1 }, { x: 4000, y: 0, zoom: 1 })).toBe(CAMERA_GLIDE_MAX_MS)
    expect(CAMERA_GLIDE_MAX_MS).toBe(420)
  })

  it('三个参数都能覆盖（缩放差按 1200px/倍折算成等效位移）', () => {
    expect(canvasTweenDuration({ x: 0, y: 0, zoom: 1 }, { x: 0, y: 0, zoom: 2 })).toBe(420)
    expect(canvasTweenDuration({ x: 0, y: 0, zoom: 1 }, { x: 40, y: 0, zoom: 1 }, { minMs: 0, maxMs: 9999 })).toBe(170)
    expect(canvasTweenDuration({ x: 0, y: 0, zoom: 1 }, { x: 400, y: 0, zoom: 1 }, { msPerPx: 0.5 })).toBe(360)
  })

  it('与 CSS 令牌 --st-motion-camera 同值（改一边忘了另一边由这条挡下）', () => {
    expect(CAMERA_GLIDE_MS).toBe(260)
  })
})

describe('canvasViewportSettled', () => {
  it('dx / dy 在 0.5px 以内、dzoom 在 0.001 以内算收敛', () => {
    expect(canvasViewportSettled({ x: 0, y: 0, zoom: 1 }, { x: 0.49, y: -0.49, zoom: 1.0009 })).toBe(true)
    expect(canvasViewportSettled({ x: 0, y: 0, zoom: 1 }, { x: 0.5, y: 0, zoom: 1 })).toBe(false)
    expect(canvasViewportSettled({ x: 0, y: 0, zoom: 1 }, { x: 0, y: 0, zoom: 1.01 })).toBe(false)
    expect(canvasViewportSettled({ x: 12, y: 40, zoom: 1 }, { x: 12, y: 40, zoom: 1 })).toBe(true)
  })
})

describe('canvasRevealShift（锚点在舞台内的四种越界）', () => {
  const pane = { left: 100, top: 50, width: 800, height: 600 }

  it('左边越界：往右推（dx > 0），dy 不动', () => {
    const shift = canvasRevealShift({ left: 80, top: 300, right: 300, bottom: 420, height: 120 }, pane)
    expect(shift).toEqual({ dx: 36, dy: 0 })
  })

  it('右边越界：往左推（dx < 0）', () => {
    const shift = canvasRevealShift({ left: 820, top: 300, right: 1000, bottom: 420, height: 120 }, pane)
    expect(shift).toEqual({ dx: -116, dy: 0 })
  })

  it('上边越界：往下推（dy > 0）', () => {
    const shift = canvasRevealShift({ left: 300, top: 20, right: 500, bottom: 160, height: 140 }, pane)
    expect(shift).toEqual({ dx: 0, dy: 46 })
  })

  it('下边越界：往上推（dy < 0）', () => {
    const shift = canvasRevealShift({ left: 300, top: 560, right: 500, bottom: 720, height: 160 }, pane)
    expect(shift).toEqual({ dx: 0, dy: -86 })
  })

  it('元素比舞台还高：只保证顶部对齐（底边交给用户自己看）', () => {
    const shift = canvasRevealShift({ left: 300, top: 420, right: 500, bottom: 1120, height: 700 }, pane)
    expect(shift).toEqual({ dx: 0, dy: -354 })
  })

  it('完全在舞台内：不位移', () => {
    expect(canvasRevealShift({ left: 200, top: 200, right: 400, bottom: 340, height: 140 }, pane)).toEqual({ dx: 0, dy: 0 })
  })

  it('内边距可调（pad 变大时同一矩形开始越界）', () => {
    expect(canvasRevealShift({ left: 140, top: 200, right: 400, bottom: 340, height: 140 }, pane, 60)).toEqual({ dx: 20, dy: 0 })
  })
})

describe('canvasApproachFactor', () => {
  it('一个半衰期后误差减半', () => {
    expect(canvasApproachFactor(90, 90)).toBeCloseTo(0.5, 10)
  })

  it('帧率无关：16.7ms 两次 ≈ 33.4ms 一次', () => {
    const twice = 1 - (1 - canvasApproachFactor(16.7, 90)) * (1 - canvasApproachFactor(16.7, 90))
    expect(twice).toBeCloseTo(canvasApproachFactor(33.4, 90), 6)
  })

  it('halfLife <= 0 直落（相机补间在飞 / 换锚点 / reduced-motion）', () => {
    expect(canvasApproachFactor(16.7, 0)).toBe(1)
    expect(canvasApproachFactor(16.7, -5)).toBe(1)
  })

  it('dt 为 0 或非有限值时不推进（避免 NaN 写进样式）', () => {
    expect(canvasApproachFactor(0, 90)).toBe(0)
    expect(canvasApproachFactor(Number.NaN, 90)).toBe(0)
    expect(canvasApproachFactor(Number.POSITIVE_INFINITY, 90)).toBe(0)
  })
})

describe('prefersReducedMotion', () => {
  it('读注入的 matcher：命中即降级', () => {
    expect(prefersReducedMotion({ matchMedia: () => ({ matches: true }) })).toBe(true)
    expect(prefersReducedMotion({ matchMedia: () => ({ matches: false }) })).toBe(false)
  })

  it('无 window / 无 matchMedia（SSR、老环境）返回 false，不抛', () => {
    expect(prefersReducedMotion({})).toBe(false)
  })

  it('matcher 抛异常时当作不降级', () => {
    expect(prefersReducedMotion({ matchMedia: () => { throw new Error('nope') } })).toBe(false)
  })
})
