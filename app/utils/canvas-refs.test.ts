import { describe, expect, it } from 'vitest'
import {
  canvasAssetNodeKind,
  canvasAttachThumbKind,
  canvasConnectedRefs,
  canvasMediaKindOfUrl,
  canvasRefAcceptFor,
  canvasSyncRefFields,
  canvasUploadedRefList,
} from './canvas-refs'

describe('canvasRefAcceptFor', () => {
  it('按节点类型收参考', () => {
    expect(canvasRefAcceptFor('audio')).toEqual(['audio'])
    expect(canvasRefAcceptFor('video')).toEqual(['image', 'video', 'audio'])
    expect(canvasRefAcceptFor('director')).toEqual(['image', 'video', 'audio'])
    expect(canvasRefAcceptFor('image')).toEqual(['image'])
  })
})

describe('canvasMediaKindOfUrl / canvasAttachThumbKind', () => {
  it('按扩展名区分图片视频音频', () => {
    expect(canvasMediaKindOfUrl('https://a/x.mp4?t=1')).toBe('video')
    expect(canvasMediaKindOfUrl('https://a/x.wav')).toBe('audio')
    expect(canvasMediaKindOfUrl('https://a/x.png')).toBe('image')
    expect(canvasAttachThumbKind('voice', 'https://a/x.png')).toBe('audio')
    expect(canvasAttachThumbKind('ref', 'https://a/x.webm')).toBe('video')
  })
})

describe('canvasUploadedRefList / canvasSyncRefFields', () => {
  it('优先 refItems，否则回落到单张 refUrl', () => {
    expect(canvasUploadedRefList({ refItems: [{ assetId: 1, url: ' https://a ' }] })).toEqual([{ assetId: 1, url: 'https://a' }])
    expect(canvasUploadedRefList({ refUrl: 'https://b', refAssetId: 2 })).toEqual([{ assetId: 2, url: 'https://b' }])
    expect(canvasUploadedRefList(null)).toEqual([])
  })

  it('写回字段以第一张为准', () => {
    expect(canvasSyncRefFields([{ assetId: 3, url: 'https://c' }, { url: 'https://d' }])).toEqual({
      refItems: [{ assetId: 3, url: 'https://c' }, { url: 'https://d' }],
      refUrl: 'https://c',
      refAssetId: 3,
    })
  })
})

describe('canvasConnectedRefs', () => {
  const peers: Record<string, { id: string, kind: string, assetId: number, url: string }> = {
    img: { id: 'img', kind: 'image', assetId: 1, url: 'https://a/cat.png' },
    vid: { id: 'vid', kind: 'video', assetId: 5, url: 'https://a/clip.mp4' },
    aud: { id: 'aud', kind: 'audio', assetId: 8, url: 'https://a/bgm.mp3' },
    txt: { id: 'txt', kind: 'text', assetId: 0, url: '一只猫' },
    sheet: { id: 'sheet', kind: 'image', assetId: 9, url: 'https://a/sheet.png' },
    out: { id: 'out', kind: 'image', assetId: 2, url: 'https://a/out.png' },
  }

  it('视频节点把连进来的视频算进参考，图片节点不算', () => {
    const edges = [
      { id: 'e1', source: 'vid', target: 'out' },
      { id: 'e2', source: 'img', target: 'out' },
      { id: 'e3', source: 'aud', target: 'out' },
      { id: 'e4', source: 'txt', target: 'out' },
    ]
    const onVideo = canvasConnectedRefs('out', 'video', edges, id => peers[id] || null)
    expect(onVideo.map(item => item.kind)).toEqual(['video', 'image', 'audio'])
    expect(onVideo[0]).toMatchObject({ id: 'vid', edgeId: 'e1', assetId: 5, kind: 'video' })
    expect(canvasConnectedRefs('out', 'image', edges, id => peers[id] || null).map(item => item.id)).toEqual(['img'])
  })

  it('从当前节点连出去的下游图片不算参考', () => {
    const edges = [
      { id: 'in', source: 'img', target: 'out' },
      { id: 'down', source: 'out', target: 'sheet' },
    ]
    expect(canvasConnectedRefs('out', 'image', edges, id => peers[id] || null).map(item => item.id)).toEqual(['img'])
    expect(canvasConnectedRefs('sheet', 'image', edges, id => peers[id] || null).map(item => item.id)).toEqual(['out'])
  })
})

describe('canvasAssetNodeKind', () => {
  it('只把图片视频音频落成节点', () => {
    expect(canvasAssetNodeKind({ type: 'image' })).toBe('image')
    expect(canvasAssetNodeKind({ type: 'folder' })).toBeNull()
  })
})
