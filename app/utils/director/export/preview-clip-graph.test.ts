import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { nextPreviewLeft, pickPreviewVideoModel, planPreviewClipGraph, PREVIEW_BATCH_LAYER, PREVIEW_VIDEO_MODEL_FALLBACK, previewBatchItems, previewClipPoints, previewControlLinks, previewControlNodesForShot, previewExportPoints } from './preview-clip-graph'
import type { PreviewFramePlan } from './preview-frames'

function frame(shotIndex: number, time: number): PreviewFramePlan {
  return { shotIndex, time, label: `镜子${shotIndex + 1}-${time.toFixed(2)}s.png` }
}

describe('预演帧排成画布图', () => {
  it('没有帧时是空图', () => {
    expect(planPreviewClipGraph([])).toEqual({ version: 1, nodes: [], edges: [] })
  })

  it('一镜一帧走 i2v，时长用 5 秒', () => {
    const graph = planPreviewClipGraph([frame(0, 1.2)], ['固定镜头，机位保持稳定'])
    const image = graph.nodes.find(node => node.kind === 'image')!
    const video = graph.nodes.find(node => node.kind === 'video')!
    expect(image.data.model).toBeUndefined()
    expect(image.data.previewFrame).toEqual({ shotIndex: 0, index: 0, time: 1.2 })
    expect(video.data.videoMode).toBe('i2v')
    expect(video.data.previewSubmit).toBe('first-last-prompt')
    expect(video.data.model).toBe(PREVIEW_VIDEO_MODEL_FALLBACK)
    expect(video.data.prompt).toBe('固定镜头，机位保持稳定')
    expect(video.data.params).toMatchObject({ duration: 5, resolution: '1080P', ratio: '16:9' })
    expect(graph.edges.map(edge => `${edge.source}->${edge.target}`)).toEqual(['preview-s1-f1->preview-s1-video'])
  })

  it('首尾时刻不同走 fl2v，只连第一帧和最后一帧', () => {
    const graph = planPreviewClipGraph([frame(0, 0), frame(0, 1), frame(0, 4)], ['镜头前推'])
    const video = graph.nodes.find(node => node.kind === 'video')!
    expect(graph.nodes.filter(node => node.kind === 'image')).toHaveLength(3)
    expect(video.data.videoMode).toBe('fl2v')
    expect((video.data.params as { duration: number }).duration).toBe(4)
    expect(graph.edges.map(edge => edge.source)).toEqual(['preview-s1-f1', 'preview-s1-f3'])
  })

  it('深度和白模只留图像，不排视频', () => {
    const graph = planPreviewClipGraph([frame(0, 0), frame(0, 2)], ['镜头前推'], [], { imagesOnly: true })
    expect(graph.nodes.map(node => node.kind)).toEqual(['group', 'image', 'image'])
    expect(graph.edges).toEqual([])
    expect(graph.nodes.filter(node => node.kind === 'image').every(node => node.data.previewControl === true)).toBe(true)
  })

  it('一镜一组，帧和视频横排挂在组里', () => {
    const graph = planPreviewClipGraph([frame(0, 0), frame(0, 2)], ['镜头前推'])
    const group = graph.nodes.find(node => node.kind === 'group')!
    expect(group).toMatchObject({
      id: 'preview-s1-group',
      data: { kind: 'group', label: '镜子1', layout: 'row' },
    })
    const kids = graph.nodes.filter(node => node.parentId === group.id)
    expect(kids.map(node => node.kind)).toEqual(['image', 'image', 'video'])
    expect(kids.map(node => node.x)).toEqual([28, 364, 700])
    expect(kids.every(node => node.y === 28)).toBe(true)
    expect(group.width).toBe(700 + 360 + 28)
    expect(group.height).toBe(260 + 56)
  })

  it('两镜各占一组，第二组叠在第一组下面', () => {
    const graph = planPreviewClipGraph([frame(0, 0), frame(1, 2)])
    const groups = graph.nodes.filter(node => node.kind === 'group')
    expect(groups.map(node => node.id)).toEqual(['preview-s1-group', 'preview-s2-group'])
    expect(groups[1]!.y).toBe(groups[0]!.y + groups[0]!.height + 24)
    expect(graph.nodes.find(node => node.id === 'preview-s2-video')!.parentId).toBe('preview-s2-group')
  })

  it('两镜各一条视频，提示词按下标对齐；上传结果抄进对应帧', () => {
    const graph = planPreviewClipGraph(
      [frame(0, 0), frame(0, 2), frame(1, 2), frame(1, 5)],
      ['镜头前推', '镜头右摇'],
      [{ shotIndex: 1, time: 2, url: 'https://cdn.example/far.png', assetId: 9 }],
    )
    const videos = graph.nodes.filter(node => node.kind === 'video')
    expect(videos.map(node => node.data.videoMode)).toEqual(['fl2v', 'fl2v'])
    expect(videos.map(node => node.data.prompt)).toEqual(['镜头前推', '镜头右摇'])
    const farStart = graph.nodes.find(node => node.id === 'preview-s2-f1')!
    expect(farStart.data.content).toBe('https://cdn.example/far.png')
    expect(farStart.data.assetId).toBe(9)
    expect(graph.nodes.find(node => node.id === 'preview-s1-f1')!.data.assetId).toBeUndefined()
  })

  it('视频模型可覆盖：报价和批量条目读同一条', () => {
    const graph = planPreviewClipGraph(
      [frame(0, 0), frame(0, 4)],
      ['镜头前推'],
      [{ shotIndex: 0, time: 0, url: 'https://cdn/a.png', assetId: 11 }, { shotIndex: 0, time: 4, url: 'https://cdn/b.png', assetId: 22 }],
      { videoModel: 'Kling-2.6' },
    )
    const video = graph.nodes.find(node => node.kind === 'video')!
    expect(video.data.model).toBe('Kling-2.6')
    expect(previewClipPoints(graph, (model, duration) => model === 'Kling-2.6' ? duration * 10 : 0)).toBe(40)
    expect(previewBatchItems(graph, id => id)[0]).toMatchObject({ model: 'Kling-2.6' })
  })

  it('彩色视频按每镜时长加总；深度白模和未定价都是 0', () => {
    const quote = (model: string, duration: number) => model === 'Kling-2.5' ? duration * 16 : 0
    const color = planPreviewClipGraph(
      [frame(0, 0), frame(0, 4), frame(1, 4)],
      ['镜头前推', '固定镜头，机位保持稳定'],
    )
    expect(previewClipPoints(color, quote)).toBe(4 * 16 + 5 * 16)
    const control = planPreviewClipGraph([frame(0, 0), frame(0, 2)], ['镜头前推'], [], { imagesOnly: true })
    expect(previewClipPoints(control, quote)).toBe(0)
    expect(previewClipPoints(color, () => 0)).toBe(0)
  })

  it('导出前报价：彩色按路径时长，深度和白模是 0', () => {
    const quote = (model: string, duration: number) => model === 'Kling-2.5' ? duration * 16 : 0
    const camera = {
      nodes: [
        { id: 'a', time: 0, position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number], fov: 50 },
        { id: 'b', time: 4, position: [0, 0, -2] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number], fov: 50 },
      ],
    }
    expect(previewExportPoints(camera, { mode: 'shot-ends' }, 'color', quote)).toBe(4 * 16)
    expect(previewExportPoints(camera, { mode: 'shot-ends' }, 'depth', quote)).toBe(0)
    expect(previewExportPoints(camera, { mode: 'shot-ends' }, 'matte', quote)).toBe(0)
  })

  it('彩色预演批量条目带首尾帧资产，深度白模没有条目', () => {
    const color = planPreviewClipGraph(
      [frame(0, 0), frame(0, 4)],
      ['镜头前推'],
      [{ shotIndex: 0, time: 0, url: 'https://cdn/a.png', assetId: 11 }, { shotIndex: 0, time: 4, url: 'https://cdn/b.png', assetId: 22 }],
    )
    const items = previewBatchItems(color, id => `${id}-x`)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      node_id: 'preview-s1-video-x',
      layer: PREVIEW_BATCH_LAYER,
      type: 'video',
      model: PREVIEW_VIDEO_MODEL_FALLBACK,
      prompt: '镜头前推',
      params: { count: 1, mode: 'fl2v', ratio: '16:9', resolution: '1080P', duration: 4, audio: true },
    })
    expect(items[0]!.inputs).toEqual([
      { asset_id: 11, role: 'first_frame' },
      { asset_id: 22, role: 'last_frame' },
    ])
    const control = planPreviewClipGraph([frame(0, 0), frame(0, 2)], ['镜头前推'], [
      { shotIndex: 0, time: 0, url: 'https://cdn/a.png', assetId: 11 },
      { shotIndex: 0, time: 2, url: 'https://cdn/b.png', assetId: 22 },
    ], { imagesOnly: true })
    expect(previewBatchItems(control, id => id)).toEqual([])
  })

  it('控制图按镜子认出来，已经挂上的连线不再重复', () => {
    const depth = { id: 'depth-1', data: { previewControl: true, previewFrame: { shotIndex: 0, index: 0, time: 0 }, assetId: 33 } }
    const other = { id: 'depth-2', data: { previewControl: true, previewFrame: { shotIndex: 1, index: 0, time: 0 }, assetId: 44 } }
    expect(previewControlNodesForShot([depth, other], 0).map(node => node.id)).toEqual(['depth-1'])
    const first = { id: 'f1', data: { previewFrame: { shotIndex: 0, index: 0, time: 0 }, assetId: 11 } }
    const video = { id: 'v1', data: { kind: 'video', previewSubmit: 'first-last-prompt' } }
    const edges = [
      { source: 'f1', target: 'v1' },
      { source: 'depth-1', target: 'v1' },
    ]
    expect(previewControlLinks([first, video, depth], edges)).toEqual([])
    expect(previewControlLinks([first, video, depth], [{ source: 'f1', target: 'v1' }])).toEqual([
      { source: 'depth-1', target: 'v1', shotIndex: 0, assetId: 33 },
    ])
  })

  it('预演批量把同一镜的控制图按参考带上', () => {
    const color = planPreviewClipGraph(
      [frame(0, 0), frame(0, 4)],
      ['镜头前推'],
      [{ shotIndex: 0, time: 0, url: 'https://cdn/a.png', assetId: 11 }, { shotIndex: 0, time: 4, url: 'https://cdn/b.png', assetId: 22 }],
    )
    const items = previewBatchItems(color, id => id, [{ shotIndex: 0, assetId: 33 }])
    expect(items[0]!.inputs).toEqual([
      { asset_id: 11, role: 'first_frame' },
      { asset_id: 22, role: 'last_frame' },
      { asset_id: 33, role: 'reference' },
    ])
  })

  it('没有资产或提示词的视频不进批次', () => {
    const graph = planPreviewClipGraph([frame(0, 1.2)], [''])
    expect(previewBatchItems(graph, id => id)).toEqual([])
  })

  it('下一批预演接到已有组右边，左边的组不影响', () => {
    expect(nextPreviewLeft(400, [])).toBe(400)
    expect(nextPreviewLeft(400, [{ x: 400, width: 360 }])).toBe(820)
    expect(nextPreviewLeft(400, [{ x: 0, width: 200 }, { x: 400, width: 360 }])).toBe(820)
  })
})

