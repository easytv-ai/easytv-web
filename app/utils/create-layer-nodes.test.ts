import { describe, expect, it } from 'vitest'
import {
  byShot,
  groupLayerNodes,
  hasPlanMarks,
  layerTagOf,
  refImageIn,
  shotIdOf,
  shotNoOf,
  type LayerFlowNode,
} from './create-layer-nodes'

function node(id: string, data: Record<string, unknown>, x = 0, y = 0): LayerFlowNode {
  return { id, type: 'easytv', position: { x, y }, data }
}

function ids(list: LayerFlowNode[]) {
  return list.map(n => n.id)
}

describe('sp 读取', () => {
  it('layerTagOf / shotNoOf / shotIdOf 缺失或不合法时给空值', () => {
    const plain = node('a', { kind: 'image' })
    expect(layerTagOf(plain)).toBe('')
    expect(shotNoOf(plain)).toBe(0)
    expect(shotIdOf(plain)).toBe('')
    expect(shotNoOf(node('b', { kind: 'video', sp: { layer: 'shot_video', shot: 'x' } }))).toBe(0)
    expect(shotNoOf(node('c', { kind: 'video', sp: { layer: 'shot_video', shot: '3' } }))).toBe(3)
    expect(shotIdOf(node('d', { sp: { layer: 'voice', shot: 1, shot_id: 'sh_abc12345' } }))).toBe('sh_abc12345')
    expect(layerTagOf(node('e', { sp: 'oops' }))).toBe('')
  })

  it('hasPlanMarks 只认 sp.layer', () => {
    expect(hasPlanMarks([node('a', { kind: 'image' }), node('b', { kind: 'video', sp: {} })])).toBe(false)
    expect(hasPlanMarks([node('a', { kind: 'image' }), node('b', { kind: 'text', sp: { layer: 'plan' } })])).toBe(true)
  })
})

describe('byShot', () => {
  it('镜号升序，没镜号的排后面按位置', () => {
    const list = [
      node('noshot-right', { sp: { layer: 'shot_video' } }, 500),
      node('s3', { sp: { layer: 'shot_video', shot: 3 } }, 10),
      node('noshot-left', { sp: { layer: 'shot_video' } }, 100),
      node('s1', { sp: { layer: 'shot_video', shot: 1 } }, 900),
      node('s2', { sp: { layer: 'shot_video', shot: 2 } }, 0),
    ]
    expect(ids([...list].sort(byShot))).toEqual(['s1', 's2', 's3', 'noshot-left', 'noshot-right'])
  })
})

describe('groupLayerNodes · 策划案模式', () => {
  const nodes = [
    node('text-1', { kind: 'text', sp: { layer: 'plan' } }),
    node('image-2', { kind: 'image', sp: { layer: 'character', key: 'c2' } }, 100),
    node('image-1', { kind: 'image', sp: { layer: 'character', key: 'c1' } }, 0),
    node('image-4', { kind: 'image', sp: { layer: 'shot_image', shot: 2, shot_id: 'sh_2' } }, 0),
    node('image-3', { kind: 'image', sp: { layer: 'shot_image', shot: 1, shot_id: 'sh_1' } }, 999),
    node('video-2', { kind: 'video', sp: { layer: 'shot_video', shot: 2, shot_id: 'sh_2' } }, 0),
    node('video-1', { kind: 'video', sp: { layer: 'shot_video', shot: 1, shot_id: 'sh_1' } }, 999),
    node('audio-1', { kind: 'audio', sp: { layer: 'voice', shot: 2, shot_id: 'sh_2' } }),
    // 工具条派生 / 用户手加的节点：没有 sp
    node('frame-1', { kind: 'image', prompt: '', parentId: 'video-1' }),
    node('audio-split', { kind: 'audio', content: 'x.mp3' }),
    node('video-retake', { kind: 'video', prompt: '' }),
    node('note', { kind: 'text', content: 'memo' }),
  ]

  it('四层只收对应 sp.layer 的节点，镜头按 sp.shot 升序', () => {
    const g = groupLayerNodes(nodes, [{ source: 'frame-1', target: 'video-retake' }])
    expect(g.planMode).toBe(true)
    expect(ids(g.character)).toEqual(['image-1', 'image-2'])
    expect(ids(g.shot)).toEqual(['image-3', 'image-4'])
    expect(ids(g.video)).toEqual(['video-1', 'video-2'])
    expect(ids(g.audio)).toEqual(['audio-1'])
  })

  it('没有 sp 的节点不进层，只计数；策划案文本节点不算「非策划案」', () => {
    const g = groupLayerNodes(nodes)
    expect(g.others).toBe(4)
    const all = [...g.character, ...g.shot, ...g.video, ...g.audio].map(n => n.id)
    expect(all).not.toContain('frame-1')
    expect(all).not.toContain('audio-split')
    expect(all).not.toContain('video-retake')
    expect(all).not.toContain('text-1')
  })

  it('派生节点连到了策划案视频也不会被当成分镜图', () => {
    const list = [
      node('video-1', { kind: 'video', sp: { layer: 'shot_video', shot: 1 }, refNodeId: 'frame-1' }),
      node('frame-1', { kind: 'image' }),
    ]
    const g = groupLayerNodes(list, [{ source: 'frame-1', target: 'video-1' }])
    expect(ids(g.shot)).toEqual([])
    expect(ids(g.video)).toEqual(['video-1'])
    expect(g.others).toBe(1)
  })
})

describe('groupLayerNodes · 老画布按 kind 推断', () => {
  it('被视频引用的图片算分镜图，其余图片算角色图，按位置排', () => {
    const nodes = [
      node('img-c', { kind: 'image' }, 50),
      node('img-b', { kind: 'image' }, 10),
      node('img-a', { kind: 'image' }, 0),
      node('vid-2', { kind: 'video', refNodeId: 'img-c' }, 300),
      node('vid-1', { kind: 'video' }, 200),
      node('aud-1', { kind: 'audio' }, 400),
      node('txt', { kind: 'text' }),
    ]
    const edges = [{ source: 'img-b', target: 'vid-1' }]
    const g = groupLayerNodes(nodes, edges)
    expect(g.planMode).toBe(false)
    expect(ids(g.video)).toEqual(['vid-1', 'vid-2'])
    expect(ids(g.shot)).toEqual(['img-b', 'img-c'])
    expect(ids(g.character)).toEqual(['img-a'])
    expect(ids(g.audio)).toEqual(['aud-1'])
    expect(g.others).toBe(0)
  })

  it('refImageIn 优先 refNodeId，其次上游连线；引用到非图片节点时忽略', () => {
    const img = node('img', { kind: 'image' })
    const other = node('vid-x', { kind: 'video' })
    const video = node('vid', { kind: 'video', refNodeId: 'vid-x' })
    expect(refImageIn([img, other, video], [{ source: 'img', target: 'vid' }], video)?.id).toBe('img')
    expect(refImageIn([img, other, video], [], video)).toBeNull()
    expect(refImageIn([img, other, node('v2', { kind: 'video', refNodeId: 'img' })], [], node('v2', { kind: 'video', refNodeId: 'img' }))?.id).toBe('img')
  })
})
