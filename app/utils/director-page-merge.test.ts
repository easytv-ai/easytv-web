import { describe, expect, it } from 'vitest'
import { mergeDirectorEdits } from './director-page-merge'

function edits(partial: Partial<Parameters<typeof mergeDirectorEdits>[2]> = {}) {
  return {
    nodeId: 'director-1',
    addedNodeIds: new Set<string>(),
    addedEdgeIds: new Set<string>(),
    removedEdgeIds: new Set<string>(),
    ...partial,
  }
}

describe('mergeDirectorEdits', () => {
  it('只把导演台场景叠到最新版上，别处对其他节点的修改保留', () => {
    const latest = {
      nodes: [
        { id: 'director-1', data: { kind: 'director', label: '改过的名字', scene: { v: 1 } } },
        { id: 'image-1', data: { prompt: '别处新改的提示词' } },
      ],
      edges: [],
    }
    const mine = {
      nodes: [
        { id: 'director-1', data: { kind: 'director', label: '旧名字', scene: { v: 2 }, previewUrl: 'https://cdn/p.jpg' } },
        { id: 'image-1', data: { prompt: '旧提示词' } },
      ],
      edges: [],
    }
    const merged = mergeDirectorEdits(latest, mine, edits())!
    expect(merged.nodes[0].data).toEqual({ kind: 'director', label: '改过的名字', scene: { v: 2 }, previewUrl: 'https://cdn/p.jpg' })
    expect(merged.nodes[1].data.prompt).toBe('别处新改的提示词')
    expect(latest.nodes[0]!.data.scene).toEqual({ v: 1 })
  })

  it('本页加的截图节点撞号时改名并跟着改连线', () => {
    const latest = {
      nodes: [{ id: 'director-1', data: {} }, { id: 'image-3', data: { prompt: '别处加的' } }],
      edges: [],
    }
    const mine = {
      nodes: [{ id: 'director-1', data: {} }, { id: 'image-3', data: { content: 'https://cdn/shot.png' } }],
      edges: [{ id: 'e-director-1-image-3', source: 'director-1', target: 'image-3' }],
    }
    const merged = mergeDirectorEdits(latest, mine, edits({
      addedNodeIds: new Set(['image-3']),
      addedEdgeIds: new Set(['e-director-1-image-3']),
    }))!
    expect(merged.nodes.map(n => n.id)).toEqual(['director-1', 'image-3', 'image-4'])
    expect(merged.nodes[2].data.content).toBe('https://cdn/shot.png')
    expect(merged.edges).toEqual([{ id: 'e-director-1-image-4', source: 'director-1', target: 'image-4' }])
  })

  it('本页加的组撞号时改名，组里的节点跟着改父级', () => {
    const latest = {
      nodes: [{ id: 'director-1', data: {} }, { id: 'preview-s1-group', data: { kind: 'group' } }],
      edges: [],
    }
    const mine = {
      nodes: [
        { id: 'director-1', data: {} },
        { id: 'preview-s1-group', data: { kind: 'group', label: '镜子1' } },
        { id: 'preview-s1-f1', parentNode: 'preview-s1-group', data: { kind: 'image' } },
      ],
      edges: [],
    }
    const merged = mergeDirectorEdits(latest, mine, edits({
      addedNodeIds: new Set(['preview-s1-group', 'preview-s1-f1']),
    }))!
    expect(merged.nodes.map(n => n.id)).toEqual(['director-1', 'preview-s1-group', 'preview-s1-group-2', 'preview-s1-f1'])
    expect(merged.nodes.find(n => n.id === 'preview-s1-f1')?.parentNode).toBe('preview-s1-group-2')
  })

  it('本页断开的全景连线在最新版里也删掉', () => {
    const latest = {
      nodes: [{ id: 'director-1', data: {} }, { id: 'pano-1', data: {} }],
      edges: [{ id: 'e1', source: 'pano-1', target: 'director-1' }],
    }
    const merged = mergeDirectorEdits(latest, { nodes: [{ id: 'director-1', data: {} }], edges: [] }, edits({ removedEdgeIds: new Set(['e1']) }))!
    expect(merged.edges).toEqual([])
  })

  it('最新版里导演台节点已被删除时无法合并', () => {
    expect(mergeDirectorEdits({ nodes: [], edges: [] }, { nodes: [{ id: 'director-1', data: {} }], edges: [] }, edits())).toBeNull()
  })
})
