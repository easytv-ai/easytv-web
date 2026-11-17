import { describe, expect, it } from 'vitest'
import { alignedPositions, distributedPositions, snapNodeAlign, type AlignBox } from './canvas-align'
import { nudgeFlowNodes, type CanvasFlowNode } from './canvas-group'

const moving: AlignBox = { id: 'a', x: 100, y: 40, w: 80, h: 50 }

describe('snapNodeAlign', () => {
  it('左边靠近时吸到同一条竖线，线盖住两张卡片', () => {
    const other: AlignBox = { id: 'b', x: 104, y: 200, w: 60, h: 40 }
    const snapped = snapNodeAlign(moving, [other], 6)
    expect(snapped.x).toBe(104)
    expect(snapped.y).toBe(40)
    expect(snapped.guides).toEqual([
      { dir: 'v', at: 104, from: 40, to: 240 },
    ])
  })

  it('顶边靠近时吸到横线', () => {
    const other: AlignBox = { id: 'b', x: 400, y: 36, w: 90, h: 70 }
    const snapped = snapNodeAlign(moving, [other], 6)
    expect(snapped.y).toBe(36)
    expect(snapped.guides[0]).toMatchObject({ dir: 'h', at: 36, from: 100, to: 490 })
  })

  it('超出阈值不吸、不画线', () => {
    const other: AlignBox = { id: 'b', x: 200, y: 200, w: 30, h: 30 }
    const snapped = snapNodeAlign(moving, [other], 6)
    expect(snapped.x).toBe(100)
    expect(snapped.guides).toEqual([])
  })

  it('同时靠近两条边时取更近的一条', () => {
    const near: AlignBox = { id: 'b', x: 102, y: 0, w: 20, h: 20 }
    const far: AlignBox = { id: 'c', x: 105, y: 300, w: 20, h: 20 }
    const snapped = snapNodeAlign(moving, [near, far], 8)
    expect(snapped.x).toBe(102)
    expect(snapped.guides).toHaveLength(1)
    expect(snapped.guides[0]?.at).toBe(102)
  })

  it('同一条边上有多张时只连最近的一张', () => {
    const row = { id: 'a', x: 100, y: 0, w: 80, h: 40 }
    const near = { id: 'b', x: 100, y: 80, w: 80, h: 40 }
    const far = { id: 'c', x: 100, y: 400, w: 80, h: 40 }
    const snapped = snapNodeAlign(row, [far, near], 6)
    expect(snapped.guides).toEqual([
      { dir: 'v', at: 100, from: 0, to: 120 },
    ])
  })

  it('宽高都重合时左中右只留一根线', () => {
    const row = { id: 'a', x: 100, y: 0, w: 80, h: 40 }
    const other = { id: 'b', x: 100, y: 200, w: 80, h: 40 }
    const snapped = snapNodeAlign(row, [other], 6)
    expect(snapped.guides.filter(guide => guide.dir === 'v')).toHaveLength(1)
  })

  it('右边和另一张的右边对齐时，竖线画在右边缘', () => {
    const other: AlignBox = { id: 'b', x: 300, y: 180, w: 78, h: 60 }
    const dragged: AlignBox = { id: 'a', x: 210, y: 20, w: 170, h: 80 }
    const snapped = snapNodeAlign(dragged, [other], 6)
    expect(snapped.x + dragged.w).toBe(378)
    expect(snapped.guides[0]).toMatchObject({ dir: 'v', at: 378 })
  })
})

describe('alignedPositions / distributedPositions', () => {
  const a: AlignBox = { id: 'a', x: 10, y: 20, w: 40, h: 20 }
  const b: AlignBox = { id: 'b', x: 50, y: 60, w: 20, h: 40 }
  const c: AlignBox = { id: 'c', x: 130, y: 10, w: 30, h: 10 }

  it('左对齐贴最左边，右对齐贴最右边', () => {
    expect(alignedPositions([a, b], 'left')).toEqual([
      { id: 'a', x: 10, y: 20 },
      { id: 'b', x: 10, y: 60 },
    ])
    expect(alignedPositions([a, b], 'right')).toEqual([
      { id: 'a', x: 30, y: 20 },
      { id: 'b', x: 50, y: 60 },
    ])
  })

  it('水平居中按包围盒中线', () => {
    const [left, right] = alignedPositions([a, b], 'center')
    expect(left!.x + a.w / 2).toBe(right!.x + b.w / 2)
  })

  it('水平分布首尾不动，中间均分空隙', () => {
    const next = distributedPositions([a, b, c], 'horizontal')
    const byId = Object.fromEntries(next.map(item => [item.id, item]))
    expect(byId.a?.x).toBe(10)
    expect(byId.c?.x).toBe(130)
    expect(byId.b?.x).toBe(80)
  })

  it('两个节点不分布', () => {
    expect(distributedPositions([a, b], 'horizontal')).toEqual([
      { id: 'a', x: 10, y: 20 },
      { id: 'b', x: 50, y: 60 },
    ])
  })
})

describe('nudgeFlowNodes', () => {
  it('未锁定节点按增量挪，锁定的跳过', () => {
    const a = { id: 'a', position: { x: 10, y: 20 }, data: { kind: 'image', locked: false } } as CanvasFlowNode
    const b = { id: 'b', position: { x: 40, y: 20 }, data: { kind: 'image', locked: true } } as CanvasFlowNode
    nudgeFlowNodes([a, b], [a, b], 8, -4)
    expect(a.position).toEqual({ x: 18, y: 16 })
    expect(b.position).toEqual({ x: 40, y: 20 })
  })

  it('父组锁定时子节点也不挪', () => {
    const group = { id: 'g', position: { x: 0, y: 0 }, data: { kind: 'group', locked: true } } as CanvasFlowNode
    const kid = { id: 'c', parentNode: 'g', position: { x: 8, y: 8 }, data: { kind: 'image', locked: false } } as CanvasFlowNode
    nudgeFlowNodes([kid], [group, kid], 10, 0)
    expect(kid.position).toEqual({ x: 8, y: 8 })
  })
})
