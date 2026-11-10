import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  REROLL_ACTIONS,
  REROLL_REASONS,
  modelKeepInfo,
  nodeHasResult,
  normalizeRerollReasons,
  readRerollAsk,
  REROLL_ASK_KEY,
  rerollAdvice,
  rerollNodeType,
  rerollReasonsFor,
  reviewRerollReasons,
  shotReviewsByAsset,
  shouldAskReroll,
  writeRerollAsk,
} from './canvas-reroll'

function memoryStorage(init: Record<string, string> = {}) {
  const map = new Map(Object.entries(init))
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value) },
    removeItem: (key: string) => { map.delete(key) },
  }
}

describe('rerollReasonsFor', () => {
  it('图片 / 视频 / 音频各有各的原因，文本和其它节点没有', () => {
    expect(rerollReasonsFor('image')).toEqual(['identity', 'composition', 'style', 'technical', 'off_prompt'])
    expect(rerollReasonsFor('video')).toEqual(['identity', 'performance', 'lipsync', 'composition', 'continuity', 'duration', 'style', 'technical', 'off_prompt'])
    expect(rerollReasonsFor('audio')).toEqual(['performance', 'duration', 'technical', 'off_prompt'])
    expect(rerollReasonsFor(null)).toEqual([])
    expect(rerollNodeType('text')).toBeNull()
    expect(rerollNodeType('director')).toBeNull()
    expect(rerollNodeType('video')).toBe('video')
  })

  it('normalize 丢掉不认识和这类节点不适用的原因，去重并按面板顺序排', () => {
    expect(normalizeRerollReasons(['technical', 'lipsync', 'identity', 'identity', 'nope'], 'image')).toEqual(['identity', 'technical'])
    expect(normalizeRerollReasons(['off_prompt', 'performance'], 'audio')).toEqual(['performance', 'off_prompt'])
    expect(normalizeRerollReasons(null, 'video')).toEqual([])
  })
})

describe('rerollAdvice', () => {
  it('人物不对：没挂主体 / 参考时先让挂上', () => {
    expect(rerollAdvice(['identity'], { type: 'image' })).toEqual([
      { id: 'attachSubject', textKey: 'canvas.reroll.advice.attachSubject', action: 'subject' },
      { id: 'attachRef', textKey: 'canvas.reroll.advice.attachRef', action: 'ref' },
    ])
  })

  it('人物不对：已挂参考时图片走智能编辑、视频换模型', () => {
    expect(rerollAdvice(['identity'], { type: 'image', hasRef: true }).map(item => item.action)).toEqual(['smart_edit'])
    expect(rerollAdvice(['identity'], { type: 'video', hasSubject: true }).map(item => item.action)).toEqual(['model'])
  })

  it('构图：图片局部改，视频片段重拍或写明镜头', () => {
    expect(rerollAdvice(['composition'], { type: 'image' }).map(item => item.id)).toEqual(['smartEdit'])
    expect(rerollAdvice(['composition'], { type: 'video' }).map(item => item.id)).toEqual(['retake', 'camera'])
  })

  it('风格 / 没按描述来 / 时长', () => {
    expect(rerollAdvice(['style'], { type: 'image' }).map(item => item.action)).toEqual(['stylelib', 'style_ref'])
    expect(rerollAdvice(['style'], { type: 'video' }).map(item => item.action)).toEqual(['stylelib', 'ref'])
    expect(rerollAdvice(['off_prompt'], { type: 'video' }).map(item => item.action)).toEqual(['optimize'])
    expect(rerollAdvice(['duration'], { type: 'video' })).toEqual([
      { id: 'duration', textKey: 'canvas.reroll.advice.duration', action: 'spec' },
    ])
  })

  it('表演 / 口型：片段重拍 + 口播模式；已在口播模式就不再建议切', () => {
    expect(rerollAdvice(['performance', 'lipsync'], { type: 'video', videoMode: 'reference' }).map(item => item.id)).toEqual(['retake', 'talking'])
    expect(rerollAdvice(['lipsync'], { type: 'video', videoMode: 'talking' }).map(item => item.id)).toEqual(['retake'])
  })

  it('连戏：首尾帧或续写；已经是首尾帧且有首帧只建议续写', () => {
    expect(rerollAdvice(['continuity'], { type: 'video', videoMode: 'reference' }).map(item => item.action)).toEqual(['first_last', 'extend'])
    expect(rerollAdvice(['continuity'], { type: 'video', videoMode: 'fl2v', hasFirstFrame: true }).map(item => item.action)).toEqual(['extend'])
  })

  it('多个原因命中同一招只出一条，顺序跟原因顺序走', () => {
    const list = rerollAdvice(['technical', 'composition', 'identity'], { type: 'image', hasRef: true })
    expect(list.map(item => item.id)).toEqual(['smartEdit', 'model'])
    const video = rerollAdvice(['technical', 'performance', 'composition'], { type: 'video' })
    expect(video.map(item => item.id)).toEqual(['retake', 'talking', 'camera', 'model'])
  })

  it('当前走不了的入口退成纯文案，不给按钮', () => {
    const list = rerollAdvice(['technical'], { type: 'video', available: ['model'] })
    expect(list).toEqual([
      { id: 'retake', textKey: 'canvas.reroll.advice.retake' },
      { id: 'model', textKey: 'canvas.reroll.advice.model', action: 'model' },
    ])
  })

  it('音频：语气换音色，没按文本来只给文案', () => {
    expect(rerollAdvice(['performance', 'off_prompt', 'technical', 'duration'], { type: 'audio' })).toEqual([
      { id: 'voice', textKey: 'canvas.reroll.advice.voice', action: 'voice' },
      { id: 'duration', textKey: 'canvas.reroll.advice.duration', action: 'spec' },
      { id: 'model', textKey: 'canvas.reroll.advice.model', action: 'model' },
      { id: 'promptAudio', textKey: 'canvas.reroll.advice.promptAudio' },
    ])
  })

  it('不适用的原因不出建议', () => {
    expect(rerollAdvice(['lipsync', 'whatever'], { type: 'image' })).toEqual([])
    expect(rerollAdvice([], { type: 'video' })).toEqual([])
  })
})

