import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CANVAS_CULL_MIN_NODES,
  canvasAbsBoxes,
  canvasCullNeedsReveal,
  canvasCullPlan,
  canvasFlowViewRect,
} from './canvas-viewport-cull'

function card(id: string, x: number, y: number, extra: { pin?: boolean, w?: number, h?: number } = {}) {
  return { id, x, y, w: extra.w ?? 200, h: extra.h ?? 140, pin: extra.pin }
}

const view = { width: 1000, height: 800 }
const viewport = { x: 0, y: 0, zoom: 1 }

describe('canvasCullPlan', () => {
  it('卡片少时不裁', () => {
    const nodes = [card('a', 4000, 4000)]
    const plan = canvasCullPlan(nodes, [], viewport, view, 200)
    expect(nodes.length).toBeLessThan(CANVAS_CULL_MIN_NODES)
    expect(plan.hiddenNodes.size).toBe(0)
  })

  it('视口外的卡片和两端都在外面的连线不画，穿过视口的连线留着', () => {
    const nodes = Array.from({ length: 50 }, (_, index) => card(`n${index}`, index * 30, 40))
    nodes.push(card('far', 8000, 40))
    nodes.push(card('far2', 9000, 40))
    nodes.push(card('left', -4000, 40))
    const edges = [
      { id: 'near', source: 'n0', target: 'n1' },
      { id: 'gone', source: 'far', target: 'far2' },
      { id: 'cross', source: 'left', target: 'far' },
    ]
    const plan = canvasCullPlan(nodes, edges, viewport, view, 400)
    expect(plan.hiddenNodes.has('far')).toBe(true)
    expect(plan.hiddenNodes.has('n0')).toBe(false)
    expect(plan.hiddenEdges.has('gone')).toBe(true)
    expect(plan.hiddenEdges.has('near')).toBe(false)
    expect(plan.hiddenEdges.has('cross')).toBe(false)
  })

  it('选中的卡片即使在视口外也留着', () => {
    const nodes = Array.from({ length: 48 }, (_, index) => card(`n${index}`, index * 30, 40))
    nodes.push(card('picked', 9000, 40, { pin: true }))
    const plan = canvasCullPlan(nodes, [], viewport, view, 200)
    expect(plan.hiddenNodes.has('picked')).toBe(false)
    expect(plan.hiddenNodes.has('n0')).toBe(false)
  })

  it('缩放到能看见全部时不裁', () => {
    const nodes = Array.from({ length: 45 }, (_, index) => card(`n${index}`, index * 40, 20))
    const plan = canvasCullPlan(nodes, [], { x: -200, y: -200, zoom: 0.2 }, { width: 1200, height: 800 }, 400)
    expect(plan.hiddenNodes.size).toBe(0)
  })
})

describe('canvasAbsBoxes', () => {
  it('组内坐标加上父组原点', () => {
    const boxes = canvasAbsBoxes([
      { id: 'g', x: 500, y: 80, w: 400, h: 300 },
      { id: 'kid', parentId: 'g', x: 20, y: 30, w: 100, h: 80 },
      { id: 'gone', x: 0, y: 0, w: 10, h: 10, skip: true },
    ])
    expect(boxes.find(item => item.id === 'kid')).toMatchObject({ x: 520, y: 110 })
    expect(boxes.some(item => item.id === 'gone')).toBe(false)
  })
})

describe('canvasCullNeedsReveal', () => {
  it('还在准备区里就不用补画，滑出垫层才要', () => {
    const prepared = canvasFlowViewRect(viewport, view, 1000)
    expect(canvasCullNeedsReveal(prepared, { x: -200, y: 0, zoom: 1 }, view, 200)).toBe(false)
    expect(canvasCullNeedsReveal(prepared, { x: -2200, y: 0, zoom: 1 }, view, 200)).toBe(true)
  })
})

describe('裁剪不卸载节点', () => {
  it('仍然关闭 Vue Flow 的可见性卸载，平移只跳过绘制', () => {
    const ws = readFileSync(new URL('../components/canvas/CanvasWorkspace.vue', import.meta.url), 'utf8')
    const css = readFileSync(new URL('../assets/css/studio-parts/canvas.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    expect(ws).toContain(':only-render-visible-elements="false"')
    expect(ws).toContain('revealCull(')
    expect(ws).toContain('scheduleRevealCull(')
    expect(ws).toContain('applyCanvasCullDom')
    expect(ws).toContain('content-visibility')
    expect(css).not.toContain('html.canvas-is-interacting .vue-flow__edges')
    expect(css).toContain('html.canvas-is-interacting .canvas-edge-flow-layer {\n  display: none;')
  })
})
