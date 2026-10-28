import { describe, expect, it } from 'vitest'
import {
  applyAudioMoodPrompt,
  audioKindParams,
  audioUsesVoice,
  buildAudioPrompt,
  parseAudioKind,
  pickComposeBgmId,
} from './canvas-audio'

describe('canvas-audio', () => {
  it('认配乐 / 音效，其余回落旁白', () => {
    expect(parseAudioKind('bgm')).toBe('bgm')
    expect(parseAudioKind('sfx')).toBe('sfx')
    expect(parseAudioKind('tts')).toBe('narration')
    expect(audioUsesVoice('narration')).toBe(true)
    expect(audioUsesVoice('bgm')).toBe(false)
  })

  it('配乐默认 15 秒并带节奏情绪', () => {
    expect(audioKindParams('bgm')).toEqual({ audioKind: 'bgm', duration: 15, mood: 'pulse' })
    expect(audioKindParams('sfx')).toEqual({ audioKind: 'sfx', duration: 5 })
  })

  it('换情绪只覆盖空提示词或上一档模板', () => {
    expect(applyAudioMoodPrompt('', 'heat')).toContain('热血')
    expect(applyAudioMoodPrompt('节奏感强的电子配乐，无人声，中等速度，适合产品展示和卡点转场', 'calm', 'pulse')).toContain('安静')
    expect(applyAudioMoodPrompt('我自己写的垫乐', 'heat', 'pulse')).toBe('我自己写的垫乐')
  })

  it('提交配乐时把情绪模板接到提示词后，已写过的不重复', () => {
    expect(buildAudioPrompt('bgm', '', 'calm')).toContain('安静')
    expect(buildAudioPrompt('bgm', '开场垫乐', 'calm')).toMatch(/开场垫乐[\s\S]*安静/)
    const once = buildAudioPrompt('bgm', '安静舒缓的氛围配乐，无人声，低动态，适合口播垫乐', 'calm')
    expect(once.match(/安静舒缓/g)?.length).toBe(1)
    expect(buildAudioPrompt('narration', '读这段旁白', 'calm')).toBe('读这段旁白')
  })

  it('合成优先带标成配乐的轨道', () => {
    expect(pickComposeBgmId([
      { assetId: 1, preferred: false },
      { assetId: 2, preferred: true },
    ])).toBe(2)
    expect(pickComposeBgmId([{ assetId: 9 }])).toBe(9)
    expect(pickComposeBgmId([{ assetId: 1 }, { assetId: 2 }])).toBe(0)
  })
})