describe('shouldAskReroll', () => {
  const done = { content: 'https://cdn.example/a.png', taskId: 7, taskStatus: 'succeeded' }

  it('对已有结果的图片 / 视频 / 音频节点亲手点生成才问', () => {
    expect(shouldAskReroll({ kind: 'image', data: done, trigger: 'inspector' })).toBe(true)
    expect(shouldAskReroll({ kind: 'video', data: done, trigger: 'shortcut' })).toBe(true)
    expect(shouldAskReroll({ kind: 'audio', data: done, trigger: 'selbar' })).toBe(true)
  })

  it('第一次生成、上传的素材、文本节点、正在跑的不问', () => {
    expect(shouldAskReroll({ kind: 'image', data: { content: '', taskId: 0 }, trigger: 'inspector' })).toBe(false)
    expect(shouldAskReroll({ kind: 'image', data: { content: 'https://cdn.example/up.png' }, trigger: 'inspector' })).toBe(false)
    expect(shouldAskReroll({ kind: 'text', data: done, trigger: 'inspector' })).toBe(false)
    expect(shouldAskReroll({ kind: 'image', data: { ...done, taskStatus: 'running' }, trigger: 'inspector' })).toBe(false)
    expect(nodeHasResult(null)).toBe(false)
  })

  it('上次失败但之前出过结果，仍算重抽', () => {
    expect(shouldAskReroll({ kind: 'video', data: { ...done, taskStatus: 'failed' }, trigger: 'inspector' })).toBe(true)
  })

  it('过期重跑 / 批量 / 对话 / 助手、派生节点、跟练、不再询问都不问', () => {
    for (const trigger of ['stale', 'batch', 'chat', 'assist'] as const)
      expect(shouldAskReroll({ kind: 'image', data: done, trigger })).toBe(false)
    expect(shouldAskReroll({ kind: 'video', data: done, trigger: 'inspector', derived: true })).toBe(false)
    expect(shouldAskReroll({ kind: 'video', data: done, trigger: 'inspector', practice: true })).toBe(false)
    expect(shouldAskReroll({ kind: 'video', data: done, trigger: 'inspector', ask: false })).toBe(false)
  })
})

describe('重抽询问偏好', () => {
  it('默认要问；勾了不再询问写 0，取消勾选删掉', () => {
    const store = memoryStorage()
    expect(readRerollAsk(store)).toBe(true)
    writeRerollAsk(false, store)
    expect(store.map.get(REROLL_ASK_KEY)).toBe('0')
    expect(readRerollAsk(store)).toBe(false)
    writeRerollAsk(true, store)
    expect(store.map.has(REROLL_ASK_KEY)).toBe(false)
    expect(readRerollAsk(store)).toBe(true)
  })

  it('存储读写抛错或不可用时不炸，按要问处理', () => {
    const broken = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
      removeItem: () => { throw new Error('denied') },
    }
    expect(readRerollAsk(broken)).toBe(true)
    expect(() => writeRerollAsk(false, broken)).not.toThrow()
    expect(readRerollAsk(null)).toBe(true)
    expect(() => writeRerollAsk(false, null)).not.toThrow()
  })
})

