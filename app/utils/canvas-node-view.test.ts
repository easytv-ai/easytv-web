import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { canvasKindIndex } from './canvas-node-kinds'
import { buildCanvasNodeView, canvasNodeViewStamp } from './canvas-node-view'
import type { CanvasFlowNode } from './canvas-group'

function node(partial: Partial<CanvasFlowNode> & { id: string }): CanvasFlowNode {
  return {
    type: 'easytv',
    position: { x: 0, y: 0 },
    data: { kind: 'image', label: '', content: '', prompt: '', mode: 'idle' },
    ...partial,
  } as CanvasFlowNode
}

describe('canvasNodeViewStamp', () => {
  it('拖动只改坐标时 stamp 不变', () => {
    const a = [
      node({ id: 'a', position: { x: 10, y: 20 } }),
      node({ id: 'b', position: { x: 80, y: 20 }, parentNode: 'g' }),
    ]
    const b = [
      node({ id: 'a', position: { x: 400, y: 900 } }),
      node({ id: 'b', position: { x: 81, y: 21 }, parentNode: 'g' }),
    ]
    expect(canvasNodeViewStamp(a)).toBe(canvasNodeViewStamp(b))
  })

  it('视口裁剪改 hidden 不影响 stamp，平移时不换索引', () => {
    const shown = [node({ id: 'a' })]
    const culled = [node({ id: 'a', hidden: true })]
    expect(canvasNodeViewStamp(shown)).toBe(canvasNodeViewStamp(culled))
  })

  it('锁定或选中变化会改 stamp', () => {
    const base = [node({ id: 'a' })]
    const locked = [node({ id: 'a', data: { kind: 'image', label: '', content: '', prompt: '', mode: 'idle', locked: true } })]
    const selected = [node({ id: 'a', selected: true })]
    expect(canvasNodeViewStamp(locked)).not.toBe(canvasNodeViewStamp(base))
    expect(canvasNodeViewStamp(selected)).not.toBe(canvasNodeViewStamp(base))
  })
})

describe('buildCanvasNodeView', () => {
  it('编号与 canvasKindIndex 一致，锁定认父组', () => {
    const group = node({
      id: 'g',
      type: 'group',
      data: { kind: 'group', label: '组', color: '#eee', layout: 'row', locked: true },
    })
    const first = node({ id: 'i1', position: { x: 0, y: 10 }, parentNode: 'g' })
    const second = node({ id: 'i2', position: { x: 0, y: 80 } })
    const list = [second, first, group]
    const view = buildCanvasNodeView(list)
    expect(view.kindNo.i1).toBe(canvasKindIndex(list, 'i1', 'image'))
    expect(view.kindNo.i2).toBe(canvasKindIndex(list, 'i2', 'image'))
    expect(view.locked.g).toBe(true)
    expect(view.locked.i1).toBe(true)
    expect(view.locked.i2).toBeUndefined()
  })

  it('标记框按 source 归组，并跳过上一轮基线', () => {
    const source = node({
      id: 'img',
      data: {
        kind: 'image',
        label: '',
        content: '',
        prompt: '',
        mode: 'idle',
        markElements: [
          { id: 'old', name: '旧', sourceNodeId: 'img', box: { x: 0, y: 0, w: 0.2, h: 0.2 } },
          { id: 'new', name: '新', sourceNodeId: 'img', box: { x: 0.3, y: 0.3, w: 0.2, h: 0.2 } },
        ],
      },
    })
    const closed = buildCanvasNodeView([source], { open: false, ownerId: '', analyzingId: '', baselineIds: [] })
    expect(closed.marks).toEqual({})
    const open = buildCanvasNodeView([source], { open: true, ownerId: 'n1', analyzingId: '', baselineIds: ['old'] })
    expect(open.marks.img).toEqual([
      { id: 'new', name: '新', box: { x: 0.3, y: 0.3, w: 0.2, h: 0.2 } },
    ])
  })

  it('收起组用子节点缩略图，不必再扫整表', () => {
    const group = node({
      id: 'g',
      type: 'group',
      data: { kind: 'group', label: '组', color: '#eee', layout: 'row', collapsed: true },
    })
    const kid = node({
      id: 'v1',
      parentNode: 'g',
      position: { x: 12, y: 0 },
      data: { kind: 'video', label: '', content: 'https://cdn.example/a.mp4', prompt: '', mode: 'idle' },
    })
    const view = buildCanvasNodeView([group, kid])
    const grouped = view.groups.g
    expect(grouped).toBeDefined()
    expect(grouped?.layout).toBe('row')
    expect(grouped?.thumbs).toHaveLength(1)
    expect(grouped?.thumbs[0]?.id).toBe('v1')
    expect(grouped?.thumbs[0]?.video).toBe(true)
    expect(grouped?.thumbs[0]?.media).toContain('a.mp4')
  })
})

describe('卡片不再订阅 vue-flow 全表', () => {
  it('平移不裁剪卸载节点，避免进出视口反复挂载', () => {
    const ws = readFileSync(new URL('../components/canvas/CanvasWorkspace.vue', import.meta.url), 'utf8')
    expect(ws).toContain(':only-render-visible-elements="false"')
  })

  it('节点 / 组 / 边不读 nodes 整表', () => {
    const card = readFileSync(new URL('../components/canvas/CanvasNode.vue', import.meta.url), 'utf8')
    const group = readFileSync(new URL('../components/canvas/CanvasGroupNode.vue', import.meta.url), 'utf8')
    const edge = readFileSync(new URL('../components/canvas/CanvasEdge.vue', import.meta.url), 'utf8')
    expect(card).not.toContain('viewport, nodes, findNode')
    expect(card).not.toContain('nodes.value')
    expect(card).toContain('CANVAS_NODE_VIEW_KEY')
    expect(group).not.toContain('getNodes')
    expect(group).toContain('CANVAS_NODE_VIEW_KEY')
    expect(edge).not.toContain('getSelectedNodes')
    expect(edge).toContain('CANVAS_NODE_VIEW_KEY')
  })

  it('未播放的视频卡片不立刻挂 video', () => {
    const player = readFileSync(new URL('../components/canvas/CanvasVideoPlayer.vue', import.meta.url), 'utf8')
    expect(player).toContain('hydrated')
    expect(player).toContain('ossVideoSnapshotUrl')
    expect(player).toContain('v-if="hydrated"')
    expect(player).toContain('onPosterLoad')
    expect(player).toContain('probeVideoSize')
  })
})
