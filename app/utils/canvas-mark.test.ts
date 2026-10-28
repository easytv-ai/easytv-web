import { describe, expect, it } from 'vitest'
import { dilateMarked, displayedClickToImage, expandMarkTokens, insertMarkToken, mapMarkBox, markGridToMask, markHitCrop, markHitInstruction, markHitLocalPoint, parseMarkHit, placeMarkBox, stripMarkToken } from './canvas-mark'

describe('mark token', () => {
  it('追加到文末', () => {
    expect(insertMarkToken('黄昏沙漠', 'mark-1').prompt).toBe('黄昏沙漠{{mark:mark-1}}')
  })

  it('多个标签依次追加到文末', () => {
    const once = insertMarkToken('黄昏沙漠', 'mark-1').prompt
    expect(insertMarkToken(once, 'mark-2').prompt).toBe('黄昏沙漠{{mark:mark-1}}{{mark:mark-2}}')
  })

  it('去掉指定标签', () => {
    expect(stripMarkToken('黄昏{{mark:mark-1}}公路', 'mark-1')).toBe('黄昏公路')
  })

  it('生成时展开成名称', () => {
    expect(expandMarkTokens('锁定{{mark:mark-1}}', [{ id: 'mark-1', name: '标记 1', sourceNodeId: 'n1', box: { x: 0, y: 0, w: 1, h: 1 } }])).toBe('锁定标记 1')
  })
})

describe('parseMarkHit', () => {
  it('认点击处的物体名和外接框', () => {
    const hit = parseMarkHit('{"name":"路牌","box":{"x":0.28,"y":0.22,"w":0.22,"h":0.28}}', 0.4, 0.36)
    expect(hit?.name).toBe('路牌')
    expect(hit?.box).toEqual({ x: 0.28, y: 0.22, w: 0.22, h: 0.28 })
  })

  it('剥掉代码块，并把刚好偏出的框收到点击点上', () => {
    const hit = parseMarkHit('```json\n{"name":"黄衣女子","box":{"x":0.5,"y":0.4,"w":0.2,"h":0.4}}\n```', 0.48, 0.55)
    expect(hit?.name).toBe('黄衣女子')
    expect(hit!.box.x).toBeCloseTo(0.48)
    expect(hit!.box.y).toBeCloseTo(0.4)
    expect(hit!.box.x + hit!.box.w).toBeGreaterThanOrEqual(0.48)
    expect(hit!.box.y + hit!.box.h).toBeGreaterThanOrEqual(0.55)
  })

  it('百分数坐标换算成 0 到 1', () => {
    const hit = parseMarkHit('{"name":"皮卡","box":{"x":4,"y":40,"w":30,"h":35}}', 0.2, 0.55)
    expect(hit?.name).toBe('皮卡')
    expect(hit?.box.x).toBeCloseTo(0.04)
    expect(hit?.box.w).toBeCloseTo(0.3)
  })

  it('框离点击点太远时整条丢掉，不能把旁边的名字配到点击处', () => {
    expect(parseMarkHit('{"name":"黄色夹克女子","box":{"x":0.7,"y":0.35,"w":0.22,"h":0.5}}', 0.36, 0.32)).toBeNull()
  })

  it('裁图框换回原图后仍然包住点击点', () => {
    const crop = markHitCrop(0.36, 0.32)
    const local = markHitLocalPoint(crop, 0.36, 0.32)
    const hit = parseMarkHit('{"name":"路牌","box":{"x":0.2,"y":0.15,"w":0.55,"h":0.6}}', local.x, local.y)
    expect(hit?.name).toBe('路牌')
    const box = mapMarkBox(crop, hit!.box)
    expect(box.x).toBeLessThanOrEqual(0.36)
    expect(box.y).toBeLessThanOrEqual(0.32)
    expect(box.x + box.w).toBeGreaterThanOrEqual(0.36)
    expect(box.y + box.h).toBeGreaterThanOrEqual(0.32)
  })

  it('画面 cover 裁切时，点击换算到原图坐标', () => {
    const same = displayedClickToImage(0.25, 0.5, 100, 100, 100, 100)
    expect(same.x).toBeCloseTo(0.25)
    expect(same.y).toBeCloseTo(0.5)
    const wide = displayedClickToImage(0, 0.5, 100, 100, 200, 100)
    expect(wide.x).toBeCloseTo(0.25)
    expect(wide.y).toBeCloseTo(0.5)
  })

  it('整张图的框不算数，没有名称就放弃', () => {
    expect(parseMarkHit('{"name":"","box":{"x":0,"y":0,"w":1,"h":1}}', 0.4, 0.4)).toBeNull()
    expect(parseMarkHit('不是 JSON', 0.4, 0.4)).toBeNull()
  })

  it('指令带上点击坐标', () => {
    expect(markHitInstruction(0.4, 0.36, 'zh')).toContain('x=0.400')
    expect(markHitInstruction(0.4, 0.36, 'zh')).toContain('y=0.360')
    expect(markHitInstruction(0.4, 0.36, 'en')).toContain('English')
  })
})

describe('placeMarkBox', () => {
  it('以点击为中心落框，贴边时往里收', () => {
    const mid = placeMarkBox(0.5, 0.5)
    expect(mid.w).toBe(0.26)
    expect(mid.h).toBe(0.26)
    expect(mid.x).toBeCloseTo(0.37)
    expect(mid.y).toBeCloseTo(0.37)

    const edge = placeMarkBox(0.02, 0.98)
    expect(edge.x).toBe(0)
    expect(edge.y).toBeCloseTo(0.74)
    expect(edge.x + edge.w).toBeLessThanOrEqual(1)
    expect(edge.y + edge.h).toBeLessThanOrEqual(1)
  })
})

describe('markGridToMask', () => {
  const W = 20
  const H = 20
  const grid = () => new Uint8Array(W * H)
  const at = (m: Uint8Array, x: number, y: number) => m[y * W + x]

  it('矩形边框内部整块成为蒙版，外部不动', () => {
    const g = grid()
    for (let i = 5; i <= 14; i++) {
      g[5 * W + i] = 1
      g[14 * W + i] = 1
      g[i * W + 5] = 1
      g[i * W + 14] = 1
    }
    const m = markGridToMask(g, W, H, 0)
    expect(at(m, 10, 10)).toBe(1)
    expect(at(m, 5, 5)).toBe(1)
    expect(at(m, 1, 1)).toBe(0)
    expect(at(m, 17, 10)).toBe(0)
  })

  it('没圈住的线条只按半径膨胀', () => {
    const g = grid()
    for (let i = 2; i <= 17; i++)
      g[10 * W + i] = 1
    const m = markGridToMask(g, W, H, 2)
    expect(at(m, 10, 12)).toBe(1)
    expect(at(m, 10, 13)).toBe(0)
    expect(at(m, 10, 3)).toBe(0)
  })
})

describe('dilateMarked', () => {
  it('只膨胀涂抹点，不填封闭区域', () => {
    const w = 12
    const h = 12
    const g = new Uint8Array(w * h)
    g[6 * w + 6] = 1
    const m = dilateMarked(g, w, h, 1)
    expect(m[6 * w + 6]).toBe(1)
    expect(m[6 * w + 7]).toBe(1)
    expect(m[2 * w + 2]).toBe(0)
  })
})
