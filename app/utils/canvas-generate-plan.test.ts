import { describe, expect, it } from 'vitest'
import type { CanvasFlowNode } from '~/utils/canvas-group'
import type { CanvasNodeData } from '~/utils/canvas-node-kinds'
import { PANORAMA_SIZE } from '~/utils/canvas-node-kinds'
import { canvasGenerateTaskType, planCanvasGenerate } from './canvas-generate-plan'

function node(kind: CanvasNodeData['kind'], extra: Partial<CanvasNodeData> = {}): CanvasFlowNode {
  return {
    id: 'n1',
    type: 'easytv',
    position: { x: 0, y: 0 },
    data: { kind, label: kind, content: '', prompt: '', mode: 'idle', ...extra },
  }
}

const model = { model: 'img-1', params: { ratio: '16:9', count: 1 } }

describe('canvasGenerateTaskType', () => {
  it('角色、场景、编辑、全景出图，导演台出视频', () => {
    expect(canvasGenerateTaskType('character')).toBe('image')
    expect(canvasGenerateTaskType('scene')).toBe('image')
    expect(canvasGenerateTaskType('edit')).toBe('image')
    expect(canvasGenerateTaskType('panorama')).toBe('image')
    expect(canvasGenerateTaskType('director')).toBe('video')
    expect(canvasGenerateTaskType('text')).toBe('text')
    expect(canvasGenerateTaskType('storyboard')).toBeNull()
  })
})

describe('planCanvasGenerate', () => {
  it('没选节点、没选模型、没写提示词、正在生成时都不提交', () => {
    const cases = [
      planCanvasGenerate({ node: null }),
      planCanvasGenerate({ node: node('storyboard') }),
      planCanvasGenerate({ node: node('image'), payload: { model: '', params: {} } }),
      planCanvasGenerate({ node: node('image'), payload: model }),
      planCanvasGenerate({
        node: node('image', { prompt: '一只猫', taskStatus: 'running' }),
        payload: model,
      }),
    ]
    const keys = cases.map(item => item.ok ? '' : item.messageKey)
    expect(keys).toEqual([
      '请先选择节点',
      '请先选择节点',
      '请在节点面板里选择模型后点击生成',
      '请先填写提示词',
      '该节点正在生成中',
    ])
  })

  it('图片节点没有提示词时用上游连线文本', () => {
    const plan = planCanvasGenerate({
      node: node('image'),
      payload: model,
      connectedText: ' 上游写的 ',
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok)
      return
    expect(plan.prompt).toBe('上游写的')
    expect(plan.type).toBe('image')
  })

  it('文本节点把已有正文附在提示词后面', () => {
    const plan = planCanvasGenerate({
      node: node('text', { prompt: '改写' }),
      payload: { model: 'text-1', params: {} },
      plainText: '原来的段落',
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok)
      return
    expect(plan.prompt).toBe('改写\n\n【当前文本】\n原来的段落')
  })

  it('批量出图最多 4 张，视频只出 1 条，请求里的 count 固定为 1', () => {
    const image = planCanvasGenerate({
      node: node('image', { prompt: '一只猫' }),
      payload: { model: 'img-1', params: { count: 9, ratio: '1:1' } },
    })
    expect(image.ok && image.wanted).toBe(4)
    expect(image.ok && image.params.count).toBe(1)
    expect(image.ok && image.ratio).toBe('1:1')

    const video = planCanvasGenerate({
      node: node('video', { prompt: '推镜头' }),
      payload: { model: 'vid-1', params: { count: 4, ratio: '9:16' } },
    })
    expect(video.ok && video.wanted).toBe(1)
    expect(video.ok && video.type).toBe('video')
    expect(video.ok && video.ratio).toBe('9:16')
  })

  it('全景图强制尺寸并丢掉比例', () => {
    const plan = planCanvasGenerate({
      node: node('panorama', { prompt: '海边' }),
      payload: { model: 'img-1', params: { ratio: '16:9', count: 3 } },
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok)
      return
    expect(plan.params.size).toBe(PANORAMA_SIZE)
    expect(plan.params.ratio).toBeUndefined()
    expect(plan.wanted).toBe(1)
    expect(plan.ratio).toBeUndefined()
  })

  it('提示词里的运镜标记会展开，视频节点上的运镜会补一句译文', () => {
    const marked = planCanvasGenerate({
      node: node('image', { prompt: '海边 {{cam:dolly-in}}' }),
      payload: model,
    })
    expect(marked.ok).toBe(true)
    if (!marked.ok)
      return
    expect(marked.prompt).toContain('镜头前推')
    expect(marked.prompt).not.toContain('{{cam:')
    expect(marked.params.camera).toBe('dolly-in')

    const video = planCanvasGenerate({
      node: node('video', { prompt: '海边', cameraMove: 'orbit' }),
      payload: { model: 'vid-1', params: {} },
      translate: key => (key === '环绕拍摄' ? 'Orbit' : key),
    })
    expect(video.ok).toBe(true)
    if (!video.ok)
      return
    expect(video.prompt).toContain('Orbit')
    expect(video.params.camera).toBe('orbit')
  })

  it('不在资产库的参考素材只提醒，不拦提交；失败率每个模型只提醒一次', () => {
    const first = planCanvasGenerate({
      node: node('image', { prompt: '一只猫' }),
      payload: model,
      unlinkedRefs: 2,
      canvasId: 9,
      recentWarn: { recent_warn: true, recent_fail_rate: 18.2 },
    })
    expect(first.ok).toBe(true)
    if (!first.ok)
      return
    expect(first.notices.map(item => item.key)).toEqual([
      '有 {n} 个参考素材不在你的资产库里（常见于复制来的画布），本次生成不会使用，请重新上传或从资产库选入',
      '这个模型近 7 天失败率 {rate}%，可以换一个再试',
    ])
    expect(first.notices[0]?.params).toEqual({ n: 2 })
    expect(first.notices[0]?.track).toMatchObject({ event: 'ref_missing', props: { count: 2, canvas_id: 9, type: 'image' } })
    expect(first.notices[1]?.params).toEqual({ rate: 18 })
    expect(first.notices[1]?.warnModel).toBe('img-1')

    const again = planCanvasGenerate({
      node: node('image', { prompt: '一只猫' }),
      payload: model,
      alreadyWarned: true,
      recentWarn: { recent_warn: true, recent_fail_rate: 18.2 },
    })
    expect(again.ok && again.notices).toEqual([])
  })

  it('主体最多带 4 个，配音语种和音色原样带上', () => {
    const plan = planCanvasGenerate({
      node: node('audio', { prompt: '你好', subjectIds: [1, 2, 3, 4, 5] }),
      payload: { model: 'tts-1', params: {}, lang: 'en', voice: 'warm' },
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok)
      return
    expect(plan.subjectIds).toEqual([1, 2, 3, 4])
    expect(plan.lang).toBe('en')
    expect(plan.voice).toBe('warm')
    expect(plan.type).toBe('audio')
  })

  it('配乐用情绪模板补提示词，不带配音语种', () => {
    const plan = planCanvasGenerate({
      node: node('audio', { prompt: '' }),
      payload: { model: 'tts-1', params: { audioKind: 'bgm', mood: 'calm' }, lang: 'en', voice: 'warm' },
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok)
      return
    expect(plan.prompt).toContain('安静')
    expect(plan.lang).toBeUndefined()
    expect(plan.voice).toBeUndefined()
    expect(plan.params.lang).toBeUndefined()
    expect(plan.params.voice).toBeUndefined()
  })
})
