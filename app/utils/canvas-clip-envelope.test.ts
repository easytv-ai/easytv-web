import { describe, expect, it } from 'vitest'
import {
  CLIP_APP,
  collectClipAssetIds,
  encodeClipEnvelope,
  newestEnvelope,
  parseClipEnvelope,
  remapClipAssetIds,
} from './canvas-clip-envelope'
import type { CanvasClipItem } from '~/composables/useCanvasClipboard'

function item(id: string, data: Record<string, unknown> = {}): CanvasClipItem {
  return { id, kind: 'image', x: 10, y: 20, data: { kind: 'image', label: id, ...data } as any }
}

describe('canvas-clip-envelope', () => {
  it('encode 出 app / v / at / canvas_id / team_id，parse 能原样读回', () => {
    const text = encodeClipEnvelope({
      canvasId: 7,
      teamId: 3,
      items: [item('image-1', { assetId: 11 })],
      edges: [{ source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in' }],
      incoming: [{ source: 'x', target: 'image-1' }],
      at: 1000,
    })
    const raw = JSON.parse(text)
    expect(raw.app).toBe(CLIP_APP)
    expect(raw.v).toBe(1)
    expect(raw.at).toBe(1000)
    const env = parseClipEnvelope(`  \n${text}\n `)
    expect(env).not.toBeNull()
    expect(env!.canvas_id).toBe(7)
    expect(env!.team_id).toBe(3)
    expect(env!.items).toHaveLength(1)
    expect(env!.edges).toHaveLength(1)
    expect(env!.incoming).toHaveLength(1)
  })

  it('encode 默认 at 取当前时间', () => {
    const before = Date.now()
    const env = parseClipEnvelope(encodeClipEnvelope({ canvasId: 1, teamId: 0, items: [item('a')], edges: [], incoming: [] }))
    expect(env!.at).toBeGreaterThanOrEqual(before)
  })

  it('不是信封的文本一律 null', () => {
    expect(parseClipEnvelope('')).toBeNull()
    expect(parseClipEnvelope('hello')).toBeNull()
    expect(parseClipEnvelope('{not json')).toBeNull()
    expect(parseClipEnvelope('[]')).toBeNull()
    expect(parseClipEnvelope(JSON.stringify({ app: 'other', v: 1, items: [item('a')] }))).toBeNull()
    expect(parseClipEnvelope(JSON.stringify({ app: CLIP_APP, v: 2, items: [item('a')] }))).toBeNull()
    expect(parseClipEnvelope(JSON.stringify({ app: CLIP_APP, v: 1, items: 'nope' }))).toBeNull()
    expect(parseClipEnvelope(JSON.stringify({ app: CLIP_APP, v: 1, items: [] }))).toBeNull()
    expect(parseClipEnvelope(JSON.stringify({ app: CLIP_APP, v: 1, items: [{ id: 1 }] }))).toBeNull()
    expect(parseClipEnvelope(undefined)).toBeNull()
  })

  it('超过 2 MB 直接拒绝', () => {
    const big = JSON.stringify({ app: CLIP_APP, v: 1, items: [item('a', { content: 'x'.repeat(2 * 1024 * 1024) })] })
    expect(parseClipEnvelope(big)).toBeNull()
  })

  it('缺 edges / incoming 时补空数组，坏连线被过滤', () => {
    const env = parseClipEnvelope(JSON.stringify({ app: CLIP_APP, v: 1, items: [item('a')], edges: [{ source: 'a' }, 3], incoming: null }))
    expect(env!.edges).toEqual([])
    expect(env!.incoming).toEqual([])
    expect(env!.at).toBe(0)
  })

  it('newestEnvelope 取 at 最大的一份，跳过空的', () => {
    const a = parseClipEnvelope(encodeClipEnvelope({ canvasId: 1, teamId: 0, items: [item('a')], edges: [], incoming: [], at: 10 }))
    const b = parseClipEnvelope(encodeClipEnvelope({ canvasId: 2, teamId: 0, items: [item('b')], edges: [], incoming: [], at: 30 }))
    const c = parseClipEnvelope(encodeClipEnvelope({ canvasId: 3, teamId: 0, items: [item('c')], edges: [], incoming: [], at: 20 }))
    expect(newestEnvelope([a, null, b, undefined, c])).toBe(b)
    expect(newestEnvelope([null, undefined])).toBeNull()
  })

  it('collectClipAssetIds 递归收所有 *AssetId，含 refItems，去重，忽略 subjectIds 和非正数', () => {
    const ids = collectClipAssetIds([
      item('a', { assetId: 5, refAssetId: 6, styleAssetId: 5, subjectIds: [99], refItems: [{ assetId: 7, url: 'u' }, { url: 'v' }] }),
      item('b', { assetId: 0, voiceAssetId: -1, castAssetId: '8', talking: { setAssetId: 9 } }),
      item('c', { assetId: undefined, markUrl: 'https://x/12.png' }),
    ])
    expect([...ids].sort((x, y) => x - y)).toEqual([5, 6, 7, 8, 9])
  })

  it('remapClipAssetIds 改写 id、删掉 missing 的 id 键、保留 url，且不改原对象', () => {
    const data = {
      kind: 'image',
      label: 'a',
      assetId: 5,
      content: 'https://x/5.png',
      refAssetId: 6,
      refUrl: 'https://x/6.png',
      subjectIds: [99],
      refItems: [{ assetId: 7, url: 'u' }, { assetId: 6, url: 'v' }],
      talking: { voiceAssetId: 9 },
    } as any
    const out = remapClipAssetIds(data, new Map([[5, 50], [7, 70]]), new Set([6]))
    expect(out.assetId).toBe(50)
    expect(out.content).toBe('https://x/5.png')
    expect('refAssetId' in out).toBe(false)
    expect(out.refUrl).toBe('https://x/6.png')
    expect(out.subjectIds).toEqual([99])
    expect(out.refItems).toEqual([{ assetId: 70, url: 'u' }, { url: 'v' }])
    expect(out.talking).toEqual({ voiceAssetId: 9 })
    expect(data.assetId).toBe(5)
    expect(data.refAssetId).toBe(6)
    expect(data.refItems[1].assetId).toBe(6)
  })
})
