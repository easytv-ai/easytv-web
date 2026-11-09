import { describe, expect, it } from 'vitest'
import {
  canvasCenterFlowPoint,
  canvasClampMenu,
  canvasClampZoomPct,
  canvasInsertGroupCols,
  canvasInsertPositions,
  canvasMinimapBox,
  canvasNextInsertOrigin,
  canvasOrganizeOverlaps,
  canvasOrganizePositions,
  canvasSlotRightOf,
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

describe('canvasInsertPositions', () => {
  it('角色和分镜分栏，不竖着单列叠在一起', () => {
    const cells = [
      { index: 0, w: 320, h: 240, group: 'character' },
      { index: 1, w: 320, h: 240, group: 'character' },
      { index: 2, w: 320, h: 569, group: 'shot' },
      { index: 3, w: 320, h: 569, group: 'shot' },
    ]
    const next = canvasInsertPositions(cells, { x: 100, y: 40 })
    const shot = next.filter(item => item.index >= 2)
    expect(next[0]).toEqual({ index: 0, x: 100, y: 40 })
    expect(next[1]?.x).toBe(100 + 320 + ORGANIZE_GAP_X)
    expect(shot[0]?.x).toBeGreaterThan(next[1]!.x)
    expect(shot[1]?.x).toBe(shot[0]!.x + 320 + ORGANIZE_GAP_X)
    expect(shot[1]?.y).toBe(shot[0]?.y)
  })

  it('9:16 分镜按真实高度留缝，不会叠住', () => {
    const cells = Array.from({ length: 4 }, (_, index) => ({
      index,
      w: 320,
      h: 569,
      group: 'shot',
    }))
    const next = canvasInsertPositions(cells, { x: 0, y: 0 })
    const boxes = next.map(item => ({
      id: String(item.index),
      x: item.x,
      y: item.y,
      w: 320,
      h: 569,
    }))
    expect(canvasInsertGroupCols('shot', 4)).toBe(2)
    expect(next[2]?.y).toBe(569 + ORGANIZE_GAP_Y)
    expect(canvasOrganizeOverlaps(
      boxes.map(item => ({ id: item.id, width: item.w, height: item.h })),
      next.map(item => ({ id: String(item.index), x: item.x, y: item.y })),
    )).toBe(false)
  })
})

describe('canvasSlotRightOf', () => {
  it('同一行已有卡片时，视频落到整行右侧', () => {
    expect(canvasSlotRightOf(
      { x: 0, y: 0, w: 320, h: 569 },
      [{ x: 400, y: 0, w: 320, h: 569 }],
      ORGANIZE_GAP_X,
    )).toEqual({ x: 400 + 320 + ORGANIZE_GAP_X, y: 0 })
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