describe('reviewRerollReasons', () => {
  it('只有退回且填了原因才带', () => {
    expect(reviewRerollReasons({ status: -1, reason: 'lipsync' })).toEqual(['lipsync'])
    expect(reviewRerollReasons({ status: -1, reason: '' })).toEqual([])
    expect(reviewRerollReasons({ status: 1, reason: 'identity' })).toEqual([])
    expect(reviewRerollReasons(null)).toEqual([])
  })
})

describe('shotReviewsByAsset', () => {
  it('分镜图 / 视频 / 配音 / 角色图的结论都收，待审的不收', () => {
    const media = (assetId: number, review: unknown) => ({
      node_id: 'n',
      asset_id: assetId,
      url: '',
      cover_url: '',
      duration: 0,
      task_status: 'succeeded',
      candidates: [{ task_id: 1, node_id: 'n', asset_id: assetId, url: 'u', cover_url: '', duration: 0, model: 'm', prompt: '', created_at: 0, review }],
    }) as never
    const map = shotReviewsByAsset([
      { no: 1, line: '', seconds: 5, video: media(31, { status: -1, reason: 'lipsync' }), image: media(32, { status: 1, reason: '' }), voice: media(33, null), character_node_ids: [] },
      { no: 2, line: '', seconds: 5, video: media(41, null), image: null, voice: null, character_node_ids: [] },
    ], [media(51, { status: -1, reason: 'identity' })])
    expect([...map.keys()].sort()).toEqual([31, 32, 51])
    expect(reviewRerollReasons(map.get(31))).toEqual(['lipsync'])
    expect(reviewRerollReasons(map.get(32))).toEqual([])
    expect(reviewRerollReasons(map.get(51))).toEqual(['identity'])
    expect(shotReviewsByAsset(null).size).toBe(0)
  })
})

describe('modelKeepInfo', () => {
  it('样本不足（三个字段都是 0）不展示', () => {
    expect(modelKeepInfo({ recent_keep_total: 0, recent_keep_rate: 0, recent_pulls_per_keep: 0 })).toBeNull()
    expect(modelKeepInfo({})).toBeNull()
    expect(modelKeepInfo(null)).toBeNull()
  })

  it('留用率取整，几次出一条保留一位小数', () => {
    expect(modelKeepInfo({ recent_keep_total: 40, recent_keep_rate: 62.5, recent_pulls_per_keep: 1.6 })).toEqual({ rate: 63, pulls: 1.6 })
    expect(modelKeepInfo({ recent_keep_total: 12, recent_keep_rate: 100, recent_pulls_per_keep: 1 })).toEqual({ rate: 100, pulls: 1 })
    expect(modelKeepInfo({ recent_keep_total: 12, recent_keep_rate: 33.33, recent_pulls_per_keep: 3.04 })).toEqual({ rate: 33, pulls: 3 })
  })
})

describe('重抽面板的动态文案 key', () => {
  // 原因 / 建议 / 动作的 key 是拼出来的，i18n-coverage 的静态扫描看不到，这里逐语种核一遍
  const LOCALES = ['zh', 'zh-TW', 'en', 'ja', 'fr', 'ru', 'vi']
  const adviceIds = new Set<string>()
  for (const type of ['image', 'video', 'audio'] as const) {
    for (const ctx of [{}, { hasRef: true }, { videoMode: 'talking' }, { videoMode: 'fl2v', hasFirstFrame: true }]) {
      for (const item of rerollAdvice(REROLL_REASONS, { type, ...ctx }))
        adviceIds.add(item.id)
    }
  }

  it.each(LOCALES)('%s 里原因、建议、动作都有译文', (locale) => {
    const messages = JSON.parse(readFileSync(`i18n/locales/${locale}.json`, 'utf8')) as { canvas: { reroll: Record<string, Record<string, string>> } }
    const reroll = messages.canvas.reroll
    const missing: string[] = []
    for (const reason of [...REROLL_REASONS, 'performanceAudio']) {
      if (!reroll.reason?.[reason])
        missing.push(`reason.${reason}`)
    }
    for (const id of adviceIds) {
      if (!reroll.advice?.[id])
        missing.push(`advice.${id}`)
    }
    for (const action of REROLL_ACTIONS) {
      if (!reroll.action?.[action])
        missing.push(`action.${action}`)
    }
    expect(missing).toEqual([])
    // 反过来：语言包里也不留没人用的建议 / 动作
    expect(Object.keys(reroll.advice ?? {}).sort()).toEqual([...adviceIds].sort())
    expect(Object.keys(reroll.action ?? {}).sort()).toEqual([...REROLL_ACTIONS].sort())
  })
})
