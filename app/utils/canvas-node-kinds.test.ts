import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  appendFxPrompt,
  appendStylePrompt,
  fxPresetPrompt,
  CANVAS_STAGE_SIZE,
  canvasCommentNodeHint,
  canvasFitMediaSize,
  canvasMediaSizeClose,
  cloneContentNodeData,
  CAMERA_MOVE_VIDEO,
  cameraIdsInPrompt,
  cameraMoveMotionPreview,
  cameraMoveVideoUrl,
  pickHdUpscaleModel,
  expandCameraTokens,
  insertCameraToken,
  stripCameraTokens,
  type CanvasNodeData,
} from './canvas-node-kinds'

describe('canvasFitMediaSize', () => {
  it('竖图按宽度 320 拉高，完整露出', () => {
    expect(canvasFitMediaSize(1024, 1792)).toEqual({ w: 320, h: 560 })
  })

  it('横图保持宽度 320，高度随比例变矮', () => {
    expect(canvasFitMediaSize(1920, 1080)).toEqual({ w: 320, h: 180 })
  })

  it('方图是正方形卡片', () => {
    expect(canvasFitMediaSize(1024, 1024)).toEqual({ w: 320, h: 320 })
  })

  it('9:16 不超过高度上限', () => {
    expect(canvasFitMediaSize(1080, 1920)).toEqual({ w: 320, h: 569 })
  })

  it('极宽图抬最短边，避免扁成一条', () => {
    expect(canvasFitMediaSize(2048, 512)).toEqual({ w: 640, h: 160 })
  })

  it('缺尺寸时回落到空图片节点', () => {
    expect(canvasFitMediaSize(0, 100)).toEqual({ w: CANVAS_STAGE_SIZE.image.w, h: CANVAS_STAGE_SIZE.image.h })
    expect(canvasFitMediaSize(100, 0)).toEqual({ w: CANVAS_STAGE_SIZE.image.w, h: CANVAS_STAGE_SIZE.image.h })
  })

  it('接近的卡片尺寸视为没变', () => {
    expect(canvasMediaSizeClose({ w: 320, h: 560 }, { w: 321, h: 559 })).toBe(true)
    expect(canvasMediaSizeClose({ w: 320, h: 560 }, { w: 320, h: 180 })).toBe(false)
  })
})

describe('cloneContentNodeData', () => {
  it('复制参考图和主体，并清掉进行中的任务', () => {
    const refs = [{ assetId: 8, url: 'https://cdn/a.png' }]
    const src: CanvasNodeData = {
      kind: 'video',
      label: '视频节点 1',
      content: 'https://cdn/out.mp4',
      prompt: '一只柴犬',
      mode: 'idle',
      refItems: refs,
      refAssetId: 8,
      refUrl: 'https://cdn/a.png',
      subjectIds: [3, 5],
      cameraMove: 'push',
      taskId: 99,
      taskStatus: 'running',
      taskProgress: 40,
      taskError: '',
    }
    const copy = cloneContentNodeData(src, { label: '视频节点 1 副本' })
    expect(copy.refItems).toEqual(refs)
    expect(copy.refItems).not.toBe(refs)
    expect(copy.refUrl).toBe('https://cdn/a.png')
    expect(copy.subjectIds).toEqual([3, 5])
    expect(copy.subjectIds).not.toBe(src.subjectIds)
    expect(copy.prompt).toBe('一只柴犬')
    expect(copy.content).toBe('https://cdn/out.mp4')
    expect(copy.label).toBe('视频节点 1 副本')
    expect(copy.taskId).toBeUndefined()
    expect(copy.taskStatus).toBe('')
    copy.refItems![0]!.url = 'mutated'
    expect(src.refItems![0]!.url).toBe('https://cdn/a.png')
  })

  it('副本可以覆盖 locked：锁定节点复制后解开', () => {
    const src: CanvasNodeData = {
      kind: 'image',
      label: '定妆',
      content: '',
      prompt: '红衣',
      mode: 'idle',
      locked: true,
    }
    expect(cloneContentNodeData(src).locked).toBe(true)
    expect(cloneContentNodeData(src, { locked: false }).locked).toBe(false)
  })
})

