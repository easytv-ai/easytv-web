import { describe, expect, it } from 'vitest'
import { alignFlowNodes, distributeFlowNodes, fitBoxZoom, isNodeLocked, isSelfLocked, layoutGroupChildren, storyboardCols, type CanvasFlowNode } from './canvas-group'

const kid = (id: string): CanvasFlowNode => ({
  id,
  type: 'image',
  position: { x: 0, y: 0 },
  width: 100,
  height: 60,
  data: { kind: 'image', label: id, content: '' } as any,
})

const group = (storyboard?: { cols: number }): CanvasFlowNode => ({
  id: 'g',
  type: 'group',
  position: { x: 0, y: 0 },
  data: { kind: 'group', label: '组', color: '#fff', layout: 'grid', storyboard },
})

describe('storyboardCols', () => {
  it('默认与拼接同口径：4 张 2 列、9 张 3 列、其余 ceil(sqrt(n))', () => {
    expect(storyboardCols(4)).toBe(2)
    expect(storyboardCols(9)).toBe(3)
    expect(storyboardCols(5)).toBe(3)
    expect(storyboardCols(10)).toBe(4)
    expect(storyboardCols(1)).toBe(1)
  })

  it('指定列数夹到 1..n', () => {
    expect(storyboardCols(6, 3)).toBe(3)
    expect(storyboardCols(6, 0)).toBe(3)
    expect(storyboardCols(6, -2)).toBe(3)
    expect(storyboardCols(6, 99)).toBe(6)
    expect(storyboardCols(6, Number.NaN)).toBe(3)
    expect(storyboardCols(0, 5)).toBe(1)
  })
})

describe('layoutGroupChildren 分镜组列数', () => {
  it('grid 模式按 storyboard.cols 铺，按阅读顺序落位', () => {
    const g = group({ cols: 3 })
    const kids = ['a', 'b', 'c', 'd'].map(kid)
    layoutGroupChildren(g, kids, 'grid')
    expect(kids.map(k => k.position)).toEqual([
      { x: 28, y: 28 },
      { x: 144, y: 28 },
      { x: 260, y: 28 },
      { x: 28, y: 104 },
    ])
    expect(g.width).toBe(360 + 28)
  })

  it('显式 cols 参数优先于 storyboard.cols，普通组仍用默认列数', () => {
    const g = group({ cols: 3 })
    const kids = ['a', 'b', 'c', 'd'].map(kid)
    layoutGroupChildren(g, kids, 'grid', 1)
    expect(kids.every(k => k.position.x === 28)).toBe(true)
    const plain = group()
    const four = ['a', 'b', 'c', 'd'].map(kid)
    layoutGroupChildren(plain, four, 'grid')
    expect(four[2]!.position).toEqual({ x: 28, y: 104 })
  })
})

describe('alignFlowNodes / distributeFlowNodes', () => {
  it('左对齐写绝对坐标，组内子节点写回相对坐标', () => {
    const parent: CanvasFlowNode = { id: 'g', type: 'group', position: { x: 40, y: 10 }, data: { kind: 'group', label: '组', color: '#fff', layout: 'grid' } }
    const a = kid('a')
    a.position = { x: 100, y: 50 }
    const b = kid('b')
    b.position = { x: 80, y: 30 }
    b.parentNode = 'g'
    const all = [parent, a, b]
    alignFlowNodes([a, b], all, 'left')
    expect(a.position.x).toBe(100)
    expect(b.position.x).toBe(60)
  })

  it('三个节点水平分布，首尾不动', () => {
    const a = kid('a')
    a.position = { x: 0, y: 0 }
    a.width = 40
    const b = kid('b')
    b.position = { x: 50, y: 10 }
    b.width = 40
    const c = kid('c')
    c.position = { x: 160, y: 0 }
    c.width = 40
    distributeFlowNodes([a, b, c], [a, b, c], 'horizontal')
    expect(a.position.x).toBe(0)
    expect(c.position.x).toBe(160)
    expect(b.position.x).toBe(80)
  })
})

describe('isNodeLocked', () => {
  it('自己没锁、父组锁了也算锁定', () => {
    const parent: CanvasFlowNode = { id: 'g', type: 'group', position: { x: 0, y: 0 }, data: { kind: 'group', label: '组', color: '#fff', layout: 'grid', locked: true } }
    const child = kid('a')
    child.parentNode = 'g'
    const all = [parent, child]
    expect(isSelfLocked(child)).toBe(false)
    expect(isNodeLocked(child)).toBe(false)
    expect(isNodeLocked(child, all)).toBe(true)
    expect(isNodeLocked(parent, all)).toBe(true)
  })

  it('父组没锁只看自己', () => {
    const parent: CanvasFlowNode = { id: 'g', type: 'group', position: { x: 0, y: 0 }, data: { kind: 'group', label: '组', color: '#fff', layout: 'grid' } }
    const child = kid('a')
    child.parentNode = 'g'
    child.data = { ...child.data, locked: true } as any
    expect(isSelfLocked(child)).toBe(true)
    expect(isNodeLocked(child, [parent, child])).toBe(true)
    expect(isNodeLocked(parent, [parent, child])).toBe(false)
  })
})

describe('fitBoxZoom', () => {
  it('按视口留白算缩放，并封顶', () => {
    expect(fitBoxZoom({ w: 200, h: 100 }, { w: 1000, h: 800 }, 0.2, 1.5)).toBe(1.5)
    expect(fitBoxZoom({ w: 2000, h: 1000 }, { w: 1000, h: 800 }, 0.2, 4)).toBeCloseTo(0.3)
  })
})
