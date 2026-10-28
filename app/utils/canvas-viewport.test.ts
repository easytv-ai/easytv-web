import { describe, expect, it } from 'vitest'
import {
  canvasCenterFlowPoint,
  canvasClampMenu,
  canvasClampZoomPct,
  canvasMinimapBox,
  canvasNextInsertOrigin,
  canvasOrganizeOverlaps,
  canvasOrganizePositions,
  canvasViewRect,
  INSERT_GROUP_GAP,
  ORGANIZE_FALLBACK_W,
  ORGANIZE_GAP_X,
  ORGANIZE_GAP_Y,
} from './canvas-viewport'

describe('canvasNextInsertOrigin', () => {
  it('空画布用视口中心', () => {
    expect(canvasNextInsertOrigin(null, { x: 240, y: 190 })).toEqual({ x: 240, y: 190 })
  })

  it('下一组接在现有内容右侧，顶对齐并留出分组间距', () => {
    expect(canvasNextInsertOrigin({ x: 100, y: 80, w: 252, h: 600 }, { x: 0, y: 0 })).toEqual({
      x: 100 + 252 + INSERT_GROUP_GAP,
      y: 80,
    })
  })
})

describe('canvasCenterFlowPoint', () => {
  it('按视口中心减掉卡片偏移', () => {
    expect(canvasCenterFlowPoint({ x: 0, y: 0, zoom: 1 }, { width: 800, height: 600 })).toEqual({ x: 240, y: 190 })
  })
})

describe('canvasClampMenu / canvasClampZoomPct', () => {
  it('菜单夹在窗口内，缩放夹在 15–800', () => {
    expect(canvasClampMenu(-40, -10, 248, 460, { w: 400, h: 500 })).toEqual({ x: 12, y: 12 })
    expect(canvasClampZoomPct(10)).toBe(15)
    expect(canvasClampZoomPct(900)).toBe(800)
    expect(canvasClampZoomPct(100)).toBe(100)
  })
})

describe('canvasViewRect / canvasMinimapBox', () => {
  it('视口矩形按缩放还原画布坐标', () => {
    expect(canvasViewRect({ x: -100, y: -40, zoom: 2 }, { width: 400, height: 200 })).toEqual({
      x: 50,
      y: 20,
      w: 200,
      h: 100,
    })
  })

  it('小地图包住节点和视口，并留边', () => {
    expect(canvasMinimapBox([{ x: 0, y: 0, w: 100, h: 80 }], { x: 0, y: 0, w: 200, h: 160 }, 10)).toEqual({
      x: -10,
      y: -10,
      w: 240,
      h: 180,
    })
  })
})

describe('canvasOrganizePositions', () => {
  it('按连线从左到右分层，列距用节点真实宽度', () => {
    const list = [
      { id: 'a', width: 320, height: 220 },
      { id: 'b', width: 320, height: 220 },
      { id: 'c', width: 320, height: 220 },
    ]
    const next = canvasOrganizePositions(
      list,
      [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }],
    )
    const step = 320 + ORGANIZE_GAP_X
    expect(next).toEqual([
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: step, y: 0 },
      { id: 'c', x: step * 2, y: 0 },
    ])
    expect(canvasOrganizeOverlaps(list, next)).toBe(false)
  })

  it('同层多个节点按真实高度往下排，不叠在一起', () => {
    const list = [
      { id: 'a', width: 320, height: 220 },
      { id: 'b', width: 320, height: 320 },
      { id: 'c', width: 320, height: 180 },
    ]
    const next = canvasOrganizePositions(
      list,
      [{ source: 'a', target: 'b' }, { source: 'a', target: 'c' }],
    )
    const col = 320 + ORGANIZE_GAP_X
    expect(next.filter(item => item.x === col).map(item => item.id)).toEqual(['b', 'c'])
    expect(next.find(item => item.id === 'c')?.y).toBe(320 + ORGANIZE_GAP_Y)
    expect(canvasOrganizeOverlaps(list, next)).toBe(false)
  })

  it('没连线时四张卡摊成 2×2，方图也不挤', () => {
    const list = [
      { id: 'a', width: 320, height: 180 },
      { id: 'b', width: 320, height: 320 },
      { id: 'c', width: 320, height: 180 },
      { id: 'd', width: 320, height: 320 },
    ]
    const next = canvasOrganizePositions(list, [])
    expect(next).toEqual([
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 320 + ORGANIZE_GAP_X, y: 0 },
      { id: 'c', x: 0, y: 320 + ORGANIZE_GAP_Y },
      { id: 'd', x: 320 + ORGANIZE_GAP_X, y: 320 + ORGANIZE_GAP_Y },
    ])
    expect(canvasOrganizeOverlaps(list, next)).toBe(false)
  })

  it('没写宽高时按默认卡片尺寸留缝', () => {
    const list = [{ id: 'a' }, { id: 'b' }]
    const next = canvasOrganizePositions(list, [])
    expect(next[1]).toEqual({ id: 'b', x: ORGANIZE_FALLBACK_W + ORGANIZE_GAP_X, y: 0 })
    expect(canvasOrganizeOverlaps(list, next)).toBe(false)
  })
})