describe('cameraMoveVideoUrl', () => {
  it('固定镜头用已有的 fixed.mp4，不再套动作', () => {
    expect(cameraMoveVideoUrl('static')).toBe('/videos/camera-movement/fixed.mp4')
    expect(cameraMoveMotionPreview('static')).toBe('')
  })

  it('还没有独立片子的运镜回退固定镜头，并标出对应动作', () => {
    expect(cameraMoveVideoUrl('orbit')).toBe(CAMERA_MOVE_VIDEO)
    expect(cameraMoveMotionPreview('orbit')).toBe('orbit')
    expect(cameraMoveVideoUrl('push')).toBe(CAMERA_MOVE_VIDEO)
    expect(cameraMoveMotionPreview('push')).toBe('dolly-in')
  })

  it('未知运镜不套动作', () => {
    expect(cameraMoveVideoUrl('nope')).toBe(CAMERA_MOVE_VIDEO)
    expect(cameraMoveMotionPreview('nope')).toBe('')
    expect(cameraMoveVideoUrl()).toBe(CAMERA_MOVE_VIDEO)
    expect(cameraMoveMotionPreview()).toBe('')
  })
})

describe('pickHdUpscaleModel', () => {
  it('面板选中的模型还在清单里就用它', () => {
    expect(pickHdUpscaleModel({ model: 'topaz-2' }, ['auto-upscale', 'topaz-2'])).toBe('topaz-2')
  })

  it('没选或已下线的模型回落到清单第一条', () => {
    expect(pickHdUpscaleModel({ model: '' }, ['auto-upscale', 'topaz-2'])).toBe('auto-upscale')
    expect(pickHdUpscaleModel({ model: 'gone' }, ['auto-upscale'])).toBe('auto-upscale')
    expect(pickHdUpscaleModel(null, [])).toBe('')
  })
})

describe('insertCameraToken', () => {
  it('没给光标时插到文末', () => {
    expect(insertCameraToken('黄昏沙漠', 'static').prompt).toBe('黄昏沙漠{{cam:static}}')
  })

  it('插到指定光标', () => {
    expect(insertCameraToken('黄昏沙漠公路', 'follow', 2).prompt).toBe('黄昏{{cam:follow}}沙漠公路')
  })

  it('光标在开头就放最前面', () => {
    expect(insertCameraToken('黄昏沙漠', 'tilt-up', 0).prompt).toBe('{{cam:tilt-up}}黄昏沙漠')
  })
})

describe('camera token parse', () => {
  it('按出现顺序读出运镜，允许重复', () => {
    expect(cameraIdsInPrompt('{{cam:static}}黄昏{{cam:follow}}，{{cam:follow}}')).toEqual(['static', 'follow', 'follow'])
  })

  it('生成时把标签展开成运镜文案', () => {
    expect(expandCameraTokens('{{cam:static}}黄昏')).toBe('固定镜头，机位保持稳定黄昏')
  })

  it('去掉全部运镜标签', () => {
    expect(stripCameraTokens('{{cam:static}}黄昏{{cam:follow}}')).toBe('黄昏')
  })
})

describe('appendFxPrompt', () => {
  it('特效展开成文案接在提示词末尾，没选就原样', () => {
    expect(appendFxPrompt('海边日出', 'film')).toBe(`海边日出\n\n${fxPresetPrompt('film')}`)
    expect(appendFxPrompt('海边日出', '')).toBe('海边日出')
    expect(appendFxPrompt('', 'rain')).toBe(fxPresetPrompt('rain'))
  })

  it('已经写过同样的话或 id 未知时不重复、不报错', () => {
    const once = appendFxPrompt('海边日出', 'glow')
    expect(appendFxPrompt(once, 'glow')).toBe(once)
    expect(appendFxPrompt('海边日出', 'nope')).toBe('海边日出')
  })
})

describe('appendStylePrompt', () => {
  const film = { id: 1, name: '电影胶片', prompt: '35mm 胶片颗粒，宽银幕构图', negative: '过曝' }

  it('风格片段接在提示词末尾，没选就原样', () => {
    expect(appendStylePrompt('海边日出', film)).toBe(`海边日出\n\n${film.prompt}\n\n不要：${film.negative}`)
    expect(appendStylePrompt('海边日出', undefined)).toBe('海边日出')
    expect(appendStylePrompt('', film)).toBe(`${film.prompt}\n\n不要：${film.negative}`)
  })

  it('已经写过同样的话或片段为空时不重复、不报错', () => {
    const once = appendStylePrompt('海边日出', film)
    expect(appendStylePrompt(once, film)).toBe(once)
    expect(appendStylePrompt('海边日出', { id: 2, name: '空', prompt: '  ' })).toBe('海边日出')
  })

  it('复制节点时一并复制风格预设，且不共享引用', () => {
    const cloned = cloneContentNodeData({ kind: 'image', prompt: 'x', stylePreset: film } as any)
    expect(cloned.stylePreset).toEqual(film)
    expect(cloned.stylePreset).not.toBe(film)
  })
})

