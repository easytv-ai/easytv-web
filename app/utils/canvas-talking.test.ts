import { describe, expect, it } from 'vitest'
import { buildTalkingPrompt, hasNativeAudio, modelAbilities, normalizeTalkingData, talkingDuration, talkingSeconds } from './canvas-talking'

describe('talkingSeconds', () => {
  it('空台词只剩 1 秒收尾', () => {
    expect(talkingSeconds('')).toBe(1)
  })

  it('中文按字符数 3.5 字/秒加 1 秒收尾向上取整', () => {
    // 14 字 / 3.5 = 4 秒 + 1 = 5
    expect(talkingSeconds('一'.repeat(14))).toBe(5)
    // 15 字 / 3.5 = 4.29 + 1 = 5.29 → 6
    expect(talkingSeconds('大家好欢迎来到我的频道今天聊聊天')).toBe(6)
  })

  it('英文按单词数 0.4 秒/词', () => {
    // 10 词 × 0.4 = 4 + 1 = 5
    expect(talkingSeconds('hello everyone welcome to my channel today we will talk')).toBe(5)
  })

  it('中英混排分别计数后相加，标点不算', () => {
    // 4 字 / 3.5 = 1.14 + 2 词 × 0.4 = 0.8 → 1.94 + 1 = 2.94 → 3
    expect(talkingSeconds('大家好，hello world！')).toBe(3)
  })
})

describe('talkingDuration', () => {
  it('落到 ≥ 需要秒数的最小档', () => {
    expect(talkingDuration('大家好欢迎来到我的频道今天聊聊天', [5, 10, 15])).toBe(10)
    expect(talkingDuration('大家好', [5, 10, 15])).toBe(5)
  })

  it('档位顺序乱也按数值找', () => {
    expect(talkingDuration('大家好欢迎来到我的频道今天聊聊天', [15, 5, 10])).toBe(10)
  })

  it('所有档都不够时取最大档', () => {
    expect(talkingDuration('一'.repeat(300), [4, 8, 12])).toBe(12)
  })

  it('没声明档位时夹在 3~15 秒', () => {
    expect(talkingDuration('', null)).toBe(3)
    expect(talkingDuration('', [])).toBe(3)
    expect(talkingDuration('大家好欢迎来到我的频道今天聊聊天', null)).toBe(6)
    expect(talkingDuration('一'.repeat(300), undefined)).toBe(15)
  })
})

describe('buildTalkingPrompt', () => {
  it('中文模板带景别、语气与台词', () => {
    expect(buildTalkingPrompt({ script: '大家好', tone: 'warm', framing: 'medium' }))
      .toBe('中景固定机位，人物正对镜头口播，口型与台词同步，自然眨眼与手势，热情语气清晰说出：「大家好」。画面稳定，无字幕，无背景音乐。')
  })

  it('有主体名时替换人物，补充描述拼在末尾', () => {
    expect(buildTalkingPrompt({ script: ' 大家好 ', tone: 'natural', framing: 'close', subject: '小雅', extra: ' 穿白衬衫，办公室背景 ' }))
      .toBe('近景固定机位，小雅正对镜头口播，口型与台词同步，自然眨眼与手势，自然语气清晰说出：「大家好」。画面稳定，无字幕，无背景音乐。穿白衬衫，办公室背景')
  })
})

describe('normalizeTalkingData', () => {
  it('缺省值', () => {
    expect(normalizeTalkingData(null)).toEqual({ script: '', tone: 'natural', framing: 'close' })
  })

  it('非法枚举回落，台词截断到 300 字，手动时长只认正数', () => {
    const out = normalizeTalkingData({ script: '一'.repeat(310), tone: 'x' as never, framing: 'medium', duration: 0 })
    expect(out.script).toHaveLength(300)
    expect(out.tone).toBe('natural')
    expect(out.framing).toBe('medium')
    expect(out.duration).toBeUndefined()
    expect(normalizeTalkingData({ script: 'a', tone: 'calm', framing: 'close', duration: 10 }).duration).toBe(10)
  })
})

describe('abilities', () => {
  it('数组与逗号串都能读', () => {
    expect(modelAbilities({ abilities: ['upscale', ' native_audio '] })).toEqual(['upscale', 'native_audio'])
    expect(modelAbilities({ abilities: 'upscale,native_audio' })).toEqual(['upscale', 'native_audio'])
    expect(modelAbilities({})).toEqual([])
    expect(modelAbilities(null)).toEqual([])
  })

  it('hasNativeAudio', () => {
    expect(hasNativeAudio({ abilities: ['native_audio'] })).toBe(true)
    expect(hasNativeAudio({ abilities: 'matting' })).toBe(false)
    expect(hasNativeAudio(undefined)).toBe(false)
  })
})
