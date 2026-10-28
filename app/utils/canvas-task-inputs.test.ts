import { describe, expect, it } from 'vitest'
import { buildCanvasTaskInputs, countUnlinkedCanvasRefs, pushCanvasRefImage } from './canvas-task-inputs'
import type { CanvasNodeData } from './canvas-node-kinds'

function node(data: Partial<CanvasNodeData>): { data: CanvasNodeData } {
  return { data: { kind: 'image', label: '图', ...data } as CanvasNodeData }
}

describe('pushCanvasRefImage', () => {
  it('按资产 id 和地址去重', () => {
    const items: Array<{ assetId?: number, url: string, name?: string }> = []
    const seenId = new Set<number>()
    const seenUrl = new Set<string>()
    pushCanvasRefImage(items, seenId, seenUrl, 1, 'https://a')
    pushCanvasRefImage(items, seenId, seenUrl, 1, 'https://b')
    pushCanvasRefImage(items, seenId, seenUrl, 2, 'https://a')
    pushCanvasRefImage(items, seenId, seenUrl, undefined, '')
    expect(items).toEqual([{ assetId: 1, url: 'https://a' }])
  })
})

describe('buildCanvasTaskInputs', () => {
  it('图片节点参考图走 image，并带上风格 / 蒙版', () => {
    const inputs = buildCanvasTaskInputs(
      node({ styleAssetId: 9, markAssetId: 8 }),
      '',
      [{ assetId: 1, url: 'https://a' }],
      [],
    )
    expect(inputs).toEqual([
      { asset_id: 1, role: 'image' },
      { asset_id: 9, role: 'style' },
      { asset_id: 8, role: 'mask' },
    ])
  })

  it('视频 i2v 只把第一张当首帧', () => {
    const inputs = buildCanvasTaskInputs(
      node({ kind: 'video' }),
      'i2v',
      [{ assetId: 1, url: 'https://a' }, { assetId: 2, url: 'https://b' }],
      [],
    )
    expect(inputs).toEqual([{ asset_id: 1, role: 'first_frame' }])
  })

  it('预演视频把首尾帧之外的控制图按参考带上', () => {
    const inputs = buildCanvasTaskInputs(
      node({ kind: 'video', previewSubmit: 'first-last-prompt' }),
      'fl2v',
      [
        { assetId: 1, url: 'https://a' },
        { assetId: 2, url: 'https://b' },
        { assetId: 3, url: 'https://depth' },
      ],
      [],
    )
    expect(inputs).toEqual([
      { asset_id: 1, role: 'first_frame' },
      { asset_id: 2, role: 'last_frame' },
      { asset_id: 3, role: 'reference' },
    ])
  })

  it('同一张角色图不重复进 inputs', () => {
    const inputs = buildCanvasTaskInputs(
      node({ castAssetId: 1, setAssetId: 2 }),
      '',
      [{ assetId: 1, url: 'https://cast' }, { assetId: 2, url: 'https://set' }, { assetId: 3, url: 'https://sword' }],
      [],
    )
    expect(inputs).toEqual([
      { asset_id: 1, role: 'character' },
      { asset_id: 2, role: 'scene' },
      { asset_id: 3, role: 'image' },
    ])
  })

  it('视频全能参考把视频 / 音频单独挂角色', () => {
    const inputs = buildCanvasTaskInputs(
      node({ kind: 'video' }),
      '',
      [{ assetId: 1, url: 'https://a' }],
      [
        { assetId: 3, url: 'https://v', kind: 'video' },
        { assetId: 4, url: 'https://m', kind: 'audio' },
      ],
    )
    expect(inputs).toEqual([
      { asset_id: 1, role: 'reference' },
      { asset_id: 3, role: 'reference_video' },
      { asset_id: 4, role: 'reference_audio' },
    ])
  })
})

describe('countUnlinkedCanvasRefs', () => {
  it('只统计有地址没有资产 id 的参考', () => {
    expect(countUnlinkedCanvasRefs(node({ lastUrl: 'https://x' }), [
      { url: 'https://a' },
      { assetId: 1, url: 'https://b' },
    ])).toBe(2)
  })
})