describe('canvasCommentNodeHint', () => {
  const nodes = [
    { id: 'text-1', position: { x: 0, y: 40 }, data: { kind: 'text' as const, content: '后写的一段', label: '', prompt: '' } },
    { id: 'text-3', position: { x: 0, y: 0 }, data: { kind: 'text' as const, content: '一只橘猫在雨夜的东京街头寻找回家的路：霓虹倒影、湿漉漉的柏油路。', label: '', prompt: '' } },
  ]

  it('标题跟卡片编号走，摘要取正文开头，对不上节点时返回空', () => {
    expect(canvasCommentNodeHint(nodes, 'text-3')).toEqual({
      title: '文本1',
      excerpt: '一只橘猫在雨夜的东京街头寻找回家的路：霓虹倒影、湿漉漉的柏油路。',
    })
    expect(canvasCommentNodeHint(nodes, 'text-1')?.title).toBe('文本2')
    expect(canvasCommentNodeHint(nodes, 'missing')).toBeNull()
  })

  it('图片地址不当摘要，有标签时用标签名', () => {
    const image = [{
      id: 'image-2',
      position: { x: 0, y: 0 },
      data: { kind: 'image' as const, content: 'https://tv-oss.easyapi.com/a.png', prompt: '雨夜橘猫', label: '', tag: '打光' },
    }]
    expect(canvasCommentNodeHint(image, 'image-2')).toEqual({ title: '打光', excerpt: '雨夜橘猫' })
  })
})

describe('半开能力收口', () => {
  it('不再导出未挂菜单的超长视频入口，也不再列出补帧 / 慢放选项', () => {
    const src = readFileSync(new URL('./canvas-node-kinds.ts', import.meta.url), 'utf8')
    expect(src).not.toContain('VIDEO_TRY_ITEMS')
    expect(src).not.toContain('5分钟超长视频')
    expect(src).not.toContain('HD_INTERP_ITEMS')
    expect(src).not.toContain('HD_SLOWMO_ITEMS')
  })

  it('空画布起步有配乐卡，带 audioKind', () => {
    const src = readFileSync(new URL('./canvas-node-kinds.ts', import.meta.url), 'utf8')
    expect(src).toContain("id: 'bgm'")
    expect(src).toContain("audioKind: 'bgm'")
    expect(src).toContain('canvas.audio.kind.bgm')
  })

  it('控制图角标写清回落', () => {
    const node = readFileSync(new URL('../components/canvas/CanvasNode.vue', import.meta.url), 'utf8')
    expect(node).toContain("t('控制图')")
    expect(node).toContain("t('canvas.director.preview.controlTag')")
  })

  it('角色设计师和剧本节点已下线', () => {
    expect(existsSync(new URL('../components/canvas/CanvasCharacterDesignerNode.vue', import.meta.url))).toBe(false)
    expect(existsSync(new URL('../utils/canvas-demo-cast.ts', import.meta.url))).toBe(false)
    expect(existsSync(new URL('../components/canvas/CanvasScriptNode.vue', import.meta.url))).toBe(false)
    const src = readFileSync(new URL('./canvas-node-kinds.ts', import.meta.url), 'utf8')
    expect(src).not.toContain("kind: 'character-designer'")
    expect(src).not.toContain("kind: 'script'")
  })

  it('导演助手拉对话额度', () => {
    const assist = readFileSync(new URL('../components/canvas/director/agent/DirectorAssistant.vue', import.meta.url), 'utf8')
    expect(assist).toContain('aiChatApi.quota')
    expect(assist).toContain('aiChatApi.create')
    expect(assist).toContain('chatQuotaExhausted')
    expect(assist).toContain('store.readonly.value')
    expect(assist).not.toContain('taskApi.create')
    expect(assist).toContain('查看模型原文')
    expect(assist).not.toContain('RAW_PREVIEW_LIMIT')
  })
})
