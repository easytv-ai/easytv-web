import { describe, expect, it } from 'vitest'
import {
  MONTAGE_CELL,
  montageCellAspect,
  montageDefaultCols,
  montageNodeSize,
  montageOrder,
  montageParams,
  montageReady,
  montageRows,
  type MontageSource,
} from './canvas-montage'

const box = (id: string, x: number, y: number, w = 320, h = 220): MontageSource =>
  ({ id, assetId: Number(id.replace(/\D/g, '')) || 1, url: `https://cdn/${id}.png`, label: id, x, y, w, h })

describe('montageOrder', () => {
  it('先按行、行内从左到右', () => {
    const items = [box('n3', 700, 0), box('n1', 0, 0), box('n4', 0, 300), box('n2', 350, 0)]
    expect(montageOrder(items).map(item => item.id)).toEqual(['n1', 'n2', 'n3', 'n4'])
  })

  it('同一行允许手摆的高低差（中心点差不到半个节点高）', () => {
    const items = [box('b', 400, 60), box('a', 0, 0), box('c', 800, -40)]
    expect(montageOrder(items).map(item => item.id)).toEqual(['a', 'b', 'c'])
  })

  it('差得太多就算下一行', () => {
    const items = [box('b', 400, 200), box('a', 0, 0)]
    expect(montageOrder(items).map(item => item.id)).toEqual(['a', 'b'])
    const items2 = [box('b', 0, 200), box('a', 400, 0)]
    expect(montageOrder(items2).map(item => item.id)).toEqual(['a', 'b'])
  })

  it('不改原数组', () => {
    const items = [box('b', 400, 0), box('a', 0, 0)]
    montageOrder(items)
    expect(items[0]!.id).toBe('b')
  })
})

describe('列数与行数', () => {
  it('缺省列数接近正方形', () => {
    expect([2, 4, 5, 9, 10, 16, 25].map(montageDefaultCols)).toEqual([2, 2, 3, 3, 4, 4, 5])
  })

  it('行数向上取整', () => {
    expect(montageRows(5, 3)).toBe(2)
    expect(montageRows(9, 3)).toBe(3)
    expect(montageRows(3, 0)).toBe(3)
  })
})

describe('montageReady', () => {
  it('要都是带资产的图片节点，且在 2~25 张之间', () => {
    const img = (assetId: number) => ({ kind: 'image', assetId })
    expect(montageReady([img(1), img(2)])).toBe(true)
    expect(montageReady([img(1)])).toBe(false)
    expect(montageReady([img(1), { kind: 'video', assetId: 2 }])).toBe(false)
    expect(montageReady([img(1), img(0)])).toBe(false)
    expect(montageReady(Array.from({ length: 26 }, (_, i) => img(i + 1)))).toBe(false)
  })
})

describe('尺寸与参数', () => {
  it('画幅比：original 按第一张，其余按声明', () => {
    expect(montageCellAspect('original', { w: 400, h: 200 })).toBe(2)
    expect(montageCellAspect('original')).toBe(1)
    expect(montageCellAspect('9:16')).toBeCloseTo(9 / 16)
  })

  it('结果节点按整图比例定高，宽度随列数放大但封顶', () => {
    const size = montageNodeSize(9, { cols: 3, ratio: '1:1', gap: 0, number: false })
    expect(size.w).toBe(480)
    expect(size.h).toBe(480)
    const wide = montageNodeSize(2, { cols: 2, ratio: '16:9', gap: 0, number: false })
    expect(wide.h).toBeLessThan(wide.w)
    expect(montageNodeSize(25, { cols: 5, ratio: '1:1', gap: 8, number: false }).w).toBeLessThanOrEqual(640)
  })

  it('params 带有序 asset_ids，列数与间距夹到范围内', () => {
    const ordered = [box('n2', 400, 0), box('n7', 0, 300)]
    expect(montageParams(ordered, { cols: 99, ratio: '16:9', gap: 500, number: true })).toEqual({
      asset_ids: [2, 7], cols: 10, ratio: '16:9', gap: 64, number: true,
    })
    expect(MONTAGE_CELL).toBe(512)
  })
})
