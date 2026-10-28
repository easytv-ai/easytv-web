import { describe, expect, it } from 'vitest'
import {
  GUIDE_CARD_GAP,
  GUIDE_CARD_WIDTH,
  GUIDE_MENU_CLEAR,
  GUIDE_VIEWPORT_PAD,
  guideCardCandidates,
  guideRectOverlap,
  pickGuideCardPosition,
  type GuideRect,
} from './canvas-guide-card'

const win = { width: 1280, height: 800 }
const card = { width: GUIDE_CARD_WIDTH, height: 250 }

/** 工具轨那颗 ➕：左边常显、竖向居中 */
const rail: GuideRect = { left: 16, top: 300, width: 44, height: 140 }

function intersects(a: GuideRect, b: GuideRect) {
  return guideRectOverlap(a, b) > 0
}

function asRect(placement: { left: number, top: number }): GuideRect {
  return { left: placement.left, top: placement.top, width: card.width, height: card.height }
}

describe('guideRectOverlap', () => {
  it('相交才计面积，贴边（0 宽）不算', () => {
    const a: GuideRect = { left: 0, top: 0, width: 100, height: 100 }
    expect(guideRectOverlap(a, { left: 50, top: 50, width: 100, height: 100 })).toBe(2500)
    expect(guideRectOverlap(a, { left: 100, top: 0, width: 100, height: 100 })).toBe(0)
    expect(guideRectOverlap(a, { left: 200, top: 200, width: 100, height: 100 })).toBe(0)
  })
})

describe('pickGuideCardPosition', () => {
  it('场地宽裕时放在锚点正下方，且一点不压被高亮的元素', () => {
    const anchor: GuideRect = { left: 600, top: 100, width: 100, height: 60 }
    const placement = pickGuideCardPosition(anchor, card, undefined, win)
    expect(placement.left).toBe(anchor.left + anchor.width / 2 - card.width / 2)
    expect(placement.top).toBe(anchor.top + anchor.height + GUIDE_CARD_GAP)
    expect(placement.hardOverlap).toBe(0)
  })

  it('锚点贴窗底时翻到上方，不靠 Math.max(16, …) 把卡片推回锚点身上', () => {
    const bottom: GuideRect = { left: 600, top: 700, width: 320, height: 220 }
    const placement = pickGuideCardPosition(bottom, card, undefined, win)
    expect(placement.hardOverlap).toBe(0)
    expect(intersects(asRect(placement), bottom)).toBe(false)
    expect(placement.top + card.height).toBeLessThanOrEqual(bottom.top)
  })

  it('弹出的菜单是硬禁区：第 2 步点开 ➕ 后卡片让位，不盖住菜单里的项', () => {
    // openMenuAtAdd：x = 按钮右缘 + 12，宽 240
    const menu: GuideRect = { left: rail.left + rail.width + 12, top: rail.top, width: 240, height: 320 }
    const placement = pickGuideCardPosition(rail, card, { hard: [menu] }, win)
    expect(placement.hardOverlap).toBe(0)
    expect(intersects(asRect(placement), menu)).toBe(false)
    expect(intersects(asRect(placement), rail)).toBe(false)
  })

  it('640/720/800/1080 高的窗口里（轨道竖向居中 + 菜单弹出）卡片两边都不压，也留在窗口内', () => {
    for (const height of [640, 720, 800, 1080]) {
      const short = { width: 1280, height }
      // .canvas-tools：top:50% + translateY(-50%)，28px 一颗 × 8 + 间隔与内边距 ≈ 250
      const shortRail: GuideRect = { left: 16, top: (short.height - 250) / 2, width: 36, height: 250 }
      const spot: GuideRect = { left: 8, top: shortRail.top - 8, width: shortRail.width + 16, height: shortRail.height + 16 }
      const menu: GuideRect = { left: shortRail.left + shortRail.width + 12, top: Math.max(12, shortRail.top - 72), width: 240, height: 360 }
      const placement = pickGuideCardPosition(spot, card, { hard: [menu] }, short)
      const rect = asRect(placement)
      expect(placement.hardOverlap, `窗口高 ${height}`).toBe(0)
      expect(intersects(rect, menu), `窗口高 ${height} 压住菜单`).toBe(false)
      expect(intersects(rect, spot), `窗口高 ${height} 压住轨道 ➕`).toBe(false)
      expect(rect.left + card.width, `窗口高 ${height} 右侧出窗`).toBeLessThanOrEqual(short.width - GUIDE_VIEWPORT_PAD)
      expect(rect.top + card.height, `窗口高 ${height} 下方出窗`).toBeLessThanOrEqual(short.height - GUIDE_VIEWPORT_PAD)
    }
  })

  it('菜单出现前先选"右近"，比让开菜单的"右远"更靠前', () => {
    const candidates = guideCardCandidates(rail, card)
    const rightNear = rail.left + rail.width + GUIDE_CARD_GAP
    const rightFar = rightNear + GUIDE_MENU_CLEAR
    expect(candidates[2]).toEqual({ left: rightNear, top: rail.top })
    expect(candidates[3]).toEqual({ left: rightFar, top: rail.top })
    // 右近被窗口夹住时（窄窗），优先顺序仍然由数组决定
    const narrow = pickGuideCardPosition(rail, card, undefined, { width: 200, height: 800 })
    expect(narrow.hardOverlap).toBe(0)
  })

  it('硬禁区相交面积优先、软禁区只作次级比较', () => {
    const anchor: GuideRect = { left: 600, top: 100, width: 100, height: 60 }
    // 软禁区正好盖住"锚点下"那个候选位
    const dock: GuideRect = { left: 480, top: 172, width: 340, height: 250 }
    const placement = pickGuideCardPosition(anchor, card, { soft: [dock] }, win)
    expect(placement.hardOverlap).toBe(0)
    expect(intersects(asRect(placement), dock)).toBe(false)
  })

  it('整窗遮罩不当成禁区：开场步把卡片放在舞台左上，让开中间的入口', () => {
    const everywhere: GuideRect = { left: 0, top: 0, width: win.width, height: win.height }
    const pane: GuideRect = { left: 0, top: 56, width: win.width, height: win.height - 56 }
    const placement = pickGuideCardPosition(everywhere, card, undefined, win, pane)
    expect(placement.hardOverlap).toBe(0)
    expect(placement.left).toBe(pane.left + 72)
    expect(placement.top).toBe(pane.top + 72)
  })

  it('图片节点在中间、右边是清单时，卡片不压左边工具条', () => {
    const node: GuideRect = { left: 420, top: 180, width: 280, height: 200 }
    const tools: GuideRect = { left: 16, top: 275, width: 36, height: 250 }
    const list: GuideRect = { left: 1000, top: 80, width: 248, height: 420 }
    const placement = pickGuideCardPosition(node, { width: 340, height: 300 }, { hard: [tools, list] }, win)
    const rect = { left: placement.left, top: placement.top, width: 340, height: 300 }
    expect(intersects(rect, tools)).toBe(false)
    expect(intersects(rect, node)).toBe(false)
  })

  it('卡片比窗口还大时只保证左上对齐，不把它推到窗外', () => {
    const placement = pickGuideCardPosition(rail, { width: 1400, height: 900 }, undefined, win)
    expect(placement.left).toBe(GUIDE_VIEWPORT_PAD)
    expect(placement.top).toBe(GUIDE_VIEWPORT_PAD)
  })
})
