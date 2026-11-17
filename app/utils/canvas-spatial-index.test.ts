import { describe, expect, it } from 'vitest'
import {
  buildCanvasSpatialIndex,
  queryCanvasSpatialEdges,
  queryCanvasSpatialNodes,
} from './canvas-spatial-index'

const view = { left: 0, top: 0, right: 1000, bottom: 800 }

describe('canvas spatial index', () => {
  it('只返回格子里和视口相交的卡片，远处的碰不到', () => {
    const nodes = Array.from({ length: 40 }, (_, index) => ({
      id: `n${index}`,
      x: index * 30,
      y: 40,
      w: 200,
      h: 140,
    }))
    nodes.push({ id: 'far', x: 8000, y: 40, w: 200, h: 140 })
    const index = buildCanvasSpatialIndex(nodes, [])
    const hits = queryCanvasSpatialNodes(index, view).map(node => node.id)
    expect(hits).toContain('n0')
    expect(hits).not.toContain('far')
  })

  it('贴着格子边界的卡片仍能被查到', () => {
    const index = buildCanvasSpatialIndex([
      { id: 'edge', x: 479, y: 10, w: 40, h: 40 },
      { id: 'far', x: 8000, y: 10, w: 40, h: 40 },
    ], [])
    const hits = queryCanvasSpatialNodes(index, { left: 400, top: 0, right: 520, bottom: 200 })
    expect(hits.map(node => node.id)).toEqual(['edge'])
  })

  it('两端都在视口外、但线穿过视口时留着；都在外面的短线不留', () => {
    const nodes = [
      { id: 'left', x: -4000, y: 40, w: 200, h: 140 },
      { id: 'right', x: 8000, y: 40, w: 200, h: 140 },
      { id: 'far', x: 9000, y: 40, w: 200, h: 140 },
      { id: 'near', x: 40, y: 40, w: 200, h: 140 },
    ]
    const index = buildCanvasSpatialIndex(nodes, [
      { id: 'cross', source: 'left', target: 'right' },
      { id: 'gone', source: 'right', target: 'far' },
      { id: 'near', source: 'near', target: 'right' },
    ])
    const shownNodes = new Set(['near'])
    const shown = queryCanvasSpatialEdges(index, view, shownNodes)
    expect(shown.has('cross')).toBe(true)
    expect(shown.has('near')).toBe(true)
    expect(shown.has('gone')).toBe(false)
  })

  it('横跨很多格的长线穿过视口时仍留着', () => {
    const index = buildCanvasSpatialIndex([
      { id: 'a', x: -20000, y: 40, w: 200, h: 140 },
      { id: 'b', x: 20000, y: 40, w: 200, h: 140 },
    ], [
      { id: 'long', source: 'a', target: 'b' },
    ])
    expect(index.wideEdges).toContain('long')
    const shown = queryCanvasSpatialEdges(index, view, new Set())
    expect(shown.has('long')).toBe(true)
  })

  it('钉在视口外的卡片，它的线也留着', () => {
    const index = buildCanvasSpatialIndex([
      { id: 'pinned', x: 9000, y: 40, w: 200, h: 140, pin: true },
      { id: 'other', x: 9800, y: 40, w: 200, h: 140 },
    ], [
      { id: 'keep', source: 'pinned', target: 'other' },
    ])
    const shown = queryCanvasSpatialEdges(index, view, new Set(['pinned']))
    expect(shown.has('keep')).toBe(true)
  })
})
