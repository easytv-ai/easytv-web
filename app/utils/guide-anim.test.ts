import { describe, expect, it } from 'vitest'
import {
  GUIDE_CARD_GLIDE_CLASS,
  GUIDE_CARD_HALF_LIFE_MS,
  GUIDE_SETTLE_PX,
  GUIDE_SPOT_HALF_LIFE_MS,
  guideApproach,
  guideApproachFactor,
  guideCardTransform,
  guideReducedMotion,
  guideSpotFullscreen,
  guideSpotRect,
} from './guide-anim'
import type { GuideRect } from './canvas-guide-card'

const win = { width: 1280, height: 800 }

describe('guideApproachFactor', () => {
  it('dt <= 0 不动；halfLife <= 0 视为直落（k = 1）', () => {
    expect(guideApproachFactor(0, GUIDE_SPOT_HALF_LIFE_MS)).toBe(0)
    expect(guideApproachFactor(16.7, 0)).toBe(1)
    expect(guideApproachFactor(16.7, -1)).toBe(1)
  })

  it('一个半衰期走掉一半，且随 dt 单调增', () => {
    expect(guideApproachFactor(GUIDE_SPOT_HALF_LIFE_MS, GUIDE_SPOT_HALF_LIFE_MS)).toBeCloseTo(0.5, 10)
    expect(guideApproachFactor(200, GUIDE_SPOT_HALF_LIFE_MS)).toBeGreaterThan(guideApproachFactor(100, GUIDE_SPOT_HALF_LIFE_MS))
  })

  it('帧率无关：16.7ms 走两帧 ≈ 33.4ms 走一帧', () => {
    const twice = (1 - guideApproachFactor(16.7, GUIDE_SPOT_HALF_LIFE_MS)) ** 2
    const once = 1 - guideApproachFactor(33.4, GUIDE_SPOT_HALF_LIFE_MS)
    expect(twice).toBeCloseTo(once, 6)
  })
})

describe('guideApproach', () => {
  it('halfLife <= 0 直落目标值', () => {
    expect(guideApproach(0, 100, 16.7, 0)).toBe(100)
    expect(guideApproach(300, -40, 16.7, -5)).toBe(-40)
  })

  it('dt <= 0 在平滑档下原地不动（手动触发那一拍交给直落分支）', () => {
    expect(guideApproach(10, 100, 0, GUIDE_SPOT_HALF_LIFE_MS)).toBe(10)
  })

  it('单调趋近且不过冲', () => {
    let cur = 0
    for (let i = 0; i < 60; i++) {
      const next = guideApproach(cur, 100, 16.7, GUIDE_SPOT_HALF_LIFE_MS)
      expect(next).toBeGreaterThanOrEqual(cur)
      expect(next).toBeLessThanOrEqual(100)
      cur = next
    }
    expect(cur).toBe(100)
  })

  it('两个 16.7ms 的帧 ≈ 一个 33.4ms 的帧（帧率无关）', () => {
    const a = guideApproach(guideApproach(0, 400, 16.7, GUIDE_SPOT_HALF_LIFE_MS), 400, 16.7, GUIDE_SPOT_HALF_LIFE_MS)
    const b = guideApproach(0, 400, 33.4, GUIDE_SPOT_HALF_LIFE_MS)
    expect(Math.abs(a - b)).toBeLessThan(0.5)
  })

  it('收敛到阈值内就落定目标精确值（稳态不再写亚像素差）', () => {
    const cur = 100 - GUIDE_SETTLE_PX / 2
    expect(guideApproach(cur, 100, 16.7, GUIDE_SPOT_HALF_LIFE_MS)).toBe(100)
  })

  it('卡片半衰期比聚光更钝（同一帧走得更少）', () => {
    const spot = guideApproach(0, 100, 16.7, GUIDE_SPOT_HALF_LIFE_MS)
    const card = guideApproach(0, 100, 16.7, GUIDE_CARD_HALF_LIFE_MS)
    expect(card).toBeLessThan(spot)
  })
})

describe('guideSpotRect', () => {
  it('锚点外扩 pad，靠窗口边时至少留 8px', () => {
    const rect: GuideRect = { left: 4, top: 2, width: 100, height: 60 }
    expect(guideSpotRect(rect, 8, win)).toEqual({ left: 8, top: 8, width: 116, height: 76 })
  })

  it('贴右缘时宽度夹到 innerWidth - 16', () => {
    const rect: GuideRect = { left: 1200, top: 100, width: 1260, height: 40 }
    expect(guideSpotRect(rect, 8, win).width).toBe(win.width - 16)
  })

  it('正常位置：左 / 上外扩、尺寸加两倍 pad', () => {
    const rect: GuideRect = { left: 600, top: 300, width: 200, height: 120 }
    expect(guideSpotRect(rect, 8, win)).toEqual({ left: 592, top: 292, width: 216, height: 136 })
  })
})

describe('guideSpotFullscreen', () => {
  it('锚点不在时补成整视口（不是 {0,0,0,0}，那会出现一条线扫过）', () => {
    expect(guideSpotFullscreen(win)).toEqual({ left: 0, top: 0, width: 1280, height: 800 })
  })
})

describe('guideCardTransform', () => {
  it('位置一律走 translate3d（left/top 由 CSS 固定在 0）', () => {
    expect(guideCardTransform({ left: 12, top: -4 })).toBe('translate3d(12px, -4px, 0)')
  })
})

describe('guideReducedMotion', () => {
  it('命中 prefers-reduced-motion: reduce 时为真', () => {
    expect(guideReducedMotion({ matchMedia: () => ({ matches: true }) })).toBe(true)
    expect(guideReducedMotion({ matchMedia: () => ({ matches: false }) })).toBe(false)
  })

  it('没有 matchMedia（node 环境 / 老内核）时为假', () => {
    expect(guideReducedMotion({})).toBe(false)
    expect(guideReducedMotion(null)).toBe(false)
  })
})

describe('常量', () => {
  it('半衰期与滑行类名按设计给死', () => {
    expect(GUIDE_SPOT_HALF_LIFE_MS).toBe(90)
    expect(GUIDE_CARD_HALF_LIFE_MS).toBe(110)
    expect(GUIDE_CARD_GLIDE_CLASS).toBe('is-gliding')
  })
})