describe('预演视频模型', () => {
  it('清单里约定模型还定价就继续用', () => {
    expect(pickPreviewVideoModel([
      { type: 'video', model: 'seedance-1', priced: true },
      { type: 'video', model: 'Kling-2.5', priced: true },
    ])).toBe('Kling-2.5')
  })

  it('约定模型下架或没定价时换第一条已定价视频模型', () => {
    expect(pickPreviewVideoModel([
      { type: 'image', model: 'qwen-image-2.0', priced: true },
      { type: 'video', model: 'Kling-2.5', priced: false },
      { type: 'video', model: 'Kling-2.6', priced: true },
    ])).toBe('Kling-2.6')
  })

  it('清单空着或没有视频模型时不发明名字', () => {
    expect(pickPreviewVideoModel([])).toBe('')
    expect(pickPreviewVideoModel([{ type: 'image', model: 'qwen-image-2.0', priced: true }])).toBe('')
  })
})

describe('导演台落图接线', () => {
  const src = readFileSync(new URL('../../../pages/canvas/director.vue', import.meta.url), 'utf8')

  it('预演组按 group 落地，帧和视频挂 parentNode', () => {
    expect(src).toContain("placed.kind === 'group'")
    expect(src).toContain("type: 'group'")
    expect(src).toContain('parentNode: parentId')
    expect(src).toContain("extent: parentId ? 'parent' : undefined")
    expect(src).toContain('nextPreviewLeft(')
    expect(src).toContain('previewFrame')
    expect(src).toContain("useState('director-preview-placing'")
    expect(src).toContain('previewPlacing.value = true')
    expect(src).toContain("useState<AbortController | null>('director-preview-abort'")
    expect(src).toContain('signal?.aborted')
    expect(src).toContain("t('已取消导出预演')")
    expect(src).toContain('canvas.director.preview.controlPlaced')
    expect(src).toContain('previewControlLinks')
    expect(src).toContain('extraControls')
    expect(src).toContain('pickPreviewVideoModel')
    expect(src).toContain('previewBatchItems(')
    expect(src).toContain('batchApi.create')
  })
})

describe('生产环境关掉导演台调试页', () => {
  it('pages:extend 在 production 拿掉 /director-dev', () => {
    const src = readFileSync(new URL('../../../../nuxt.config.ts', import.meta.url), 'utf8')
    expect(src).toContain("NODE_ENV === 'production'")
    expect(src).toContain('/director-dev')
    expect(src).toContain("'stats.js'")
    expect(src).toContain('needsInterop')
  })
})

describe('试用页预演接线', () => {
  it('导出预演本地下载，不进画布', () => {
    const src = readFileSync(new URL('../../../pages/director-dev/index.vue', import.meta.url), 'utf8')
    expect(src).toContain('@export-preview="item => downloadPreviewFrames(item.frames)"')
    expect(src).toContain('downloadPreviewFrames')
    expect(src).toContain("middleware: ['auth', 'dev-only']")
  })
})
