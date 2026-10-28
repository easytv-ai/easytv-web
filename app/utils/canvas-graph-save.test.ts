import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { estimateJsonBytes, isGraphOverLimit } from '~/utils/director/persist'
import { sanitizeGraphForSave } from '~/utils/canvas-graph-save'

function fatShot(id: string, label: string) {
  return {
    id,
    type: 'easytv',
    selected: true,
    dragging: false,
    computedPosition: { x: 1, y: 2, z: 0 },
    dimensions: { width: 320, height: 180 },
    handleBounds: { source: [{ id: 'out', x: 0, y: 0 }], target: [{ id: 'in', x: 0, y: 0 }] },
    position: { x: 40, y: 80 },
    width: 320,
    height: 180,
    style: { width: '320px', height: '180px', backgroundImage: 'data:image/png;base64,AAA' },
    data: {
      kind: 'image',
      label,
      prompt: '分镜静帧，单镜头画面。镜4',
      content: `data:image/png;base64,${'A'.repeat(8000)}`,
      assetId: 91,
      castUrl: `data:image/png;base64,${'B'.repeat(4000)}`,
    },
  }
}

describe('sanitizeGraphForSave', () => {
  it('边只留两端 id，不把 sourceNode / targetNode 整份抄进去', () => {
    const shot = fatShot('image-4', '镜4 - 分镜')
    const hero = fatShot('image-1', '勇者 - 角色锚点')
    const graph = sanitizeGraphForSave({
      nodes: [hero, shot],
      edges: [{
        id: 'e-1',
        source: hero.id,
        target: shot.id,
        sourceHandle: 'out',
        targetHandle: 'in',
        type: 'easytv',
        sourceNode: hero,
        targetNode: shot,
      }],
      viewport: { x: 10, y: 20, zoom: 0.8 },
    })

    expect(graph.edges[0]).toEqual({
      id: 'e-1',
      source: 'image-1',
      target: 'image-4',
      type: 'easytv',
      sourceHandle: 'out',
      targetHandle: 'in',
    })
    expect(JSON.stringify(graph.edges)).not.toContain('sourceNode')
    expect(JSON.stringify(graph.edges)).not.toContain('勇者')
    expect(graph.nodes[1]?.data).toMatchObject({
      label: '镜4 - 分镜',
      prompt: '分镜静帧，单镜头画面。镜4',
      content: '',
      assetId: 91,
      castUrl: '',
    })
    expect(graph.viewport).toEqual({ x: 10, y: 20, zoom: 0.8 })
  })

  it('参考线很多时，摘掉边上的节点拷贝就能过 2MB', () => {
    const nodes = Array.from({ length: 12 }, (_, index) => fatShot(`image-${index + 1}`, `镜${index + 1} - 分镜`))
    const edges = []
    for (let i = 0; i < nodes.length; i++) {
      for (let j = 0; j < nodes.length; j++) {
        if (i === j)
          continue
        edges.push({
          id: `e-${i}-${j}`,
          source: nodes[i]!.id,
          target: nodes[j]!.id,
          sourceNode: nodes[i],
          targetNode: nodes[j],
        })
      }
    }
    const raw = { nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } }
    expect(isGraphOverLimit(raw)).toBe(true)
    const saved = sanitizeGraphForSave(raw)
    expect(isGraphOverLimit(saved)).toBe(false)
    expect(estimateJsonBytes(saved)).toBeLessThan(estimateJsonBytes(raw) / 10)
  })

  it('画布导出前会瘦身', () => {
    const workspace = readFileSync('app/components/canvas/CanvasWorkspace.vue', 'utf8')
    expect(workspace).toContain('sanitizeGraphForSave')
  })
})
